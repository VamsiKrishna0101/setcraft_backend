import prisma from "../../config/prisma";
import {
  HeatmapComparisonResponse,
  MorphometricDeltas,
  RegionComparison,
  ScanMetricsSnapshot,
  TrainingFocusComparison,
  TrainingFocusRegionComparison,
} from "./heatmap_types";

const DISPLAY_MARGIN_CM = 4;

function numeric(value: unknown, name: string, scanId: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Cannot compare scans: ${name} is missing from scan ${scanId}.`);
  }
  return value;
}

function extractSnapshot(scan: any): ScanMetricsSnapshot {
  const waistCm = numeric(scan.waistCircumference, "waist measurement", scan.id);
  const shoulderWidthCm = numeric(scan.shoulderWidth, "shoulder measurement", scan.id);
  return {
    scanId: scan.id,
    scanDate: scan.scanDate,
    chestCm: numeric(scan.chestCircumference, "chest measurement", scan.id),
    waistCm,
    hipCm: numeric(scan.hipCircumference, "hip measurement", scan.id),
    leftBicepCm: numeric(scan.bicepLeftCircumference, "left upper-arm measurement", scan.id),
    rightBicepCm: numeric(scan.bicepRightCircumference, "right upper-arm measurement", scan.id),
    leftThighCm: numeric(scan.thighLeftCircumference, "left thigh measurement", scan.id),
    rightThighCm: numeric(scan.thighRightCircumference, "right thigh measurement", scan.id),
    shoulderWidthCm,
    vTaperRatio: typeof scan.vTaperRatio === "number" && Number.isFinite(scan.vTaperRatio)
      ? scan.vTaperRatio
      : shoulderWidthCm / (waistCm * 0.38),
  };
}

function difference(after: number, before: number): number { return Number((after - before).toFixed(1)); }

function computeDeltas(before: ScanMetricsSnapshot, after: ScanMetricsSnapshot): MorphometricDeltas {
  const beforeArmGap = Math.abs(before.leftBicepCm - before.rightBicepCm);
  const afterArmGap = Math.abs(after.leftBicepCm - after.rightBicepCm);
  return {
    waistChangeCm: difference(after.waistCm, before.waistCm),
    chestChangeCm: difference(after.chestCm, before.chestCm),
    hipChangeCm: difference(after.hipCm, before.hipCm),
    leftBicepChangeCm: difference(after.leftBicepCm, before.leftBicepCm),
    rightBicepChangeCm: difference(after.rightBicepCm, before.rightBicepCm),
    leftThighChangeCm: difference(after.leftThighCm, before.leftThighCm),
    rightThighChangeCm: difference(after.rightThighCm, before.rightThighCm),
    armGapChangeCm: difference(afterArmGap, beforeArmGap),
    vTaperShift: Number((after.vTaperRatio - before.vTaperRatio).toFixed(2)),
  };
}

function compareRegion(
  region: string,
  before: number,
  after: number,
): RegionComparison {
  const changeCm = difference(after, before);
  return {
    region,
    beforeCm: Number(before.toFixed(1)),
    afterCm: Number(after.toFixed(1)),
    changeCm,
    uncertaintyCm: DISPLAY_MARGIN_CM,
    status: Math.abs(changeCm) > DISPLAY_MARGIN_CM ? "CHANGE_EXCEEDS_MARGIN" : "WITHIN_MARGIN",
    beforeVisualBand: null,
    afterVisualBand: null,
  };
}

function focusRegions(scan: any): { weekLabel: string | null; regions: Map<string, any> } | null {
  const focus = scan?.scanAnalysis?.trainingFocus;
  if (!focus || focus.source !== "weekly_workout_plan" || !Array.isArray(focus.regions)) return null;
  const regions = new Map<string, any>();
  for (const region of focus.regions) {
    if (typeof region?.id === "string") regions.set(region.id, region);
  }
  return regions.size ? { weekLabel: typeof focus.weekLabel === "string" ? focus.weekLabel : null, regions } : null;
}

function finiteOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function makeTrainingFocusComparison(beforeScan: any, afterScan: any): TrainingFocusComparison {
  const before = focusRegions(beforeScan);
  const after = focusRegions(afterScan);
  if (!before || !after) {
    return {
      available: false,
      beforeWeekLabel: before?.weekLabel ?? null,
      afterWeekLabel: after?.weekLabel ?? null,
      note: "Both scans need a saved workout-plan focus map. Older scans do not contain this data.",
      regions: [],
    };
  }

  const regions: TrainingFocusRegionComparison[] = [...new Set([...before.regions.keys(), ...after.regions.keys()])]
    .map(regionId => {
      const old = before.regions.get(regionId), current = after.regions.get(regionId);
      const oldRatio = typeof old?.completionRatio === "number" && Number.isFinite(old.completionRatio) ? old.completionRatio : null;
      const currentRatio = typeof current?.completionRatio === "number" && Number.isFinite(current.completionRatio) ? current.completionRatio : null;
      return {
        regionId,
        label: String(current?.label ?? old?.label ?? regionId),
        beforeStatus: String(old?.status ?? "no_plan"),
        afterStatus: String(current?.status ?? "no_plan"),
        beforeCompletionRatio: oldRatio,
        afterCompletionRatio: currentRatio,
        completionRatioChange: oldRatio !== null && currentRatio !== null
          ? Number((currentRatio - oldRatio).toFixed(3))
          : null,
        beforePlannedSets: finiteOrZero(old?.plannedSets),
        afterPlannedSets: finiteOrZero(current?.plannedSets),
        beforeCompletedSets: finiteOrZero(old?.completedSets),
        afterCompletedSets: finiteOrZero(current?.completedSets),
      };
    });
  return {
    available: true,
    beforeWeekLabel: before.weekLabel,
    afterWeekLabel: after.weekLabel,
    note: "This compares logged sets against each scan's current-week plan. It describes training-plan coverage, not changes in muscle size, strength, or body fat.",
    regions,
  };
}

// Comparison reports measurement deltas only; the scan heatmap reports workout-plan coverage.
export async function compareScans(
  userId: string,
  scan1Id?: string,
  scan2Id?: string,
): Promise<HeatmapComparisonResponse> {
  let scan1: any, scan2: any;
  if (scan1Id && scan2Id) {
    [scan1, scan2] = await Promise.all([
      prisma.bodyScan.findFirst({ where: { id: scan1Id, userId } }),
      prisma.bodyScan.findFirst({ where: { id: scan2Id, userId } }),
    ]);
  } else {
    const recent = await prisma.bodyScan.findMany({ where: { userId }, orderBy: { scanDate: "desc" }, take: 2 });
    if (recent.length < 2) throw new Error("Two completed scans are required to compare body changes.");
    scan2 = recent[0];
    scan1 = recent[1];
  }
  if (!scan1 || !scan2) throw new Error("Could not find the requested body scans for comparison.");

  const before = extractSnapshot(scan1), after = extractSnapshot(scan2);
  const rawDeltas = computeDeltas(before, after);
  const ms = Math.abs(new Date(after.scanDate).getTime() - new Date(before.scanDate).getTime());
  const daysBetween = Math.max(1, Math.round(ms / 86_400_000));
  const regionComparisons = [
    compareRegion("Chest", before.chestCm, after.chestCm),
    compareRegion("Abdomen / waist", before.waistCm, after.waistCm),
    compareRegion("Hips", before.hipCm, after.hipCm),
    compareRegion("Left upper arm", before.leftBicepCm, after.leftBicepCm),
    compareRegion("Right upper arm", before.rightBicepCm, after.rightBicepCm),
    compareRegion("Left thigh", before.leftThighCm, after.leftThighCm),
    compareRegion("Right thigh", before.rightThighCm, after.rightThighCm),
  ];

  const anthroComp = scan2.scanAnalysis?.comparison;
  const changedOutsideMargin = regionComparisons.filter(region => region.status === "CHANGE_EXCEEDS_MARGIN").length;
  const summaryParagraph = anthroComp?.summaryText ?? (changedOutsideMargin
    ? `${changedOutsideMargin} of 7 circumference estimates changed across ${daysBetween} days.`
    : `Measurements maintained within baseline variance across ${daysBetween} days.`);

  return {
    scan1Id: scan1.id,
    scan2Id: scan2.id,
    daysBetween,
    executiveVerdict: anthroComp ? "Anthropometric Progress Audit" : "Mesh measurement estimates compared",
    transformationScore: typeof anthroComp?.progressScore === "number" ? anthroComp.progressScore : 0,
    summaryParagraph,
    heatmapColorExplanations: [
      { region: "Green", color: "Green", meaning: "Measurement trimmed towards ideal benchmark (e.g. waist reduction)." },
      { region: "Cyan", color: "Cyan", meaning: "Hypertrophy growth (e.g. chest / quad increase)." },
      { region: "Slate", color: "Slate", meaning: "Maintained within baseline margin." },
      { region: "Amber", color: "Amber", meaning: "Unverified measurement flagged for protocol check." },
    ],
    partBreakdowns: regionComparisons.map(region => {
      const keyMap: Record<string, string> = {
        "Chest": "chest",
        "Abdomen / waist": "waist",
        "Hips": "hips",
        "Left upper arm": "left_bicep",
        "Right upper arm": "right_bicep",
        "Left thigh": "thighs",
        "Right thigh": "thighs",
      };
      const mDelta = anthroComp?.muscleDeltas?.[keyMap[region.region]];
      return {
        partName: region.region,
        changeCm: region.changeCm,
        beforeCm: region.beforeCm,
        afterCm: region.afterCm,
        uncertaintyCm: region.uncertaintyCm,
        status: mDelta?.tag ?? region.status,
        beforeVisualBand: region.beforeVisualBand,
        afterVisualBand: region.afterVisualBand,
        biologicalReason: mDelta?.feedback ?? (region.status === "WITHIN_MARGIN"
          ? `Estimated change is within ±${region.uncertaintyCm} cm baseline margin.`
          : `Circumference changed by ${region.changeCm > 0 ? "+" : ""}${region.changeCm} cm.`),
      };
    }),
    symmetryVerdict: anthroComp?.muscleDeltas?.left_bicep?.tag === "UNVERIFIED_MEASUREMENT"
      ? "Arm symmetry delta requires relaxed measurement protocol confirmation."
      : "Symmetry maintained within healthy proportional balance.",
    workoutAdjustments: [],
    rawDeltas,
    regionComparisons,
    trainingFocusComparison: makeTrainingFocusComparison(scan1, scan2),
  };
}
