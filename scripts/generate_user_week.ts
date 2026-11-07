import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import prisma from "../config/prisma";
import { requestPlan, saveCompletedPlan } from "../graphworkflow/service";
import { claimPlanRun, recordPlanFailure } from "../graphworkflow/run_queue";
import { reportPlanProgress } from "../graphworkflow/progress";
import { buildWeeklyGraph } from "../graphworkflow/graph";
import { createStructuredModel } from "../graphworkflow/common/model";
import { plannerSnapshot } from "../graphworkflow/common/measurements";
import { requireCompletedPlan, Snapshot } from "../graphworkflow/common/types";
import { validatePlan } from "../graphworkflow/nodes/validation_node";
import { assertPremium } from "../modules/subscription/subscription_service";

const args = process.argv.slice(2);
const option = (name: string) => args[args.indexOf(name) + 1];
async function main() {
  const email = option("--email"), week = option("--week"), timezone = option("--timezone") || "Asia/Kolkata";
  if (!args.includes("--email") || !args.includes("--week") || !email || !/^\d{4}-\d{2}-\d{2}$/.test(week ?? ""))
    throw new Error("Provide --email, --week YYYY-MM-DD, and optionally --timezone.");
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  await assertPremium(user.id);
  const requested = await requestPlan(user.id, week!, timezone);
  console.log(JSON.stringify({ event: "requested", runId: requested.id, week, status: requested.status }));
  const lease = randomUUID();
  const run = await prisma.$transaction(db => claimPlanRun(db, lease, new Date(), requested.id));
  if (!run) throw new Error("This request is already running or completed. Inspect the printed run ID; do not create a duplicate.");
  const snapshot = plannerSnapshot(run.input as unknown as Snapshot);
  console.log(JSON.stringify({ event: "context", historyStart: snapshot.historyStart, cutoff: snapshot.cutoff,
    recoveryThrough: snapshot.recoveryCutoff, setCount: snapshot.sets.length, sessions: snapshot.sessions.length,
    measurementEntries: snapshot.measurements.length, recoveryEntries: snapshot.wellness.length,
    muscleCheckIns: snapshot.muscleCheckIns?.length ?? 0, candidates: snapshot.candidates.length,
    coverage: snapshot.coverage, previousProgramme: !!snapshot.programmeMemory }));
  const heartbeat = setInterval(() => {
    void prisma.weeklyPlanRun.updateMany({ where: { id: run.id, status: "RUNNING", leaseToken: lease },
      data: { leaseUntil: new Date(Date.now() + 180000) } }).catch(() => {});
  }, 30000);
  heartbeat.unref();
  try {
    const graph = buildWeeklyGraph({
      model: createStructuredModel(120000, 3, failure => console.log(JSON.stringify({ event: "model_retry", ...failure }))),
      stage: async (stage, step) => {
        await reportPlanProgress(run.id, lease, stage, step);
        console.log(JSON.stringify({ event: "progress", stage, step }));
      },
    });
    // Use the actual model graph. A provider outage must not silently substitute
    // a rules-only week in this explicitly requested model-quality review.
    const plan = requireCompletedPlan(await graph.invoke({ snapshot, regions: {} }, { maxConcurrency: 3, recursionLimit: 20 }));
    validatePlan(snapshot, plan);
    const saved = await saveCompletedPlan(run.id, plan, lease);
    const persisted = await prisma.weeklyPersonalPlan.findUniqueOrThrow({ where: { id: saved.id } });
    const savedPayload = persisted.payload as unknown as typeof plan;
    const dir = path.resolve("build", "planner-review", week!);
    fs.mkdirSync(dir, { recursive: true });
    const base = path.join(dir, saved.id);
    fs.writeFileSync(base + ".json", JSON.stringify(savedPayload, null, 2));
    const lines = [
      "# Weekly plan: " + week, "",
      "Saved plan: " + saved.id, "Status: " + persisted.status, "Model: " + persisted.model,
      "Timezone: " + timezone, "",
      "## Context used", "",
      "Goal: " + snapshot.profile.goal + "; experience: " + snapshot.profile.experience + ".",
      "History: " + snapshot.historyStart + " to " + snapshot.cutoff + "; " + snapshot.sets.length + " logged sets across " + snapshot.coverage.loggedDays + " days.",
      "Measurements: " + snapshot.measurements.length + " entered records. Current recovery through " + (snapshot.recoveryCutoff ?? snapshot.cutoff) + ".",
      "Focus muscles: " + snapshot.profile.focusMuscles.join(", ") + ".", "",
      "## Plan", "", savedPayload.summary, "",
    ];
    for (const day of savedPayload.workouts) {
      lines.push("### " + day.date + " - " + day.name, "");
      if (day.restDay) { lines.push("Rest day.", ""); continue; }
      lines.push("Estimated duration: " + day.estimatedMinutes + " minutes.", "");
      for (const exercise of day.exercises) {
        const doses = exercise.setPrescriptions.map(set => set.repsMax + " reps at " +
          (set.weightKg == null ? "a starting load to establish" : set.weightKg === 0 ? "bodyweight" : set.weightKg + " kg")).join("; ");
        lines.push("- **" + exercise.name + "**: " + doses + ". Load convention: " + exercise.weightUnit +
          "; target RPE " + exercise.targetRpe + "; rest " + exercise.restSeconds + " seconds.",
          "  - Reason: " + exercise.reason, "  - Progression: " + exercise.progression);
      }
      lines.push("");
    }
    lines.push("## Nutrition", "", "Status: " + savedPayload.nutrition.status, savedPayload.nutrition.reason, "");
    if (savedPayload.nutrition.targets) lines.push("Daily estimated targets: " + JSON.stringify(savedPayload.nutrition.targets), "");
    lines.push("## Warnings", "", ...savedPayload.warnings.map(warning => "- " + warning), "");
    lines.push("## Logged performance used for chosen exercises", "");
    const chosen = new Set(savedPayload.workouts.flatMap(day => day.exercises.map(exercise => exercise.exerciseId)));
    for (const id of chosen) {
      const sets = snapshot.sets.filter(set => set.exerciseId === id);
      if (!sets.length) continue;
      const latest = sets.map(set => set.date).sort().at(-1)!;
      const exercise = savedPayload.workouts.flatMap(day => day.exercises).find(exercise => exercise.exerciseId === id)!;
      lines.push("- " + exercise.name + " (" + latest + "): " + sets.filter(set => set.date === latest)
        .map(set => set.reps + " reps, " + (set.weight == null ? "unknown load" : set.weight + " kg") + ", RPE " + (set.rpe ?? "not logged")).join("; ") + ".");
    }
    fs.writeFileSync(base + ".md", lines.join("\n"));
    console.log(JSON.stringify({ event: "saved", planId: saved.id, runId: run.id, status: persisted.status,
      model: persisted.model, json: base + ".json", review: base + ".md",
      workouts: savedPayload.workouts.map(day => ({date: day.date, name: day.name, rest: day.restDay,
        minutes: day.estimatedMinutes, exercises: day.exercises.length, sets: day.exercises.reduce((sum,exercise)=>sum+exercise.sets,0)})),
      nutrition: savedPayload.nutrition.status, warnings: savedPayload.warnings }));
  } catch (error) {
    await recordPlanFailure(prisma, run.id, lease, run.attempts, error).catch(() => {});
    throw error;
  } finally { clearInterval(heartbeat); }
}
main().catch(error => {
  console.error(JSON.stringify({ event: "failed", code: error.code || error.name, message: error.message }));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
