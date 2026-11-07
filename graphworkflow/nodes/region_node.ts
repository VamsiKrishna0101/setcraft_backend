import { PlannerState, StageReporter } from "../common/state";
import { StructuredModel } from "../common/model";
import { Region, RegionalResult, regionalChoiceSchema } from "../common/types";
import { buildRegionalResult } from "./validation_node";
import { COMMON_RULES, plannerLanguage } from "../common/prompts";
import { experiencePrompt } from "../common/coaching";

// Region-specific coaching focus. Merged into the front of the shared prompt.
const REGION_FOCUS: Record<Region, string> = {
  chest: `You are the chest programming specialist.
Consider upper_chest incline pressing, flat pressing and adduction/fly patterns from the provided catalog. Retain successful familiar presses. Spread useful angles across the week rather than forcing four movements into one day. On full-body days usually one press is sufficient; on a dedicated chest day select complementary movements within the set/time budgets. Chest presses also load triceps and front delts; check adjacent shoulder/arm days. Prefer supported or grip-compatible options when stated limitations require them. Never infer upper-chest weakness or asymmetry from a photo.`,

  back: `You are the back programming specialist.
Cover vertical pulling for lats and horizontal rowing for upper_back across the week when equipment and limitations permit. Consider lower_back work only in the context of all leg hinges and squats. Keep a familiar row or pulldown when it has useful history. Supported rows can reduce demands on trunk support; they do not treat a diagnosis. Pulling already loads biceps and forearms. Do not infer spinal alignment, scapular pathology or muscle weakness from appearance.`,

  legs: `You are the lower-body programming specialist.
Balance knee-dominant/quads and hip-dominant/hamstrings/glutes patterns across available days; include knee flexion and calves when time allows. A leg region contains several muscles, so avoid repeating only squats. On full-body days alternate useful squat/hinge emphasis while keeping enough familiarity to measure progress. On dedicated days add complementary movements within the time and volume budgets. Choose complexity appropriate to actual history; do not force heavy spinal loading on a new lifter. Coordinate hinges with back days. Never infer knee tracking or force capacity from static body photos.`,

  shoulders: `You are the shoulder programming specialist.
Consider side_delts, rear_delts and front_delts. Chest pressing already trains front delts, so do not duplicate unnecessary presses. Use lateral or rear-delt work where it fills a genuine schedule gap, and keep isolation in its prescribed rep bracket. Respect shoulder limitations and available equipment. Do not diagnose rounded shoulders or prescribe corrective treatment from photos.`,

  biceps: `You are the biceps and forearm programming specialist.
Use a familiar curl and, when justified by available volume, a complementary grip such as hammer/neutral. Consider long_head, short_head and brachialis_forearms without promising isolation of a single head. Back pulling contributes indirect arm work, so reduce duplication on pull/full-body days. Respect elbow/wrist limitations. Exact reps and loads must follow the exercise history and prescriptionRules, never a visual arm-size judgement.`,

  triceps: `You are the triceps programming specialist.
Consider pushdown and overhead-extension patterns for lateral_medial_heads and long_head only when compatible with limitations. Presses already load triceps; account for chest and shoulder days before adding sets. Keep familiar exercises when they allow meaningful comparison. Do not force overhead work, dips or extra movements simply to cover an angle.`,

  core: `You are the trunk programming specialist.
Select dynamic flexion, controlled rotation or anti-rotation movements that fit the catalog and limitations. Heavy squats and hinges already demand bracing. Choose rep-counted dynamic exercises only: the stored set format measures reps and cannot honestly represent a timed plank. Do not output seconds as reps. Never promise spot fat reduction or infer core weakness/body fat from photos or waist size.`,
};

export function makeRegionPrompt(region: Region): string {
  return `${REGION_FOCUS[region]}\n\n${COMMON_RULES}`;
}

export function regionNode(
  region: Region,
  model: StructuredModel,
  reportStage: StageReporter = async () => {},
) {
  return async (state: PlannerState): Promise<Partial<PlannerState>> => {
    const assigned = state.schedule.some((day) => day.regions.includes(region));

    let result: RegionalResult;

    if (!assigned) {
      result = { days: [] };
    } else if (state.regions[region]) {
      // Checkpoint resume: reuse already-completed agent output.
      result = state.regions[region]!;
    } else {
      const input = state.inputs[region];
      const requiredDates = (input.days as Array<{ date: string }>).map(
        (day) => day.date,
      );
      const prompt =
        makeRegionPrompt(region) +
        "\n\n" +
        experiencePrompt(state.snapshot) +
        "\n\n" +
        plannerLanguage(state.snapshot.profile.language) +
        `\nEXACT OUTPUT CONTRACT: Return ${requiredDates.length} dated entries for ${region}: ${requiredDates.join(", ")}. Every listed date needs at least one eligible exercise. Do not return just the first date, leave later exercises empty, or add dates belonging only to other regions.`;

      const choice = await model(
        regionalChoiceSchema.extend({
          days: regionalChoiceSchema.shape.days.length(requiredDates.length),
        }),
        prompt,
        input,
        (choice) => {
          buildRegionalResult(state.snapshot, state.schedule, region, choice);
        },
      );

      result = buildRegionalResult(
        state.snapshot,
        state.schedule,
        region,
        choice,
      );
    }

    await reportStage(
      "specialists",
      region as import("../progress").PlannerStep,
    );

    return { regions: { [region]: result } };
  };
}
