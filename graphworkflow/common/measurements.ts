import { Snapshot, PlannerError, dateInZone } from "./types";

const SOURCES = new Set(["tape", "scale", "smart_scale", "dexa", "calipers"]);
type Metric = { value: number; source: string };

// The planner accepts entered measurements, never image-derived assessments or
// their prose/guidance. Keep independent readings so a new weight-only entry
// cannot hide a previous circumference measurement.
export function enteredMeasurements(
  rows: Snapshot["measurements"],
): Snapshot["measurements"] {
  return rows
    .map((row) => ({
      id: row.id,
      date: row.date,
      source: "entered",
      metrics: Object.fromEntries(
        Object.entries((row.metrics ?? {}) as Record<string, Metric>).filter(
          ([, metric]) =>
            metric &&
            Number.isFinite(metric.value) &&
            SOURCES.has(metric.source),
        ),
      ),
    }))
    .filter((row) => Object.keys(row.metrics).length > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function measurementContext(snapshot: Snapshot, keys: string[]) {
  const rows = enteredMeasurements(snapshot.measurements);
  const metrics: Record<string, unknown> = {};
  for (const key of keys) {
    const readings = rows.filter(
      (row) => !!(row.metrics as Record<string, Metric>)[key],
    );
    const latest = readings[0];
    if (!latest) continue;
    const metric = (latest.metrics as Record<string, Metric>)[key]!;
    const prior = readings.find(
      (row) =>
        row.date < latest.date &&
        (row.metrics as Record<string, Metric>)[key]?.source === metric.source,
    );
    const before = prior && (prior.metrics as Record<string, Metric>)[key];
    metrics[key] = {
      ...metric,
      recordedDate: latest.date,
      evidenceId: latest.id,
      ...(before && {
        change: Math.round((metric.value - before.value) * 10) / 10,
        since: prior!.date,
        previousEvidenceId: prior!.id,
      }),
    };
  }
  return Object.keys(metrics).length
    ? {
        metrics,
        interpretation:
          "Optional measurements describe size trends, not strength or isolated muscle weakness.",
      }
    : null;
}

export function plannerSnapshot(snapshot: Snapshot): Snapshot {
  const { freshPhotos: _photos, ...rest } = snapshot;
  // Imported wearable/Health readings are not disclosed to the external planner,
  // including recovery summaries derived from them. Keep only manual check-ins.
  return { ...rest, health: [], wellness: rest.wellness.filter(row=>['self_report','phone_estimate_confirmed'].includes(row.source)), measurements: enteredMeasurements(rest.measurements) };
}

export function textOnlyPlannerInput(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(textOnlyPlannerInput);
  if (input == null || typeof input !== "object") return input;
  return Object.fromEntries(
    Object.entries(input)
      .filter(
        ([key]) =>
          ![
            "photos",
            "freshPhotos",
            "base64Data",
            "inlineData",
            "regionalGuidance",
            "guidance",
          ].includes(key),
      )
      .map(([key, value]) => [key, textOnlyPlannerInput(value)]),
  );
}

export function missingMeasurementBaseline(snapshot: Pick<Snapshot, "profile" | "measurements" | "timezone">) {
  const today = dateInZone(snapshot.timezone);
  const rows = enteredMeasurements(snapshot.measurements).filter(row => row.date <= today);
  const has = (key: string, min: number, max: number, sources: string[]) =>
    rows.some(row => {
      const metric = (row.metrics as Record<string, Metric>)[key];
      return metric && sources.includes(metric.source) &&
        metric.value >= min && metric.value <= max;
    });
  return [
    ...(snapshot.profile.height == null || !Number.isFinite(snapshot.profile.height) || snapshot.profile.height < 100 ||
      snapshot.profile.height > 250 ? ["height"] : []),
    ...(!has("weightKg", 20, 500, ["scale", "smart_scale"]) ? ["weightKg"] : []),
    ...(!has("waistCm", 30, 250, ["tape"]) ? ["waistCm"] : []),
  ];
}

export function assertMeasurementBaseline(snapshot: Pick<Snapshot, "profile" | "measurements" | "timezone">) {
  const missingMeasurements = missingMeasurementBaseline(snapshot);
  if (missingMeasurements.length) throw new PlannerError(
    "MEASUREMENTS_REQUIRED",
    "Complete your height, weight and waist measurements before creating your plan.",
    422,
    { missingMeasurements },
  );
}
