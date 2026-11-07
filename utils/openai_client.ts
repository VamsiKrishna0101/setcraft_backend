/** Shared OpenAI Responses transport. Provider data is never logged. */
export const defaultAIModel = () => process.env.OPENAI_MODEL || "gpt-6-luna";
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";
type JsonSchema = Record<string, any>;
type Part = { text?: string; inlineData?: { mimeType: string; data: string } };
type Content = string | Array<{ role: string; parts: Part[] }>;
type Request = {
  model?: string;
  contents: Content;
  config?: {
    systemInstruction?: string;
    responseMimeType?: string;
    responseJsonSchema?: JsonSchema;
    maxOutputTokens?: number;
    reasoningEffort?: ReasoningEffort;
    abortSignal?: AbortSignal;
  };
};

export class OpenAIProviderError extends Error {
  constructor(public status: number, public code: string) {
    super(`OpenAI request failed (${status}; ${code}).`);
  }
}

export function openAIBaseUrl() {
  const url = new URL(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("OPENAI_BASE_URL must be an HTTPS API URL without credentials or query parameters.");
  return url.href.replace(/\/$/, "");
}

function nullable(schema: JsonSchema): boolean {
  return schema.type === "null" || Array.isArray(schema.type) && schema.type.includes("null") ||
    (schema.anyOf ?? []).some((s: JsonSchema) => nullable(s));
}

/** Strict output requires closed objects and all properties required. Optional
 * properties use null on the wire, then regain their original semantics below. */
export function strictOutputSchema(schema: JsonSchema): JsonSchema {
  const output: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (["$schema", "default", "minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems"].includes(key)) continue;
    if (key === "properties" || key === "required" || key === "additionalProperties") continue;
    if (key === "$defs" || key === "definitions")
      output[key] = Object.fromEntries(Object.entries(value as JsonSchema).map(([k, s]) => [k, strictOutputSchema(s)]));
    else if (["anyOf", "oneOf", "allOf"].includes(key)) output[key] = (value as JsonSchema[]).map(strictOutputSchema);
    else if (key === "items") output[key] = strictOutputSchema(value as JsonSchema);
    else output[key] = value;
  }
  if (schema.type === "object" || schema.properties) {
    // Unbounded dictionaries cannot honestly be described by strict output.
    if (schema.additionalProperties && schema.additionalProperties !== false)
      throw new Error("Use explicit properties for structured OpenAI output dictionaries.");
    const required = new Set(schema.required ?? []);
    output.properties = Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, value]) => {
      const child = strictOutputSchema(value as JsonSchema);
      return [key, required.has(key) || nullable(child) ? child : { anyOf: [child, { type: "null" }] }];
    }));
    output.type = "object";
    output.additionalProperties = false;
    output.required = Object.keys(output.properties);
  }
  return output;
}

function resolveSchema(schema: JsonSchema, root: JsonSchema): JsonSchema {
  if (typeof schema.$ref !== "string" || !schema.$ref.startsWith("#/")) return schema;
  return schema.$ref.slice(2).split("/").reduce((node: any, key: string) => node?.[key.replace(/~1/g, "/").replace(/~0/g, "~")], root) ?? schema;
}

function restoreOptional(value: any, schema: JsonSchema, root: JsonSchema = schema): any {
  schema = resolveSchema(schema, root);
  if (value == null) return value;
  const branch = (schema.anyOf ?? []).find((s: JsonSchema) => s.type !== "null");
  if (branch) return restoreOptional(value, branch, root);
  if (Array.isArray(value)) return value.map(item => restoreOptional(item, schema.items ?? {}, root));
  if (typeof value !== "object") return value;
  const required = new Set(schema.required ?? []);
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const child = schema.properties?.[key];
    if (child && item === null && !required.has(key) && !nullable(resolveSchema(child, root))) return [];
    return [[key, child ? restoreOptional(item, child, root) : item]];
  }));
}

export class OpenAIContentClient {
  constructor(private options: { timeoutMs?: number; reasoningEffort?: ReasoningEffort; fetch?: typeof fetch } = {}) {}

  async generateContent(request: Request) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new OpenAIProviderError(503, "not_configured");
    const config = request.config ?? {};
    const model = request.model ?? defaultAIModel();
    const effort = config.reasoningEffort ?? this.options.reasoningEffort ?? process.env.OPENAI_REASONING_EFFORT ?? "high";
    if (!["none", "low", "medium", "high", "xhigh", "max"].includes(effort))
      throw new Error("Invalid OPENAI_REASONING_EFFORT.");
    const input = typeof request.contents === "string" ? request.contents : request.contents.map(message => ({
      role: message.role,
      content: message.parts.flatMap((part): any[] => part.text != null
        ? [{ type: "input_text", text: part.text }]
        : part.inlineData ? [{ type: "input_image", image_url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`, detail: "high" }] : []),
    }));
    const schema = config.responseJsonSchema;
    // An envelope supports array-root catalogue schemas as well as object roots.
    const strictSchema = schema ? strictOutputSchema(schema) : undefined;
    const { $defs, definitions, ...resultSchema } = strictSchema ?? {};
    const format = schema ? { type: "json_schema", name: "setcraft_result", strict: true,
      schema: { type: "object", ...($defs ? { $defs } : {}), ...(definitions ? { definitions } : {}), properties: { result: resultSchema }, required: ["result"], additionalProperties: false } }
      : config.responseMimeType === "application/json" ? { type: "json_object" } : undefined;
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 120000);
    const signal = config.abortSignal ? AbortSignal.any([timeout, config.abortSignal]) : timeout;
    const response = await (this.options.fetch ?? fetch)(`${openAIBaseUrl()}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input, instructions: config.systemInstruction,
        reasoning: { effort }, text: { verbosity: "low", ...(format ? { format } : {}) },
        max_output_tokens: config.maxOutputTokens ?? 16384, store: false }),
      signal,
      redirect: "error",
    });
    if (!response.ok) {
      let code = "provider_error";
      try {
        const body = await response.json() as any;
        if (/^[a-z_]{1,80}$/.test(body.error?.code ?? "")) code = body.error.code;
      } catch { /* Never expose a raw upstream body. */ }
      throw new OpenAIProviderError(response.status, code);
    }
    const body = await response.json() as any;
    if (body.status && body.status !== "completed")
      throw new OpenAIProviderError(502, body.status === "incomplete" ? "incomplete_output" : "response_failed");
    const content = (body.output ?? []).filter((item: any) => item.type === "message").flatMap((item: any) => item.content ?? []);
    if (content.some((part: any) => part.type === "refusal")) throw new OpenAIProviderError(422, "refused");
    let text = content.filter((part: any) => part.type === "output_text").map((part: any) => part.text).join("");
    if (!text) throw new OpenAIProviderError(502, "empty_output");
    if (schema) {
      const parsed = JSON.parse(text);
      if (!Object.prototype.hasOwnProperty.call(parsed, "result")) throw new SyntaxError("Missing structured result.");
      text = JSON.stringify(restoreOptional(parsed.result, schema));
    }
    return { text, modelVersion: body.model || model, finishReason: body.status || "completed", usage: body.usage };
  }
}
