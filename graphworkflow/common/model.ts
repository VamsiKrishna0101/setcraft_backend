import { OpenAIContentClient, defaultAIModel } from "../../utils/openai_client";
import { z } from "zod";
import { PlannerError } from "./types";
import { textOnlyPlannerInput } from "./measurements";
import {assertCurrentAiPlanningConsent} from '../../modules/privacy/ai_consent';

export const plannerModel = () =>
  process.env.OPENAI_PLANNER_MODEL ||
  defaultAIModel();

// Provider availability never relaxes the schema, prescription rules or attempt budget.
export function providerRetryModel(current: string, status?: number) {
  return status === 429 || (status != null && status >= 500)
    ? process.env.OPENAI_PLANNER_FALLBACK_MODEL || current
    : current;
}

export type StructuredModel = <T>(
  schema: z.ZodType<T>,
  system: string,
  input: unknown,
  validate: (value: T) => void,
) => Promise<T>;

// Limit provider calls independently of graph fan-out. In particular, do not
// reduce LangGraph's task concurrency to one to serialise API requests.
export function limitModelConcurrency(
  model: StructuredModel,
  limit = 3,
): StructuredModel {
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error("Model concurrency must be a positive integer.");
  let active = 0;
  const waiting: Array<() => void> = [];
  return async (schema, system, input, validate) => {
    if (active < limit) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await model(schema, system, input, validate);
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

// Runtime Zod validation enforces the full prescription contract.
const UNSUPPORTED_SCHEMA_FIELDS = [
  "$schema",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
];

function providerSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(providerSchema);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  const schema: Record<string, unknown> = {};

  for (const [fieldName, fieldValue] of Object.entries(value)) {
    if (!UNSUPPORTED_SCHEMA_FIELDS.includes(fieldName)) {
      schema[fieldName] = providerSchema(fieldValue);
    }
  }

  return schema;
}

export const createStructuredModel = (
  timeoutMs = 120000,
  attempts = 3,
  onFailure?: (failure: {
    attempt: number;
    kind: string;
    status?: number;
    contractIssue?: string;
    model?: string;
  }) => void,
): StructuredModel =>
  limitModelConcurrency(async (schema, system, input, validate) => {
    if (!process.env.OPENAI_API_KEY) {
      throw new PlannerError(
        "MODEL_NOT_CONFIGURED",
        "Weekly planning is unavailable right now.",
        503,
      );
    }

    const client = new OpenAIContentClient({ timeoutMs: timeoutMs });

    let repairFeedback = "";
    let selectedModel = plannerModel();

    for (let attempt = 0; attempt < attempts; attempt++) {
      await assertCurrentAiPlanningConsent();
      try {
        const parts = [
          {
            text: `<user_data>\n${JSON.stringify(textOnlyPlannerInput(input))}\n</user_data>${repairFeedback}`,
          },
        ];

        const response = await client.generateContent({
          model: selectedModel,
          contents: [
            {
              role: "user",
              parts,
            },
          ],
          config: {
            systemInstruction: system,
            responseMimeType: "application/json",
            responseJsonSchema: providerSchema(
              z.toJSONSchema(schema),
            ) as Record<string, unknown>,
            maxOutputTokens: 16000,
          },
        });

        const value = schema.parse(JSON.parse(response.text ?? ""));
        validate(value);

        return value;
      } catch (error) {
        const status = (error as { status?: number })?.status;
        const providerCode = (error as { code?: string })?.code;
        const isContractError =
          error instanceof PlannerError ||
          error instanceof z.ZodError ||
          error instanceof SyntaxError;
        onFailure?.({
          model: selectedModel,
          attempt: attempt + 1,
          kind:
            error instanceof PlannerError
              ? error.code
              : error instanceof z.ZodError
                ? "SCHEMA"
                : error instanceof SyntaxError
                  ? "JSON"
                  : status != null
                    ? "PROVIDER_HTTP"
                    : "PROVIDER_TRANSPORT",
          status,
          contractIssue:
            error instanceof PlannerError
              ? error.message
              : error instanceof z.ZodError
                ? error.issues
                    .slice(0, 5)
                    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                    .join("; ")
                : undefined,
        });

        if (status == null && !isContractError) {
          if (attempt < attempts - 1) {
            await new Promise((resolve) =>
              setTimeout(resolve, 1000 * (attempt + 1)),
            );
            continue;
          }
          throw new PlannerError(
            "MODEL_UNAVAILABLE",
            "The planning provider could not be reached. Your previous plan is unchanged.",
            503,
          );
        }

        if ([400, 401, 403, 404, 422].includes(status ?? 0) || providerCode === "insufficient_quota") {
          throw new PlannerError(
            "MODEL_UNAVAILABLE",
            "The planning model is unavailable. Your previous plan is unchanged.",
            503,
          );
        }
        if (
          (status === 429 || (status != null && status >= 500)) &&
          attempt < attempts - 1
        ) {
          selectedModel = providerRetryModel(selectedModel, status);
          await new Promise((resolve) =>
            setTimeout(resolve, 2000 * (attempt + 1)),
          );
          continue;
        }
        const contractError =
          error instanceof PlannerError
            ? error.message
            : error instanceof z.ZodError
              ? error.issues
                  .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                  .slice(0, 8)
                  .join("; ")
              : "Return valid JSON matching the complete required schema.";

        repairFeedback = `\nThe previous response failed validation: ${contractError}. Rebuild the full response from the original input; do not omit required fields or invent evidence.`;

        if (attempt === attempts - 1) {
          throw new PlannerError(
            status === 429 ? "MODEL_RATE_LIMIT" : "MODEL_RESPONSE_INVALID",
            status === 429
              ? "Planning is busy right now. Please try again shortly. Your previous plan is unchanged."
              : "Could not produce a validated plan. Your previous plan is unchanged.",
            503,
          );
        }
      }
    }

    throw new PlannerError("MODEL_RESPONSE_INVALID", "Planning failed.", 503);
  });

export const openaiStructured = createStructuredModel();
