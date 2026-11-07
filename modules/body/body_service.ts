import prisma from "../../config/prisma";
import { Prisma, BodyAssessment } from "@prisma/client";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  BodyError,
  BodyMetrics,
  entrySchema,
  reviewSchema,
  metricsSchema,
  saveReviewSchema,
  refreshBodyFocusSchema,
  VIEWS,
} from "./body_types";
import {
  compareMetrics,
  decodePhotos,
  metricsFromVisual,
  regionalChange,
} from "./body_engine";
import { analyzeBodyPhotos, BodyAnalysisStage } from "./body_vision";
import { analyzePhysiquePhotos } from "./physique_review";
import {buildPhysiqueDashboard, compositionReadingsSchema, unavailableGeometry, geometrySchema} from './physique_dashboard';
import { coachBodyMeasurements, BodyCoachingError } from "./body_coaching";
import { getTrainingMap } from "../heatmap/training_map_service";
import { invalidateProgress } from "../progress/progress_cache";
import { realSnapshotWhere, isRealBodyEntry } from "../../utils/real_data";
import {
  prepareBodyPhotos,
  attachPreparedPhotos,
  discardPreparedPhotos,
  queuePhotoDeletion,
  flushBodyPhotoDeletions,
  readBodyPhoto,
  StoredBodyPhoto,
} from "./body_photo_storage";

const photoSelect = { id: true, view: true, mimeType: true };
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const bodyCompositionReport = (metrics: BodyMetrics) =>
  metrics.bodyFatPct
    ? {
        status: "provided_reading",
        method: metrics.bodyFatPct.source,
        reading: metrics.bodyFatPct,
      }
    : { status: "not_validated", method: null };
const measurementReport = (
  metrics: BodyMetrics,
  engine: string | null,
  notes: unknown[],
) => ({
  engine,
  availableMeasurements: metrics,
  unavailableMeasurements: [
    "chestCm",
    "waistCm",
    "hipsCm",
    "leftArmCm",
    "rightArmCm",
    "leftThighCm",
    "rightThighCm",
    "leftCalfCm",
    "rightCalfCm",
    "neckCm",
  ].filter((k) => !(k in metrics)),
  qualityNotes: notes,
});
export function publicAssessment(
  entry: BodyAssessment & {
    photos: Array<{ id: string; view: string; mimeType: string }>;
  },
) {
  return {
    ...entry,
    photos: entry.photos.map((photo) => ({
      ...photo,
      url: `/api/body/photos/${photo.id}`,
    })),
  };
}
export async function getBodyOverview(userId: string) {
  const [profile, records, syncedMeasurements] = await Promise.all([
    prisma.onboarding.findUnique({
      where: { userId },
      select: {
        gender: true,
        height: true,
        weight: true,
        targetWeight: true,
        workingToward: true,
        focusMuscles: true,
        updatedAt: true,
      },
    }),
    prisma.bodyAssessment.findMany({
      where: { userId, status: "SAVED" },
      orderBy: [{ recordedDate: "desc" }, { createdAt: "desc" }],
      include: { photos: { select: photoSelect } },
    }),
    prisma.healthKitSnapshot.findMany({
      where: {
        userId,
        ...realSnapshotWhere,
        sourceProvider: { in: ["GOOGLE_HEALTH_CONNECT", "APPLE_HEALTHKIT"] },
        OR: [{ weight: { not: null } }, { bodyFatPct: { not: null } }],
      },
      orderBy: { date: "desc" },
      take: 30,
      select: {
        id: true,
        date: true,
        weight: true,
        bodyFatPct: true,
        sourceProvider: true,
        updatedAt: true,
      },
    }),
  ]);
  return {
    profile,
    records: records.filter(isRealBodyEntry).slice(0, 60).map(publicAssessment),
    syncedMeasurements,
  };
}

