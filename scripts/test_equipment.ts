import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';
import onboardingRoutes from '../modules/onboarding/onboarding_routes';
import { createOnboardingSchema, updateOnboardingSchema } from '../modules/onboarding/onboarding_types';
import { equipmentCategories } from '../modules/onboarding/equipment_catalog';

// Disposable fixture only; never edit a real member's onboarding.
const userId = randomUUID();
const profile = createOnboardingSchema.parse({
  workingToward: 'BUILD_MUSCLE', name: 'Equipment fixture', age: 27, gender: 'MALE',
  height: 178, weight: 80, experience: 'BEGINNER', daysPerWeek: 'DAYS_3',
  workoutDuration: 'MIN_30', trainingLocation: 'GYM', equipment: ['MACHINES'],
  activityLevel: 'MODERATE', sleepDuration: 'HOURS_7_TO_8', eatingStyle: 'VEGETARIAN',
  limitations: ['KNEE'], focusMuscles: ['chest'], language: 'de',
});
assert.deepEqual(updateOnboardingSchema.parse({equipmentIds:['leg_curl']}), {equipmentIds:['leg_curl']});
assert.deepEqual(equipmentCategories(['leg_curl','rear_delt']), ['MACHINES']);
const app = express(); app.use(express.json()); app.use('/api/onboarding', onboardingRoutes);
const server = createServer(app);
async function main() {
  await prisma.user.create({data:{id:userId,email:`equipment-${userId}@example.invalid`,password:'isolated fixture'}});
  await prisma.onboarding.create({data:{userId,...profile}});
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const port = (server.address() as {port:number}).port;
  const url = `http://127.0.0.1:${port}/api/onboarding`;
  const token = jwt.sign({userId},process.env.JWT_ACCESS_SECRET!,{expiresIn:'5m'});
  const headers = {'content-type':'application/json',authorization:`Bearer ${token}`};
  const patch = (body:unknown) => fetch(url,{method:'PATCH',headers,body:JSON.stringify(body)});
  assert.equal((await fetch(url)).status,401);
  let saved = await (await fetch(url,{headers})).json() as any;
  assert.deepEqual(saved.data.equipmentIds,[],'Legacy categories are preserved without guessed machines');
  let result = await patch({equipmentIds:['leg_curl','rear_delt'],equipment:['OTHER']});
  assert.equal(result.status,200);
  saved = await result.json() as any;
  assert.deepEqual(saved.data.equipmentIds,['leg_curl','rear_delt']);
  assert.deepEqual(saved.data.equipment,['MACHINES'],'Precise selections are canonical');
  assert.equal(saved.data.weight,80);
  assert.equal(saved.data.language,'de');
  assert.deepEqual(saved.data.limitations,['KNEE']);
  assert.deepEqual(saved.data.focusMuscles,['chest']);
  assert.equal((await patch({preferredTime:'EVENING'})).status,200);
  saved = await (await fetch(url,{headers})).json() as any;
  assert.deepEqual(saved.data.equipmentIds,['leg_curl','rear_delt'],'Unrelated edits retain equipment');
  for (const equipmentIds of [['unknown'],['leg_curl','leg_curl'],['bodyweight_only','dumbbells'],[]]) {
    assert.equal((await patch({equipmentIds})).status,400);
  }
  assert.equal((await patch({equipmentIds:['bodyweight_only']})).status,200);
  saved = await (await fetch(url,{headers})).json() as any;
  assert.deepEqual(saved.data.equipment,['OTHER']);
  assert.equal((await patch({equipment:['DUMBBELLS']})).status,200);
  saved = await (await fetch(url,{headers})).json() as any;
  assert.deepEqual(saved.data.equipmentIds,[],'Legacy clients clear stale exact selections');
  console.log('Equipment API: exact choices, legacy compatibility, validation and profile preservation passed.');
}
main().finally(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await prisma.user.deleteMany({where:{id:userId}});
  await prisma.$disconnect();
}).catch(error => {console.error(error);process.exitCode=1;});
