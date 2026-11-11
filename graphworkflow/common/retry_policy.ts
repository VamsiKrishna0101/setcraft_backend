import { PlannerError } from "./types";

export const MAX_PLAN_ATTEMPTS = 3;

// These require new input or a new snapshot, rather than replaying frozen input.
const newPlanErrors = new Set([
  "WORKFLOW_UPDATED",
  "PLAN_COOLDOWN",
  "STALE_PLAN",
  "CATALOG_CHANGED",
  "PAST_PLAN",
  "INVALID_SPLIT",
  "STARTER_REVIEW_REQUIRED",
  "RETRY_EXHAUSTED",
  "PREMIUM_REQUIRED",
  "PROFILE_INCOMPLETE",
  "INVALID_PROFILE",
]);
const transientCodes = new Set([
  "MODEL_UNAVAILABLE",
  "MODEL_RATE_LIMIT",
  "GENERATION_FAILED",
  "P1001",
  "P1002",
  "P1008",
  "P1017",
  "P2024",
  "P2034",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);

export function canRetryPlan(code: string | null, attempts: number) {
  return (
    attempts < MAX_PLAN_ATTEMPTS &&
    !newPlanErrors.has(code ?? "") &&
    (code == null ||
      transientCodes.has(code) ||
      [
        "MODEL_RESPONSE_INVALID",
        // A user-started retry can produce a valid plan; never a dead end.
        "PLAN_QUALITY",
        "AI_CONSENT_REQUIRED",
        "INVALID_TRANSLATION",
        "INCOMPLETE_WORKFLOW",
      ].includes(code))
  );
}

export function planFailure(
  error: unknown,
  attempts: number,
  now = new Date(),
) {
  const value = error as {
    code?: unknown;
    status?: unknown;
    cause?: unknown;
  } | null;
  const status = typeof value?.status === "number" ? value.status : undefined;
  const code =
    error instanceof PlannerError
      ? error.code
      : typeof value?.code === "string" && transientCodes.has(value.code)
        ? value.code
        : status === 402
          ? "PREMIUM_REQUIRED"
          : status != null && status < 500 && status !== 429
            ? "PLAN_UNAVAILABLE"
            : "GENERATION_FAILED";
  // Unknown runtime failures get bounded recovery too. Domain errors only retry
  // when explicitly transient; a 4xx preference/access failure never loops.
  const transient =
    error instanceof PlannerError
      ? transientCodes.has(error.code) &&
        (error.status === 429 || error.status >= 500)
      : status == null || status === 429 || status >= 500;
  const retry = transient && canRetryPlan(code, attempts);
  return {
    status: retry ? ("QUEUED" as const) : ("FAILED" as const),
    stage: retry ? "retrying" : "failed",
    errorCode: code,
    // A queued lease is the earliest retry time; no lock is held during backoff.
    leaseUntil: retry
      ? new Date(now.getTime() + 5000 * 2 ** Math.max(0, attempts - 1))
      : null,
    leaseToken: null,
  };
}
