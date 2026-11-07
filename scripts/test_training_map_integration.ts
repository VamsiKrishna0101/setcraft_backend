import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import prisma from "../config/prisma";
import heatmapRoutes from "../modules/heatmap/heatmap_routes";
import onboardingRoutes from "../modules/onboarding/onboarding_routes";
import { createOnboardingSchema, updateOnboardingSchema } from "../modules/onboarding/onboarding_types";

async function main() {
  const user = await prisma.user.findUnique({ where: { email: "vklvl0101@gmail.com" }, select: { id: true } });
  assert(user, "The requested test account exists");
  const app = express(); app.use(express.json());
  app.use("/api/heatmap", heatmapRoutes); app.use("/api/onboarding", onboardingRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const token = jwt.sign({ userId: user.id }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "2m" });
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const now = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  try {
    assert.equal((await fetch(base + `/api/heatmap/training?date=${now}&utcOffsetMinutes=330`)).status, 401);
    assert.equal((await fetch(base + "/api/onboarding", { headers: { authorization: "Bearer invalid" } })).status, 401);
    assert.equal((await fetch(base + "/api/heatmap/check-in", { method: "PUT", headers: { "content-type":"application/json" }, body: "{}" })).status, 401);
    assert.equal((await fetch(base + "/api/heatmap/training?date=2026-02-30&utcOffsetMinutes=330", { headers })).status, 400);
    assert.equal((await fetch(base + "/api/heatmap/check-in", { method: "PUT", headers, body: JSON.stringify({ date:now, utcOffsetMinutes:330, muscleId:"chest", soreness:4 }) })).status, 400);
    const response = await fetch(base + `/api/heatmap/training?date=${now}&utcOffsetMinutes=330&userId=not-the-caller`, { headers });
    assert.equal(response.status, 200);
    const result = await response.json() as { regions: unknown[]; date:string; summary:{loggedSets:number} };
    assert.equal(result.date, now); assert.equal(result.regions.length, 13);
    const normal = await fetch(base + `/api/heatmap/training?date=${now}&utcOffsetMinutes=330`, { headers });
    assert.deepEqual((await normal.json() as typeof result).summary, result.summary, "A query userId cannot change ownership");
    const profile = await fetch(base + "/api/onboarding", { headers }); assert.equal(profile.status,200);

    // Every synthetic database write is rolled back, including the temporary user.
    const marker = new Error("expected test rollback");
    const id = randomUUID();
    try {
      await prisma.$transaction(async tx => {
        await tx.user.create({ data: { id, email:`training-map-test-${id}@example.invalid`, password:"synthetic-unused-test-password" } });
        const payload = createOnboardingSchema.parse({ workingToward:"BUILD_MUSCLE", language:"fr", name:"Test member", age:26, gender:"FEMALE",
          height:170, weight:65, experience:"BEGINNER", daysPerWeek:"DAYS_3", workoutDuration:"MIN_30", trainingLocation:"HOME", equipment:["DUMBBELLS"],
          activityLevel:"MODERATE", sleepDuration:"HOURS_7_TO_8", eatingStyle:"VEGETARIAN", limitations:["KNEE"],
          focusMuscles:["glutes","quads"], trainingDays:["MONDAY","THURSDAY"], preferredTime:"EVENING", countryCode:"FR",
          customLimitations:"Synthetic movement note", foodAllergies:["peanuts"], dislikedFoods:["mushrooms"], foodBudgetAmount:80, foodBudgetCurrency:"EUR" });
        await tx.onboarding.create({data:{userId:id,...payload}});
        const patch = updateOnboardingSchema.parse({focusMuscles:["chest"]});
        const stored = await tx.onboarding.update({where:{userId:id},data:patch});
        assert.equal(stored.language,"fr"); assert.deepEqual(stored.limitations,["KNEE"]);
        assert.deepEqual(stored.trainingDays,["MONDAY","THURSDAY"]); assert.deepEqual(stored.foodAllergies,["peanuts"]);
        assert.equal(stored.foodBudgetAmount,80); assert.equal(stored.height,170);
        for (const soreness of [1,3]) await tx.muscleCheckIn.upsert({where:{userId_muscleId_date:{userId:id,muscleId:"chest",date:now}},
          create:{userId:id,muscleId:"chest",date:now,soreness},update:{soreness}});
        assert.equal(await tx.muscleCheckIn.count({where:{userId:id}}),1);
        assert.equal((await tx.muscleCheckIn.findFirstOrThrow({where:{userId:id}})).soreness,3);
        throw marker;
      },{timeout:15000});
    } catch(error) { if (error !== marker) throw error; }
    assert.equal(await prisma.user.count({where:{id}}),0, "Synthetic writes were rolled back");
    console.log("Live authenticated reads, caller ownership, validation and rollback-only preference/check-in persistence passed.");
    console.log(`Live map contains ${result.regions.length} regions and ${result.summary.loggedSets} logged sets for ${now}; no real user data changed.`);
  } finally { await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve())); }
}
main().catch(error => { console.error(error); process.exitCode=1; }).finally(() => prisma.$disconnect());
