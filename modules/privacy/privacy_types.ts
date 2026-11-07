import { z } from "zod";

export const ConsentUpdateSchema = z.object({
    healthKitBiometrics: z.boolean().optional(),
    cycleTrackingConsent: z.boolean().optional(),
    analyticsConsent: z.boolean().optional(),
    aiPlanningConsent: z.boolean().optional(),
    aiPlanningPolicyVersion: z.string().max(80).optional(),
}).strict();

export type ConsentUpdateInput = z.infer<typeof ConsentUpdateSchema>;
