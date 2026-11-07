import prisma from "../../../config/prisma";
import { realSnapshotWhere, isRealBodyEntry } from "../../../utils/real_data";
import { METRICS, METRIC_IDS } from "../../body/body_types";
import { inRange, progressRange } from "../progress_range";
import { Point, RangeQuery } from "../progress_types";
import { previewDays } from "../preview/preview_data";

type MetricPoint = Point & { id: string; source: string };

export async function getBodyProgress(owner: string, query: RangeQuery) {
  if (query.dataset === "preview") {
    const days = await previewDays(owner, query.date);
    const range = progressRange(query, days[0]?.date);
    return {
      range,
      profileBaseline: null,
      profileHeight: null,
      targetWeight: null,
      metrics: METRIC_IDS.map((id) => {
        const points = days
          .filter(
            (day) => inRange(day.date, range) && day.data.body[id] != null,
          )
          .map((day) => ({
            id: day.date,
            date: day.date,
            value: day.data.body[id]!,
            source: "preview",
          }));
        const change =
          points.length > 1
            ? Math.round((points.at(-1)!.value - points[0]!.value) * 10) / 10
            : null;
        return {
          id,
          label: METRICS[id].label,
          unit: METRICS[id].unit,
          latest: points.at(-1) ?? null,
          series: points.length ? [{ source: "preview", points, change }] : [],
        };
      }),
      assessments: [],
    };
  }
  const [savedAssessments, snapshots, profile] = await Promise.all([
    prisma.bodyAssessment.findMany({
      where: {
        userId: owner,
        status: "SAVED",
        recordedDate: { lte: query.date },
      },
      select: {
        id: true,
        recordedDate: true,
        metrics: true,
        quality: true,
        analysisVersion: true,
        method: true,
        createdAt: true,
        _count: { select: { photos: true } },
      },
      orderBy: [{ recordedDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.healthKitSnapshot.findMany({
      where: { userId: owner, date: { lte: query.date }, ...realSnapshotWhere },
      select: {
        id: true,
        date: true,
        weight: true,
        bodyFatPct: true,
        sourceProvider: true,
      },
      orderBy: { date: "asc" },
    }),
    prisma.onboarding.findUnique({
      where: { userId: owner },
      select: { weight: true, height: true, targetWeight: true },
    }),
  ]);
  const assessments = savedAssessments.filter(isRealBodyEntry);
  const earliest = [
    ...assessments.map((row) => row.recordedDate),
    ...snapshots.filter((row) => row.weight != null).map((row) => row.date),
  ].sort()[0];
  const range = progressRange(query, earliest);
  const metrics = METRIC_IDS.map((id) => {
    const points: MetricPoint[] = [];
    for (const snapshot of snapshots) {
      const value =
        id === "weightKg"
          ? snapshot.weight
          : id === "bodyFatPct"
            ? snapshot.bodyFatPct
            : null;
      if (value != null)
        points.push({
          id: snapshot.id,
          date: snapshot.date,
          value,
          source: "health_sync",
        });
    }
    for (const assessment of assessments) {
      const metric = (
        assessment.metrics as Record<
          string,
          { value?: number; source?: string; low?: number; high?: number }
        >
      )[id];
      if (
        metric?.value == null ||
        !Number.isFinite(metric.value) ||
        metric.source === "profile"
      )
        continue;
      points.push({
        id: assessment.id,
        date: assessment.recordedDate,
        value: metric.value,
        source: metric.source ?? "entered",
        low: metric.low,
        high: metric.high,
      });
    }
    const unique = new Map<string, MetricPoint>();
    for (const point of points.sort((a, b) => a.date.localeCompare(b.date)))
      unique.set(`${point.date}:${point.source}`, point);
    const selected = [...unique.values()].filter((point) =>
      inRange(point.date, range),
    );
    const sources = [...new Set(selected.map((point) => point.source))];
    const series = sources.map((source) => {
      const values = selected.filter((point) => point.source === source);
      const first = values[0];
      const latest = values.at(-1);
      return {
        source,
        points: values,
        change:
          values.length > 1
            ? Math.round((latest!.value - first!.value) * 10) / 10
            : null,
      };
    });
    return {
      id,
      label: METRICS[id].label,
      unit: METRICS[id].unit,
      latest: selected.at(-1) ?? null,
      series,
    };
  });
  return {
    range,
    profileBaseline: profile?.weight ?? null,
    profileHeight: profile?.height ?? null,
    targetWeight: profile?.targetWeight ?? null,
    metrics,
    assessments: assessments
      .filter((row) => inRange(row.recordedDate, range))
      .reverse()
      .map((row) => ({
        id: row.id,
        date: row.recordedDate,
        method: row.method,
        photoCount: row._count.photos,
        measurementCount: Object.keys(row.metrics as object).length,
      })),
  };
}
