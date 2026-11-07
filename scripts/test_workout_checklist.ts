import 'dotenv/config';
import assert from 'node:assert/strict';
import prisma from '../config/prisma';
import redis from '../config/redis';
import { updateWorkoutItem } from '../modules/workout/workout_service';
import { UpdateWorkoutItemSchema } from '../modules/workout/workout_types';

async function main() {
 const originalFind = prisma.userWorkoutItem.findFirst;
 const originalUpdate = prisma.userWorkoutItem.update;
 const client = (redis as any).client;
 const originalRequest = client.request;
 const writes: any[] = [], invalidations: string[] = [];
 (prisma.userWorkoutItem as any).findFirst = async ({where}: any) =>
   where.id === 'synthetic-item' && where.userWorkout.userId === 'synthetic-owner' ? {id: where.id} : null;
 (prisma.userWorkoutItem as any).update = async (args: any) => { writes.push(args); return args.data; };
 // Mock the transport: Upstash's proxy bypasses assigned command methods.
 client.request = async ({body}: any) => {
  const pipeline = Array.isArray(body[0]);
  const execute = ([command, ...args]: string[]) => {
   if (command === 'keys') return {result: ['userworkout:synthetic-owner:day']};
   assert.equal(command, 'del');
   invalidations.push(...args);
   return {result: 1};
  };
  return pipeline ? body.map(execute) : execute(body);
 };
 try {
  assert.equal(UpdateWorkoutItemSchema.safeParse({status: 'COMPLETED'}).success, false);
  const input = UpdateWorkoutItemSchema.parse({status: 'NOT_STARTED'});
  await updateWorkoutItem('synthetic-owner', 'synthetic-item', input);
  assert.deepEqual(writes[0].data, {status: 'NOT_STARTED', completedAt: null});
  assert.equal(invalidations.includes('home:synthetic-owner'), true);
  assert.equal(invalidations.includes('userworkout:synthetic-owner:day'), true);
  await assert.rejects(updateWorkoutItem('another-owner', 'synthetic-item', input));
  assert.equal(writes.length, 1);
  await updateWorkoutItem('synthetic-owner', 'synthetic-item', {targetWeight: 12});
  assert.deepEqual(writes[1].data, {targetWeight: 12});
  console.log('Checklist undo, ownership and cache invalidation passed. All database/cache access mocked.');
 } finally {
  prisma.userWorkoutItem.findFirst = originalFind;
  prisma.userWorkoutItem.update = originalUpdate;
  client.request = originalRequest;
 }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
