import { z } from "zod";

// Request schema for comparing two scans
export const CompareScansRequestSchema = z.object({
  scan1Id: z.string().uuid().optional(),
  scan2Id: z.string().uuid().optional(),
});

export type CompareScansRequest = z.infer<typeof CompareScansRequestSchema>;

// Detailed physical snapshot of measurements at a specific scan point
export interface ScanMetricsSnapshot {
  scanId: string;
  scanDate: Date;
  chestCm: number;
  waistCm: number;
  hipCm: number;
  leftBicepCm: number;
  rightBicepCm: number;
  leftThighCm: number;
  rightThighCm: number;
  shoulderWidthCm: number;
  vTaperRatio: number;
}

// Numerical physical deltas between two scans
export interface MorphometricDeltas {
  waistChangeCm: number;
  chestChangeCm: number;
  hipChangeCm: number;
  leftBicepChangeCm: number;
  rightBicepChangeCm: number;
  leftThighChangeCm: number;
  rightThighChangeCm: number;
  armGapChangeCm: number;
  vTaperShift: number;
}

// Physical snapshots used for deterministic scan comparison.
export interface MorphometricDossier {
  before: ScanMetricsSnapshot;
  after: ScanMetricsSnapshot;
  deltas: MorphometricDeltas;
  daysBetween: number;
  userGoal: string;
}

// Explanation of what a color represents on the 3D heatmap
export interface HeatmapColorExplanation {
  region: string;
  color: string;
  meaning: string;
}

// Deep biological breakdown for an individual body part
export interface PartBreakdown {
  partName: string;
  changeCm: number;
  beforeCm: number;
  afterCm: number;
  uncertaintyCm: number;
  status: "WITHIN_MARGIN" | "CHANGE_EXCEEDS_MARGIN";
  beforeVisualBand: string | null;
  afterVisualBand: string | null;
  biologicalReason: string;
}

export interface RegionComparison {
  region: string;
  beforeCm: number;
  afterCm: number;
  changeCm: number;
  uncertaintyCm: number;
  status: "WITHIN_MARGIN" | "CHANGE_EXCEEDS_MARGIN";
  beforeVisualBand: string | null;
  afterVisualBand: string | null;
}

export interface TrainingFocusRegionComparison {
  regionId: string;
  label: string;
  beforeStatus: string;
  afterStatus: string;
  beforeCompletionRatio: number | null;
  afterCompletionRatio: number | null;
  completionRatioChange: number | null;
  beforePlannedSets: number;
  afterPlannedSets: number;
  beforeCompletedSets: number;
  afterCompletedSets: number;
}

export interface TrainingFocusComparison {
  available: boolean;
  beforeWeekLabel: string | null;
  afterWeekLabel: string | null;
  note: string;
  regions: TrainingFocusRegionComparison[];
}

// Structured AI comparison response sent to mobile Flutter client
export interface HeatmapComparisonResponse {
  scan1Id: string;
  scan2Id: string;
  daysBetween: number;
  executiveVerdict: string;
  transformationScore: number;
  summaryParagraph: string;
  heatmapColorExplanations: HeatmapColorExplanation[];
  partBreakdowns: PartBreakdown[];
  symmetryVerdict: string;
  workoutAdjustments: string[];
  rawDeltas: MorphometricDeltas;
  regionComparisons: RegionComparison[];
  trainingFocusComparison: TrainingFocusComparison;
}