export async function getBodyHistory(
  userId: string,
  input: { from?: string; to?: string; page: number },
) {
  const entries = await prisma.bodyAssessment.findMany({
    where: {
      userId,
      status: "SAVED",
      recordedDate: { gte: input.from, lte: input.to },
    },
    orderBy: [{ recordedDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    include: { photos: { select: photoSelect } },
  });

  const measured = entries.filter(entry => {
    const parsed = metricsSchema.safeParse(entry.metrics);
    return isRealBodyEntry(entry) && parsed.success && Object.values(parsed.data).some(metric =>
      metric && ['scale', 'smart_scale', 'tape', 'dexa', 'calipers'].includes(metric.source));
  });
  const pageSize = 12;
  return {
    records: measured.slice((input.page - 1) * pageSize, input.page * pageSize).map(publicAssessment),
    comparisonBaselines: [] as ReturnType<typeof publicAssessment>[],
    total: measured.length,
    page: input.page,
    pageSize,
  };
}

export async function updatePhotoReadings(userId: string, id: string, expectedUpdatedAt: string,
  rawReadings: unknown) {
  const readings = compositionReadingsSchema.parse(rawReadings);
  const entry = await getAssessment(userId, id);
  if (entry.method !== 'photo_review' || entry.status !== 'SAVED')
    throw new BodyError(422, 'Open a saved photo review to add composition readings.');
  if (readings.recordedDate > entry.recordedDate)
    throw new BodyError(422, 'The reading date cannot be after this scan.');
  const profile = await prisma.onboarding.findUnique({where: {userId}, select: {weight: true}});
  if (readings.muscleMassKg !== undefined && profile?.weight != null && readings.muscleMassKg >= profile.weight)
    throw new BodyError(422, 'Skeletal muscle mass must be less than body weight. Check the units.');
  const quality = entry.quality as any;
  const report = quality?.physiqueAssessment;
  const existing = geometrySchema.safeParse(report?.dashboard?.geometry);
  const definition = report?.dashboard?.metrics?.find((m: any) => m.id === 'definition' && m.source === 'ai_visual_rating' && typeof m.value === 'number');
  const dashboard = buildPhysiqueDashboard(existing.success ? existing.data : unavailableGeometry(), readings,
    definition ? {score: definition.value, observation: 'Stored visual rating.'} : null);
  const updated = await prisma.bodyAssessment.updateMany({where: {id, userId, status: 'SAVED', updatedAt: new Date(expectedUpdatedAt)},
    data: {quality: json({...quality, physiqueAssessment: {...report,
      version: report?.version ?? 'physique-v4', model: report?.model ?? 'readings-only',
      photosUsed: report?.photosUsed ?? entry.photos.length, overview: report?.overview ?? entry.summary ?? 'Your recorded readings.',
      regions: report?.regions ?? [], dashboard}})}});
  if (!updated.count) throw new BodyError(409, 'This scan changed. Reopen it before updating readings.');
  await invalidateProgress(userId);
  return getAssessment(userId, id);
}
export async function getAssessment(userId: string, id: string) {
  const entry = await prisma.bodyAssessment.findFirst({
    where: { id, userId },
    include: { photos: { select: photoSelect } },
  });
  if (!entry || !isRealBodyEntry(entry))
    throw new BodyError(404, "Body entry not found.");
  return publicAssessment(entry);
}
export async function createBodyEntry(
  userId: string,
  input: z.infer<typeof entrySchema>,
) {
  if (
    Object.values(input.metrics).some(
      (metric) =>
        metric?.source === "photo_estimate" ||
        metric?.source === "contour_estimate",
    )
  )
    throw new BodyError(400, "Photo estimates must come from a photo review.");
  const profile = await prisma.onboarding.findUnique({
    where: { userId },
    select: {
      language: true,
      height: true,
      weight: true,
      age: true,
      gender: true,
      workingToward: true,
      experience: true,
      focusMuscles: true,
      limitations: true,
      equipment: true,
      equipmentIds: true,
    },
  });
  if (
    input.metrics.weightKg?.source === "profile" &&
    input.metrics.weightKg.value !== profile?.weight
  )
    throw new BodyError(
      400,
      "Profile weight changed. Reopen this form or enter a current scale reading.",
    );
  const photos = decodePhotos(input.photos);
  let summary: string | null = null,
    observations: unknown[] = [],
    modelVersion: string | null = null,
    quality: Record<string, unknown> = {};
  if (input.requestCoaching && profile && profile.age >= 18) {
    try {
      const training = await getTrainingMap(
        userId,
        input.recordedDate,
        input.utcOffsetMinutes,
      );
      const started = performance.now();
      const coached = await coachBodyMeasurements(
        input.metrics,
        { ...profile, weight: input.metrics.weightKg?.value ?? profile.weight ?? undefined },
        training.regions.map((r) => ({
          id: r.id,
          completedSets: r.completedSets,
          targetSets: r.targetSets,
          soreness: r.soreness,
        })),
      );
      summary = coached.summary;
      observations = coached.observations;
      modelVersion = coached.modelVersion;
      quality = {
        focusStatus: "ready",
        focusBasis: "profile_measurements_and_training",
        bodyRegions: coached.regionalGuidance,
        physiqueAssessment: coached.physiqueAssessment,
        bodyComposition: bodyCompositionReport(input.metrics),
        measurementAnalysis: measurementReport(input.metrics, null, []),
        processing: {
          operation: "entered_report",
          measurementMs: 0,
          aiMs: Math.round(performance.now() - started),
          totalMs: Math.round(performance.now() - started),
        },
      };
    } catch {
      summary =
        "Your baseline is saved. Focus suggestions are unavailable right now. Try again later.";
      quality = {
        focusStatus: "unavailable",
        notes: [
          "Focus suggestions are unavailable right now. Your measurements were saved.",
        ],
      };
    }
  }
  const id = randomUUID();
  const stored = input.savePhotos ? await prepareBodyPhotos(id, photos) : [];
  let entry;
  try {
    entry = await prisma.$transaction(async (tx) => {
      const result = await tx.bodyAssessment.create({
        data: {
          id,
          userId,
          recordedDate: input.recordedDate,
          metrics: json(input.metrics),
          method: "entered",
          observations: json(observations),
          quality: json({
            ...quality,
            photoRetention: stored.length ? "saved" : "not_saved",
            photoSaveConsent: input.savePhotos,
            photoSaveConsentAt: input.savePhotos
              ? new Date().toISOString()
              : null,
          }),
          summary,
          modelVersion,
          heightCm: profile?.height,
          gender: profile?.gender,
          photos: { create: stored },
        },
        include: { photos: { select: photoSelect } },
      });
      await attachPreparedPhotos(tx, stored);
      return result;
    });
  } catch (error) {
    await discardPreparedPhotos(stored);
    throw error;
  }
  await invalidateProgress(userId);
  return publicAssessment(entry);
}
export async function saveBodyReview(
  userId: string,
  id: string,
  input: z.infer<typeof saveReviewSchema>,
) {
  const saved = await prisma.$transaction(async (tx) => {
    const original = await tx.bodyAssessment.findFirst({
      where: { id, userId },
    });
    if (!original)
      throw new BodyError(404, "This entry is no longer available.");
    if (original.updatedAt.toISOString() !== input.expectedUpdatedAt)
      throw new BodyError(
        409,
        "This entry changed on another device. Reopen it before saving.",
      );
    const initial = metricsSchema.parse(original.metrics);
    for (const [key, metric] of Object.entries(input.metrics)) {
      const before = initial[key as keyof BodyMetrics];
      if (
        (metric?.source === "photo_estimate" ||
          metric?.source === "contour_estimate") &&
        (!before ||
          metric.source !== before.source ||
          metric.value !== before.value ||
          metric.low !== before.low ||
          metric.high !== before.high)
      )
        throw new BodyError(
          400,
          "A changed estimate needs an entered measurement source.",
        );
      if (
        metric?.source === "profile" &&
        (!before ||
          before.source !== "profile" ||
          metric.value !== before.value)
      )
        throw new BodyError(
          400,
          "A changed weight needs a scale reading source.",
        );
    }
    // updateMany prevents concurrent saves from both committing a review.
    const metricsChanged =
      Object.keys(initial).length !== Object.keys(input.metrics).length ||
      Object.entries(initial).some(
        ([key, value]) =>
          JSON.stringify(value) !==
          JSON.stringify(input.metrics[key as keyof BodyMetrics]),
      );
    const update = await tx.bodyAssessment.updateMany({
      where: {
        id,
        userId,
        status: original.status,
        updatedAt: original.updatedAt,
      },
      data: {
        status: "SAVED",
        metrics: json(input.metrics),
        ...(metricsChanged
          ? {
              observations: [],
              summary: null,
              quality: json({
                ...(original.quality as object),
                focusStatus: "stale",
                bodyRegions: [],
                physiqueAssessment: null,
                measurementAnalysis: measurementReport(
                  input.metrics,
                  original.method === "entered" ? null : original.modelVersion,
                  [],
                ),
                bodyComposition: bodyCompositionReport(input.metrics),
              }),
            }
          : {}),
      },
    });
    if (update.count !== 1)
      throw new BodyError(409, "This review has already been saved.");
    const entry = await tx.bodyAssessment.findUniqueOrThrow({
      where: { id },
      include: { photos: { select: photoSelect } },
    });
    return publicAssessment(entry);
  });
  await invalidateProgress(userId);
  return saved;
}
export async function deleteBodyEntry(userId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    const entry = await tx.bodyAssessment.findFirst({
      where: { id, userId },
      include: { photos: true },
    });
    if (!entry) throw new BodyError(404, "Body entry not found.");
    await queuePhotoDeletion(tx, entry.photos);
    await tx.bodyAssessment.delete({ where: { id: entry.id } });
  });
  await flushBodyPhotoDeletions();
  await invalidateProgress(userId);
}
export async function deleteBodyPhotos(userId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    const entry = await tx.bodyAssessment.findFirst({
      where: { id, userId, status: "SAVED" },
      include: { photos: true },
    });
    if (!entry) throw new BodyError(404, "Body entry not found.");
    await queuePhotoDeletion(tx, entry.photos);
    await tx.bodyAssessmentPhoto.deleteMany({
      where: { assessmentId: entry.id },
    });
    await tx.bodyAssessment.update({
      where: { id: entry.id },
      data: {
        quality: json({
          ...(entry.quality as object),
          photoRetention: "deleted",
          photoSaveConsent: false,
          photosDeletedAt: new Date().toISOString(),
        }),
      },
    });
  });
  await flushBodyPhotoDeletions();
  await invalidateProgress(userId);
  return getAssessment(userId, id);
}
export async function refreshBodyFocus(
  userId: string,
  id: string,
  input: z.infer<typeof refreshBodyFocusSchema>,
  coach: typeof coachBodyMeasurements = coachBodyMeasurements,
) {
  const started = performance.now();
  const original = await prisma.bodyAssessment.findFirst({
    where: { id, userId, status: "SAVED" },
    include: { photos: true },
  });
  if (!original) throw new BodyError(404, "Body entry not found.");
  if (original.updatedAt.toISOString() !== input.expectedUpdatedAt)
    throw new BodyError(
      409,
      "This assessment changed. Reopen it before updating the report.",
    );
  const profile = await prisma.onboarding.findUnique({
    where: { userId },
    select: {
      language: true,
      age: true,
      height: true,
      weight: true,
      gender: true,
      workingToward: true,
      experience: true,
      focusMuscles: true,
      limitations: true,
      equipment: true,
      equipmentIds: true,
    },
  });
  if (!profile)
    throw new BodyError(422, "Complete your profile before requesting a body review.");
  if (profile.age < 18)
    throw new BodyError(422, "Body review is available to members aged 18 and over.");
  const metrics = metricsSchema.parse(original.metrics);
  if (original.method === "photo_review") {
    if (!input.consentToVisualCoaching || !original.photos.length)
      throw new BodyError(422, "Add a new photo review with consent to AI analysis. Photos that were not saved cannot be reviewed again.");
    const photos = decodePhotos(await Promise.all(original.photos.map(async p => ({
      view: p.view as (typeof VIEWS)[number], mimeType: p.mimeType,
      base64: (await readBodyPhoto(p)).toString("base64"),
    }))));
    const previousReadings = (original.quality as any)?.physiqueAssessment?.dashboard?.readings;
    const analysis = await analyzePhysiquePhotos(photos, profile, undefined, undefined, {visualCoaching: true,
      compositionReadings: previousReadings});
    if (analysis.focusStatus !== "ready")
      throw new BodyError(503, "Photo analysis is unavailable right now. Your saved review has been kept. Try again later.");
    const update = await prisma.bodyAssessment.updateMany({
      where: {id, userId, status: "SAVED", updatedAt: original.updatedAt},
      data: {summary: analysis.result.summary, observations: [], quality: json({
        ...(original.quality as object), notes: analysis.result.qualityNotes,
        physiqueAssessment: analysis.physiqueAssessment, bodyRegions: [],
        focusStatus: "ready", focusBasis: "photo_observations_only", focusUnavailableReason: null,
        visualCoachingConsent: true, visualCoachingUsed: true,
        coachingModel: analysis.coachingModel, processing: analysis.processing,
      })},
    });
    if (!update.count) throw new BodyError(409, "This scan changed while updating. Reopen it to see the latest review.");
    await invalidateProgress(userId);
    return getAssessment(userId, id);
  }
  const today = new Date(Date.now() + input.utcOffsetMinutes * 60000)
    .toISOString()
    .slice(0, 10);
  const training = await getTrainingMap(userId, today, input.utcOffsetMinutes);
  const context = training.regions.map((r) => ({
    id: r.id,
    completedSets: r.completedSets,
    targetSets: r.targetSets,
    soreness: r.soreness,
  }));
  const photos =
    input.consentToVisualCoaching && original.photos.length === 4
      ? decodePhotos(
          await Promise.all(
            original.photos.map(async (p) => ({
              view: p.view as (typeof VIEWS)[number],
              mimeType: p.mimeType,
              base64: (await readBodyPhoto(p)).toString("base64"),
            })),
          ),
        )
      : [];
  let coached,
    visualUsed = false;
  const coachingStarted = performance.now();
  try {
    coached = await coach(
      metrics,
      { ...profile, weight: metrics.weightKg?.value ?? profile.weight ?? undefined },
      context,
      photos,
    );
    visualUsed = photos.length === 4;
  } catch (error) {
    if (
      !photos.length ||
      (error instanceof BodyCoachingError && !error.allowContextFallback)
    )
      throw error;
    coached = await coach(
      metrics,
      { ...profile, weight: metrics.weightKg?.value ?? profile.weight ?? undefined },
      context,
      [],
    );
  }
  const aiMs = Math.round(performance.now() - coachingStarted);
  const quality = original.quality as Record<string, unknown>;
  const notes = Array.isArray(quality.notes)
    ? quality.notes.filter(
        (n) =>
          typeof n === "string" &&
          !n.startsWith("Focus suggestions are unavailable") &&
          !n.startsWith("Photo context was unavailable."),
      )
    : [];
  if (photos.length && !visualUsed)
    notes.push(
      "Photo context was unavailable. Suggestions use your goals, training and available measurements.",
    );
  const update = await prisma.bodyAssessment.updateMany({
    where: { id, userId, status: "SAVED", updatedAt: original.updatedAt },
    data: {
      summary: coached.summary,
      observations: json(coached.observations),
      quality: json({
        ...quality,
        notes,
        bodyRegions: coached.regionalGuidance,
        coachingModel: coached.modelVersion,
        focusStatus: "ready",
        focusUnavailableReason: null,
        physiqueAssessment: coached.physiqueAssessment,
        bodyComposition: bodyCompositionReport(metrics),
        measurementAnalysis: measurementReport(
          metrics,
          original.method === "entered" ? null : original.modelVersion,
          notes,
        ),
        processing: {
          operation: "report_refresh",
          measurementReused: true,
          measurementMs: null,
          aiMs,
          totalMs: Math.round(performance.now() - started),
        },
        focusBasis: visualUsed
          ? "photos_profile_and_training"
          : "profile_measurements_and_training",
        visualCoachingConsent: input.consentToVisualCoaching,
        analysisProvider: input.analysisProvider,
        visualCoachingUsed: visualUsed,
        coachingRefreshedDate: today,
      }),
    },
  });
  if (!update.count)
    throw new BodyError(
      409,
      "This assessment changed while updating. Reopen it to see the latest result.",
    );
  return getAssessment(userId, id);
}
export async function getBodyComparison(
  userId: string,
  currentId: string,
  previousId: string,
) {
  if (currentId === previousId)
    throw new BodyError(400, "Choose two different entries.");
  const saved = await prisma.bodyAssessment.findMany({
    where: { userId, status: "SAVED", id: { in: [currentId, previousId] } },
    include: { photos: { select: photoSelect } },
  });
  const records = saved.filter(isRealBodyEntry);
  const current = records.find((record) => record.id === currentId),
    previous = records.find((record) => record.id === previousId);
  if (!current || !previous)
    throw new BodyError(404, "One of these entries is unavailable.");
  if (current.method === "photo_review" &&
      (!current.photos.length || !previous.photos.length ||
       !current.photos.some(photo => previous.photos.some(before => before.view === photo.view))))
    throw new BodyError(400, "Photo comparison needs two saved scans with a matching view.");
  if (
    previous.recordedDate > current.recordedDate ||
    (previous.recordedDate === current.recordedDate &&
      previous.createdAt >= current.createdAt)
  )
    throw new BodyError(400, "The baseline must be an earlier entry.");
  const metrics = metricsSchema.parse(current.metrics);
  const comparison = compareMetrics(
    metrics,
    metricsSchema.parse(previous.metrics),
    current.modelVersion === previous.modelVersion &&
      current.analysisVersion === previous.analysisVersion,
  );
  return {
    current: publicAssessment(current),
    previous: publicAssessment(previous),
    metrics: comparison,
    regions: regionalChange(metrics, comparison),
  };
}

