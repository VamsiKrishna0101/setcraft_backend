import { Prisma } from "@prisma/client";

export const realSnapshotWhere: Prisma.HealthKitSnapshotWhereInput = {
  OR: [
    { sourceProvider: null },
    {
      NOT: [
        { sourceProvider: { contains: "preview", mode: "insensitive" } },
        { sourceProvider: { contains: "sample", mode: "insensitive" } },
        { sourceProvider: { contains: "demo", mode: "insensitive" } },
      ],
    },
  ],
};

export const realMealWhere: Prisma.UserMealLogWhereInput = {
  nutrition: { NOT: { name: { startsWith: "Today preview · " } } },
};

export function isPreviewSource(source: unknown) {
  return typeof source === "string" && /preview|sample|demo/i.test(source);
}

export function isRealBodyEntry(entry: {
  quality?: unknown;
  metrics?: unknown;
  analysisVersion?: string | null;
}) {
  const quality = entry.quality as Record<string, unknown> | null;
  if (quality?.synthetic === true) return false;
  if (
    /preview|two-month-history|sample-fixture/i.test(
      entry.analysisVersion ?? "",
    )
  )
    return false;
  const metrics = entry.metrics as Record<string, { source?: string }> | null;
  return !Object.values(metrics ?? {}).some((metric) =>
    isPreviewSource(metric?.source),
  );
}

const previewNotes = [
  "Target Effort: 8.5/10 — Full recovery detected. Prime window for hypertrophy.",
  "Target Effort: 8.5/10 — Peak mechanical tension. Focus on 3-second eccentric tempo.",
  "Target Effort: 8.5/10 (Build Phase) — CNS primed for high tension. Push for personal bests in today's bench press.",
];

export const realPlanWhere: Prisma.UserWorkoutWhereInput = {
  OR: [
    { session: { isNot: null } },
    { scheduledDate: { not: null } },
    { aiNote: null },
    { NOT: { aiNote: { in: previewNotes } } },
  ],
};

export function realCoachingNote(note: string | null) {
  return note &&
    !previewNotes.includes(note) &&
    !/^sample (day|session)/i.test(note)
    ? note
    : null;
}
