import assert from "node:assert/strict";
import { z } from "zod";
import { OpenAIContentClient, strictOutputSchema } from "../utils/openai_client";

async function main() {
  const saved = { key: process.env.OPENAI_API_KEY, base: process.env.OPENAI_BASE_URL, effort: process.env.OPENAI_REASONING_EFFORT };
  process.env.OPENAI_API_KEY = "synthetic-key-never-transmitted";
  process.env.OPENAI_BASE_URL = "https://api.openai.com/v1";
  process.env.OPENAI_REASONING_EFFORT = "high";
  try {
    const schema = z.object({ name: z.string(), extra: z.string().optional(), reading: z.number().nullable() }).strict();
    const jsonSchema = z.toJSONSchema(schema);
    let received: any;
    const client = new OpenAIContentClient({ fetch: (async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(options?.redirect, "error", "Credentials must never follow redirects.");
      received = JSON.parse(options!.body as string);
      return Response.json({ status: "completed", model: "gpt-6-luna", output: [
        { type: "reasoning", summary: [{ text: "Never parse this as the answer" }] },
        { type: "message", content: [{ type: "output_text", text: JSON.stringify({ result: { name: "OK", extra: null, reading: null } }) }] },
      ] });
    }) as typeof fetch });
    const result = await client.generateContent({ contents: [{ role: "user", parts: [
      { text: "Fictional input" }, { inlineData: { mimeType: "image/png", data: "c3ludGhldGlj" } },
    ] }], config: { systemInstruction: "Use supplied evidence only.", responseJsonSchema: jsonSchema, maxOutputTokens: 4096 } });
    assert.deepEqual(schema.parse(JSON.parse(result.text)), { name: "OK", reading: null });
    assert.equal(received.model, "gpt-6-luna");
    assert.equal(received.reasoning.effort, "high");
    assert.equal(received.text.verbosity, "low");
    assert.equal(received.text.format.strict, true);
    assert.equal(received.store, false);
    assert.equal(received.max_output_tokens, 4096);
    assert.equal(received.input[0].content[1].image_url, "data:image/png;base64,c3ludGhldGlj");
    assert(!JSON.stringify(received).includes(process.env.OPENAI_API_KEY!));
    const strict = strictOutputSchema(jsonSchema);
    assert.equal(strict.additionalProperties, false);
    assert.deepEqual(strict.required, ["name", "extra", "reading"]);
    const arrayClient = new OpenAIContentClient({ fetch: (async () => Response.json({ status: "completed", output: [
      { type: "message", content: [{ type: "output_text", text: '{"result":[{"id":"a"}]}' }] },
    ] })) as typeof fetch });
    assert.deepEqual(JSON.parse((await arrayClient.generateContent({ contents: "JSON rows", config: {
      responseJsonSchema: { type: "array", items: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
    } })).text), [{ id: "a" }]);
    for (const body of [
      { status: "incomplete", output: [] },
      { status: "completed", output: [] },
      { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "No" }] }] },
    ]) {
      const failing = new OpenAIContentClient({ fetch: (async () => Response.json(body)) as typeof fetch });
      await assert.rejects(() => failing.generateContent({ contents: "test" }), /OpenAI request failed/);
    }
    for (const status of [400, 401, 403, 404, 429, 500]) {
      const failing = new OpenAIContentClient({ fetch: (async () => Response.json({ error: {
        code: status === 429 ? "insufficient_quota" : "provider_error", message: "PRIVATE RESPONSE SHOULD NEVER ESCAPE",
      } }, { status })) as typeof fetch });
      await assert.rejects(() => failing.generateContent({ contents: "test" }), (error: any) =>
        error.status === status && !error.message.includes("PRIVATE RESPONSE"));
    }
    process.env.OPENAI_BASE_URL = "https://api.openai.com/v1?api_key=private";
    await assert.rejects(() => client.generateContent({ contents: "test" }), /HTTPS API URL/);
    process.env.OPENAI_BASE_URL = saved.base;
    delete process.env.OPENAI_API_KEY;
    await assert.rejects(() => client.generateContent({ contents: "test" }), /not_configured/);
    console.log("OpenAI client checks passed: strict objects/arrays, optional/null semantics, images, reasoning, privacy, refusals, incomplete output and provider errors. No network requests.");
  } finally {
    for (const [key, value] of Object.entries({ OPENAI_API_KEY: saved.key, OPENAI_BASE_URL: saved.base, OPENAI_REASONING_EFFORT: saved.effort })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
