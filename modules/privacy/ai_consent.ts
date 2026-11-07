import { AsyncLocalStorage } from "node:async_hooks";
import prisma from "../../config/prisma";
import { PlannerError } from "../../graphworkflow/common/types";
import { supportConfig } from "../support/support_config";
export const aiPlanningOwner=new AsyncLocalStorage<string>();
export async function assertAiPlanningConsent(userId:string) {
  const consent=await prisma.userPrivacyConsent.findUnique({where:{userId}});
  const config=supportConfig();
  if (!config.privacyPolicyUrl || !consent?.aiPlanningConsent || consent.aiPlanningPolicyVersion!==config.aiPolicyVersion) {
    throw new PlannerError("AI_CONSENT_REQUIRED","Review AI data sharing before creating a new plan.",403);
  }
}
export async function assertCurrentAiPlanningConsent() {
  const owner=aiPlanningOwner.getStore();
  // Other tooling uses this model without personal account context. The planner
  // worker always sets an owner and rechecks immediately before each API attempt.
  if(owner) await assertAiPlanningConsent(owner);
}
