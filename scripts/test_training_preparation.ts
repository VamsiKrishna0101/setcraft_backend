import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import prisma from '../config/prisma';
import redis from '../config/redis';
import {getTrainingDay, startSession} from '../modules/workout/session/session_service';
import {weekday} from '../modules/workout/session/session_types';
import {DayOfWeek} from '@prisma/client';

async function main() {
  const owner=await prisma.user.create({data:{email:`preparation-${randomUUID()}@example.invalid`,password:'isolated-test'}});
  const date=new Date(Date.now()+330*60000).toISOString().slice(0,10);
  try {
    const exercise=await prisma.workout.findFirstOrThrow({where:{difficulty:'BEGINNER'}});
    const plan=await prisma.userWorkout.create({data:{userId:owner.id,weekLabel:date,scheduledDate:date,
      warmup:{durationMinutes:5,note:'Preparation only',steps:[
        {name:'Easy movement',instruction:'Walk gently',seconds:120},
        {name:exercise.name,exerciseId:exercise.id,instruction:'Practise lightly',seconds:180,reps:8,weightKg:5}]},
      items:{create:{workoutId:exercise.id,dayOfWeek:weekday(date) as DayOfWeek,orderIndex:0,targetSets:3,targetReps:'12',targetWeight:20,sourceProvider:'USER'}}}});
    const before=await getTrainingDay(owner.id,date,'en');
    assert.equal(before.warmup?.durationMinutes,5);
    assert.equal(before.summary.sets,0);
    await startSession(owner.id,date,330);
    const after=await getTrainingDay(owner.id,date,'en');
    assert(after.session);
    assert.equal(after.warmup?.steps.length,2);
    assert.equal(after.items[0]?.targetSets,3);
    assert.equal(after.summary.sets,0,'Practice steps must never become working-set logs.');
    const sessionPlan=await prisma.userWorkout.findUniqueOrThrow({where:{id:after.planId!}});
    assert.deepEqual(sessionPlan.warmup,plan.warmup,'Starting a session must preserve preparation.');
    await prisma.userWorkoutItem.update({where:{id:after.items[0]!.id},data:{targetWeight:3}});
    const edited=await getTrainingDay(owner.id,date,'en');
    assert.equal(edited.warmup?.steps[1]?.weightKg,null,'Old practice weights must not exceed an edited working load.');
    console.log('Preparation integration passed: persistence, session snapshots, zero logged working sets and edited load safety.');
  } finally {
    await prisma.user.delete({where:{id:owner.id}});
    const keys=await redis.keys(`*${owner.id}*`).catch(()=>[] as string[]);
    if(keys.length) await redis.del(...keys);
    await prisma.$disconnect();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