type ReviewJob = {
  id: string;
  userId: string;
  status: "processing" | "ready" | "failed" | "cancelled";
  stage?: BodyAnalysisStage;
  createdAt: number;
  assessmentId?: string;
  error?: string;
};
const jobs = new Map<string, ReviewJob>();
export function getReviewJob(userId: string, id: string) {
  const job = jobs.get(id);
  if (!job || job.userId !== userId || Date.now() - job.createdAt > 15 * 60000)
    throw new BodyError(404, "Photo review expired. Please start again.");
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    assessmentId: job.assessmentId,
    error: job.error,
  };
}
export async function cancelReviewJob(userId: string, id: string) {
  const job = jobs.get(id);
  if (!job || job.userId !== userId)
    throw new BodyError(404, "Photo review not found.");
  if (job.status === "ready") return; // Leaving a completed result never deletes it.
  job.status = "cancelled";
  if (job.assessmentId) await deleteBodyEntry(userId, job.assessmentId);
}
export async function startBodyReview(
  userId: string,
  input: z.infer<typeof reviewSchema>,
  analyze: (photos: ReturnType<typeof decodePhotos>, profile: Parameters<typeof analyzeBodyPhotos>[1],
    weightKg: number | undefined, training: unknown, options: Parameters<typeof analyzeBodyPhotos>[4]) => ReturnType<typeof analyzeBodyPhotos> = analyzePhysiquePhotos,
) {
  for (const [id, job] of jobs)
    if (Date.now() - job.createdAt > 15 * 60000) jobs.delete(id);
  if (
    [...jobs.values()].some(
      (job) => job.userId === userId && job.status === "processing",
    )
  )
    throw new BodyError(429, "Your photo review is already processing.");
  const profile = await prisma.onboarding.findUnique({
    where: { userId },
    select: {
      language: true,
      age: true,
      height: true,
      weight: true,
      gender: true,
      workingToward: true,
      experience: true,
      focusMuscles: true,
      limitations: true,
      equipment: true,
      equipmentIds: true,
    },
  });
  if (!profile)
    throw new BodyError(422, "Complete your profile before starting a photo review.");
  if (profile.age < 18)
    throw new BodyError(
      422,
      "Photo review is available to members aged 18 and over.",
    );
  if (input.weightKg !== undefined && input.weightSource === "profile" && input.weightKg !== profile.weight)
    throw new BodyError(
      400,
      "Profile weight changed. Reopen this form or enter a current scale reading.",
    );
  if (input.compositionReadings?.muscleMassKg !== undefined && (input.weightKg ?? profile.weight) != null && input.compositionReadings.muscleMassKg >= (input.weightKg ?? profile.weight)!)
    throw new BodyError(422, 'Skeletal muscle mass must be less than your body weight. Check the reading and units.');
  const photos = decodePhotos(input.photos);
  const stale = await prisma.bodyAssessment.findMany({
    where: {
      userId,
      status: "REVIEW",
      createdAt: { lt: new Date(Date.now() - 24 * 3600000) },
    },
    select: { id: true },
  });
  for (const entry of stale) await deleteBodyEntry(userId, entry.id);
  // Recheck after asynchronous validation so two simultaneous requests cannot both start.
  if (
    [...jobs.values()].some(
      (job) => job.userId === userId && job.status === "processing",
    )
  )
    throw new BodyError(429, "Your photo review is already processing.");
  const job: ReviewJob = {
    id: randomUUID(),
    userId,
    status: "processing",
    stage: "outlines",
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  void (async () => {
    let stored: StoredBodyPhoto[] = [];
    try {
      const analysis = await analyze(
        photos,
        profile,
        input.weightKg,
        undefined,
        {
          visualCoaching: input.consentToVisualCoaching,
          compositionReadings: input.compositionReadings,
          onStage: (stage) => {
            if (job.status === "processing") job.stage = stage;
          },
        },
      );
      const { result, modelVersion } = analysis;
      if (!result.usable)
        throw new BodyError(
          422,
          result.qualityNotes.join(" ") || "Retake clearer full-body photos.",
        );
      const metrics = {
        ...(analysis.measurementMetrics ??
          (input.weightKg === undefined ? {} : metricsFromVisual(result, input.weightKg))),
      };
      if (input.weightKg !== undefined) metrics.weightKg = { value: input.weightKg, source: input.weightSource };
      metricsSchema.parse(metrics);
      if (job.status === "cancelled" || jobs.get(job.id) !== job) return;
      job.stage = "saving";
      const id = randomUUID();
      if (input.savePhotos) stored = await prepareBodyPhotos(id, photos);
      if ((job.status as string) === "cancelled") {
        await discardPreparedPhotos(stored);
        return;
      }
      const entry = await prisma.$transaction(async (tx) => {
        const entry = await tx.bodyAssessment.create({
          data: {
            id,
            userId,
            recordedDate: input.recordedDate,
            status: "REVIEW",
            metrics: json(metrics),
            method: "photo_review",
            observations: json(result.observations),
            quality: json({
              notes: result.qualityNotes,
              estimatesAreValidated: false,
              originalMetrics: metrics,
              coachingModel: analysis.coachingModel ?? null,
              measurementMethod: "none_visual_review",
              weightSource: input.weightSource,
              measurementStatus: ["chestCm", "waistCm", "hipsCm"].every(
                (k) => k in metrics,
              )
                ? "available"
                : Object.keys(metrics).some((k) => k !== "weightKg")
                  ? "partial"
                  : "unavailable",
              unavailableMeasurements: ["chestCm", "waistCm", "hipsCm"].filter(
                (k) => !(k in metrics),
              ),
              focusStatus:
                analysis.focusStatus ??
                (result.observations.length ? "ready" : "unavailable"),
              focusBasis:
                analysis.focusBasis ?? "photo_observations_only",
              focusUnavailableReason: analysis.focusUnavailableReason ?? null,
              bodyRegions: analysis.regionalGuidance ?? [],
              physiqueAssessment: analysis.physiqueAssessment,
              bodyComposition: bodyCompositionReport(metrics),
              measurementAnalysis: measurementReport(
                metrics,
                modelVersion,
                result.qualityNotes,
              ),
              processing: analysis.processing,
              inputSnapshot: {
                heightCm: profile.height,
                weightKg: input.weightKg,
                weightSource: input.weightSource,
                age: profile.age,
                gender: profile.gender,
                goal: profile.workingToward,
              },
              photoRetention: input.savePhotos ? "saved" : "not_saved",
              photoSaveConsent: input.savePhotos,
              photoSaveConsentAt: input.savePhotos
                ? new Date().toISOString()
                : null,
              visualCoachingConsent: input.consentToVisualCoaching,
        analysisProvider: input.analysisProvider,
              visualCoachingUsed:
                analysis.coachingModel != null &&
                analysis.focusBasis === "photo_observations_only",
            }),
            summary: result.summary,
            analysisVersion: analysis.physiqueAssessment?.version ?? "physique-v3",
            modelVersion,
            heightCm: profile.height,
            gender: profile.gender,
            photos: { create: stored },
          },
        });
        await attachPreparedPhotos(tx, stored);
        return entry;
      });
      job.assessmentId = entry.id;
      if ((job.status as string) === "cancelled") {
        await deleteBodyEntry(userId, entry.id);
        return;
      }
      const saved = await prisma.bodyAssessment.updateMany({
        where: { id: entry.id, userId, status: "REVIEW" },
        data: { status: "SAVED" },
      });
      await invalidateProgress(userId);
      if ((job.status as string) === "cancelled" || !saved.count) return;
      job.status = "ready";
      console.info("Body estimate completed", {
        jobId: job.id,
        measurementCount: Object.keys(metrics).filter((k) => k !== "weightKg")
          .length,
        focusStatus: analysis.focusStatus ?? "legacy",
        regionalCount: analysis.physiqueAssessment?.regions.length ?? 0,
        photosUsed: analysis.physiqueAssessment?.photosUsed ?? 0,
        processing: analysis.processing,
      });
    } catch (error) {
      if (!job.assessmentId)
        await discardPreparedPhotos(stored).catch(() => {});
      if (job.status === "cancelled") return;
      job.status = "failed";
      job.error =
        error instanceof BodyError
          ? error.message
          : "Could not complete the photo review. Please try again.";
    }
  })();
  return { jobId: job.id };
}
