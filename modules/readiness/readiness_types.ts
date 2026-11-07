import { z } from "zod";

export const ReadinessInputSchema = z.object({
    sleep: z.string().max(30),
    recovery: z.string().max(100),
    aiTarget: z.string().max(500),
    day: z.string().max(20),
    month: z.string().max(20),
    year: z.string().max(10)
})

export const userReadinessSchema = z.object({
    day: z.string().max(20),
    month: z.string().max(20),
    year: z.string().max(20)
})

export type ReadinessInput = z.infer<typeof ReadinessInputSchema>
export type UserReadinessInput = z.infer<typeof userReadinessSchema>