import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DayOfWeek, Prisma} from '@prisma/client';
import prisma from '../config/prisma';
import redis from '../config/redis';
import {previewSchedule, applySchedule, effectivePlan, scheduleRequest} from '../modules/workout/session/schedule_service';
import {getTrainingDay, getTrainingWeek} from '../modules/workout/session/session_service';
import {weekday} from '../modules/workout/session/session_types';
import {getPlanAvailability, saveCompletedPlan} from '../graphworkflow/service';
import {loadSnapshot, hashContext} from '../graphworkflow/nodes/prepare_node';
import {buildRulesFallback} from '../graphworkflow/starter_fallback';
import {dateInZone, addDays} from '../graphworkflow/common/types';
import {mondayOf} from '../graphworkflow/common/calendar_schedule';
import {EQUIPMENT_CATEGORIES} from '../modules/onboarding/equipment_catalog';

async function main() {
  const owner = await prisma.user.create({data: {email: `schedule-${randomUUID()}@example.invalid`, password: 'isolated-test'}});
  const other = await prisma.user.create({data: {email: `schedule-other-${randomUUID()}@example.invalid`, password: 'isolated-test'}});
  const generation = await prisma.user.create({data: {email: `schedule-generation-${randomUUID()}@example.invalid`, password: 'isolated-test'}});
  const now = new Date('2026-12-30T10:00:00Z');
  const request = scheduleRequest.parse({timezone: 'Europe/Amsterdam', availableDates: ['2026-12-31','2027-01-01','2027-01-02']});
  try {
    const exercise = await prisma.workout.findFirstOrThrow({where: {difficulty: 'BEGINNER'}});
    const dates = ['2026-12-30','2026-12-31','2027-01-01'];
    const names = ['Chest','Back','Legs'];
    const workouts: Prisma.UserWorkoutGetPayload<{include:{items:true}}>[] = [];
    for (const [index,date] of dates.entries()) {
      workouts.push(await prisma.userWorkout.create({data: {userId: owner.id, weekLabel: '2026-12-28', scheduledDate: date,
        warmup: {durationMinutes: 5, steps: [{name: 'Easy movement', seconds: 300}]},
        items: {create: {workoutId: exercise.id, dayOfWeek: weekday(date) as DayOfWeek, orderIndex: 0, targetSets: 3, targetReps: '8-12', targetWeight: 12, setTargets: {sets: [{setNumber:1,repsMin:8,repsMax:12,weightKg:12}]}, sourceProvider: 'USER'}}}, include: {items: true}}));
      await prisma.workoutDay.create({data: {userId:owner.id,date,name:names[index]!}});
    }
    const run = await prisma.weeklyPlanRun.create({data: {userId:owner.id,weekStart:'2026-12-28',contextHash:randomUUID(),status:'COMPLETED',input:{selectedSchedule:{startDate:'2026-12-30',trainingDates:dates}, timezone:'Europe/Amsterdam'}}});
    const payload = {workouts: Array.from({length:7},(_,i) => {
      const date = new Date(Date.parse('2026-12-28T12:00:00Z')+i*86400000).toISOString().slice(0,10);
      return {date,name:names[dates.indexOf(date)] ?? 'Rest day',restDay:!dates.includes(date),exercises:dates.includes(date)?[{exerciseId:exercise.id,sets:3}]:[]};
    })};
    const plan = await prisma.weeklyPersonalPlan.create({data:{userId:owner.id,runId:run.id,weekStart:'2026-12-28',version:1,status:'ACTIVE',createdAt:now,activatedAt:now,payload,promptVersion:'test',ruleVersion:'test',model:'isolated-test'}});
    const availability = await getPlanAvailability(owner.id, prisma, now);
    assert.equal(availability.nextGenerationAt,'2027-01-03T23:00:00.000Z','A short first week can be followed by a fresh Monday plan.');
    const before = await previewSchedule(owner.id, dates[0]!, request, now);
    assert.deepEqual(before.changes.map(row=>row.toDate), request.availableDates);
    await assert.rejects(previewSchedule(other.id,dates[0]!,request,now), /unstarted/);
    await assert.rejects(previewSchedule(owner.id,'2026-12-29',request,now), /current local date/);
    await assert.rejects(previewSchedule(owner.id,dates[0]!,{...request,availableDates:['2027-01-04']},now), /Sunday/);
    await prisma.userWorkoutItem.update({where:{id:workouts[0]!.items[0]!.id},data:{targetReps:'10-12'}});
    await assert.rejects(applySchedule(owner.id, dates[0]!,{...request,fingerprint:before.fingerprint},now), /schedule changed/);
    const fresh = await previewSchedule(owner.id, dates[0]!,request,now);
    const results = await Promise.all([0,1].map(()=>applySchedule(owner.id,dates[0]!,{...request,fingerprint:fresh.fingerprint},now)));
    assert(results.some(row=>row.alreadyApplied));
    assert.equal(await prisma.workoutScheduleChange.count({where:{userId:owner.id}}),1);
    for (const [index,date] of request.availableDates!.entries()) {
      const saved: Prisma.UserWorkoutGetPayload<{include:{items:true}}> = await prisma.userWorkout.findUniqueOrThrow({where:{id:workouts[index]!.id},include:{items:true}});
      assert.equal(saved.scheduledDate,date);
      assert.deepEqual(saved.warmup,workouts[index]!.warmup);
      assert.deepEqual(saved.items[0]!.setTargets,workouts[index]!.items[0]!.setTargets);
      assert.equal(saved.items[0]!.targetWeight,12);
      assert.equal(saved.items[0]!.dayOfWeek,weekday(date));
    }
    assert((await getTrainingDay(owner.id,dates[0]!,'en')).restDay);
    assert.equal((await getTrainingDay(owner.id,'2026-12-31','en')).items.length,1);
    const effective = await effectivePlan(owner.id,plan);
    const displayed = (effective.payload as typeof payload).workouts;
    assert.equal(displayed.find(day=>day.date==='2026-12-31')!.name,'Chest');
    assert.equal(displayed.find(day=>day.date==='2027-01-02')!.name,'Legs');
    assert.deepEqual((await prisma.weeklyPersonalPlan.findUniqueOrThrow({where:{id:plan.id}})).payload,payload,'Original AI payload stays immutable.');
    assert.equal(await prisma.workoutSetLog.count({where:{userId:owner.id}}),0);
    const week = await getTrainingWeek(owner.id,'2026-12-31','en') as {week: Array<{date:string;status:string}>};
    assert.equal(week.week.find(day=>day.date==='2026-12-30')!.status,'REST_DAY');
    assert.equal(week.week.find(day=>day.date==='2027-01-02')!.status,'SCHEDULED');

    // An unavailable Sunday is an explicit skip, never a silent Monday rollover.
    const last = await prisma.userWorkout.create({data:{userId:other.id,weekLabel:'2026-12-28',scheduledDate:'2027-01-03',items:{create:{workoutId:exercise.id,dayOfWeek:'SUNDAY',sourceProvider:'USER'}}}});
    const sunday = new Date('2027-01-03T12:00:00Z');
    const noDates = scheduleRequest.parse({timezone:'Europe/Amsterdam',availableDates:[]});
    const noFit = await previewSchedule(other.id,'2027-01-03',noDates,sunday);
    assert.equal(noFit.changes[0]!.toDate,null);
    await assert.rejects(applySchedule(other.id,'2027-01-03',{...noDates,fingerprint:noFit.fingerprint},sunday),/Confirm/);
    assert.equal((await prisma.userWorkout.findUniqueOrThrow({where:{id:last.id}})).status,'NOT_STARTED');
    await applySchedule(other.id,'2027-01-03',{...noDates,fingerprint:noFit.fingerprint,allowSkip:true},sunday);
    assert.equal((await prisma.userWorkout.findUniqueOrThrow({where:{id:last.id}})).status,'SKIPPED');
    assert.equal(await prisma.userWorkout.count({where:{userId:other.id,scheduledDate:'2027-01-04'}}),0);

    // A new session after preview prevents the schedule write.
    const nextNow = new Date('2026-12-31T12:00:00Z');
    const nextRequest = scheduleRequest.parse({timezone:'Europe/Amsterdam',availableDates:['2027-01-01','2027-01-02','2027-01-03']});
    const upcoming = await previewSchedule(owner.id,'2026-12-31',nextRequest,nextNow);
    await prisma.workoutSession.create({data:{userId:owner.id,date:'2026-12-31',userWorkoutId:workouts[0]!.id,name:'Chest',status:'COMPLETED',finishedAt:new Date()}});
    await assert.rejects(applySchedule(owner.id,'2026-12-31',{...nextRequest,fingerprint:upcoming.fingerprint,allowSkip:true},nextNow),/unstarted/);
    assert.equal((await prisma.workoutSession.findUniqueOrThrow({where:{userId_date:{userId:owner.id,date:'2026-12-31'}}})).status,'COMPLETED');
    await prisma.onboarding.create({data:{userId:generation.id,name:'Calendar fixture',age:30,gender:'FEMALE',height:170,weight:70,
      workingToward:'BUILD_MUSCLE',experience:'BEGINNER',daysPerWeek:'DAYS_3',workoutDuration:'MIN_45',trainingLocation:'GYM',
      equipment:['DUMBBELLS','BARBELLS','CABLE','BENCH','MACHINES','OTHER'],equipmentIds:Object.keys(EQUIPMENT_CATEGORIES).filter(id=>id!=='bodyweight_only'),
      activityLevel:'MODERATE',sleepDuration:'HOURS_7_TO_8',eatingStyle:'NO_PREFERENCE',limitations:['NONE'],trainingSplit:'AUTO'}});
    const today = dateInZone('Europe/Amsterdam');
    const monday = mondayOf(today);
    const selectedDates = [...new Set([today,addDays(monday,6)])];
    const snapshot = await loadSnapshot(generation.id,monday,'Europe/Amsterdam',false,prisma,false,{startDate:today,trainingDates:selectedDates});
    const generated = await buildRulesFallback(snapshot);
    const generatedRun = await prisma.weeklyPlanRun.create({data:{userId:generation.id,weekStart:monday,contextHash:hashContext(snapshot),status:'RUNNING',leaseUntil:new Date(Date.now()+3600000),input:JSON.parse(JSON.stringify(snapshot))}});
    const published = await saveCompletedPlan(generatedRun.id,generated);
    assert.equal(published.status,'ACTIVE');
    const activatedDates = await prisma.userWorkout.findMany({where:{userId:generation.id,scheduledDate:{not:null}},orderBy:{scheduledDate:'asc'},select:{scheduledDate:true}});
    assert.deepEqual(activatedDates.map(row=>row.scheduledDate),selectedDates);
    assert.equal(await prisma.workoutDay.count({where:{userId:generation.id,date:{lt:today}}}),0,'Midweek publication must never create past schedule entries.');
    console.log('Selected-date generation integration passed: real catalogue fallback, fresh snapshot validation and automatic activation only on chosen dates.');
    console.log('Workout scheduling integration passed: ownership, calendar dates, unchanged prescriptions and warm-ups, effective plan, immutable payload, explicit skips, stale preview protection, completed-session protection and idempotent concurrent apply.');
  } finally {
    for (const user of [owner,other,generation]) {
      await prisma.user.delete({where:{id:user.id}});
      const keys=await redis.keys(`*${user.id}*`).catch(()=>[] as string[]);
      if(keys.length) await redis.del(...keys);
    }
    await prisma.$disconnect();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
