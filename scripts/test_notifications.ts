import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Messaging } from 'firebase-admin/messaging';
import prisma from '../config/prisma';
import {
  localTime,
  previousDate,
  quietHours,
  reminderDue,
  notificationPreferences,
} from '../modules/notifications/notifications_types';
import {
  getPreferences,
  savePreferences,
  registerDevice,
  removeDevice,
  queueNotification,
  notificationStillNeeded,
  deliverNotification,
} from '../modules/notifications/notifications_service';

async function main() {
  assert.equal(quietHours(23 * 60, '22:00', '08:00'), true);
  assert.equal(quietHours(7 * 60, '22:00', '08:00'), true);
  assert.equal(quietHours(8 * 60, '22:00', '08:00'), false);
  assert.equal(quietHours(14 * 60, '12:00', '15:00'), true);
  assert.equal(quietHours(14 * 60, '12:00', '12:00'), false);
  assert.equal(reminderDue(18 * 60 + 59, '18:00'), true);
  assert.equal(reminderDue(19 * 60, '18:00'), false);
  assert.equal(previousDate('2026-03-01', 1), '2026-02-28');
  assert.equal(localTime(new Date('2026-03-29T00:30:00Z'), 'Europe/Berlin').minutes, 90);
  assert.equal(localTime(new Date('2026-03-29T01:30:00Z'), 'Europe/Berlin').minutes, 210);
  assert.equal(localTime(new Date('2026-10-25T00:30:00Z'), 'Europe/Berlin').minutes, 150);
  assert.equal(localTime(new Date('2026-10-25T01:30:00Z'), 'Europe/Berlin').minutes, 150);
  assert.equal(notificationPreferences.safeParse({ workoutTime: '25:00' }).success, false);
  assert.equal(notificationPreferences.safeParse({ timezone: 'Not/AZone' }).success, false);
  assert.equal(notificationPreferences.safeParse({ userId: 'other' }).success, false);

  // Only dedicated test accounts are created and removed; no real account is reset.
  const first = await prisma.user.create({
    data: {
      email: `notification-test-${randomUUID()}@example.invalid`,
      password: 'test-only',
      wearableUsage: 'NONE',
    },
  });
  const second = await prisma.user.create({
    data: {
      email: `notification-test-${randomUUID()}@example.invalid`,
      password: 'test-only',
    },
  });
  const date = new Date().toISOString().slice(0, 10);
  let sends = 0;
  let responseCodes: (string | null)[] = [];
  let lastTokens: string[] = [];
  const transport = {
    sendEachForMulticast: async (message: { tokens: string[]; data: Record<string, string> }) => {
      sends++;
      lastTokens = message.tokens;
      assert.equal(message.data.userId, first.id);
      assert.equal('sleepMinutes' in message.data, false);
      return {
        responses: message.tokens.map((_, index) =>
          responseCodes[index]
            ? { success: false, error: { code: responseCodes[index] } }
            : { success: true },
        ),
      };
    },
  } as unknown as Messaging;

  const createJob = async (type = 'TEST', routine = false, targetId: string | null = null) => {
    const devices = await prisma.notificationDevice.findMany({ where: { userId: first.id } });
    return prisma.notificationJob.create({
      data: {
        userId: first.id,
        eventKey: randomUUID(),
        type,
        date,
        targetId,
        title: 'Setcraft',
        body: 'Test fixture',
        routine,
        deviceIds: devices.map((device) => device.id),
        expiresAt: new Date(Date.now() + 3600000),
        nextAttemptAt: new Date(Date.now() + 86400000),
      },
    });
  };

  try {
    const defaults = await getPreferences(first.id);
    assert.equal(defaults.enabled, false);
    assert.equal(defaults.meals, false);
    assert.equal(defaults.checkIns, false);
    await savePreferences(first.id, {
      enabled: true,
      checkIns: true,
      meals: true,
      quietStart: '00:00',
      quietEnd: '00:00',
    });
    const enabledAt = (await getPreferences(first.id)).enabledAt;
    await savePreferences(first.id, { workoutTime: '17:00' });
    assert.deepEqual((await getPreferences(first.id)).enabledAt, enabledAt);

    const installationId = randomUUID();
    await registerDevice(first.id, {
      installationId,
      token: 'a'.repeat(100),
      platform: 'android',
      foreground: false,
    });
    await registerDevice(first.id, {
      installationId: randomUUID(),
      token: 'b'.repeat(100),
      platform: 'ios',
      foreground: false,
    });
    const job = await createJob();
    await queueNotification({ ...job, id: randomUUID() });
    assert.equal(
      await prisma.notificationJob.count({ where: { userId: first.id, eventKey: job.eventKey } }),
      1,
    );

    responseCodes = [null, 'messaging/server-unavailable'];
    await deliverNotification(job, transport);
    const partial = await prisma.notificationJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(partial.status, 'PENDING');
    assert.equal(partial.deviceIds.length, 1);
    assert.ok(partial.sentAt);
    responseCodes = [];
    await deliverNotification(partial, transport);
    assert.equal(lastTokens.length, 1, 'Only failed devices are retried');
    assert.equal(
      (await prisma.notificationJob.findUniqueOrThrow({ where: { id: job.id } })).status,
      'SENT',
    );

    const checkIn = await createJob('CHECK_IN', true);
    assert.equal(await notificationStillNeeded(checkIn), true);
    await prisma.dailyWellnessEntry.create({
      data: { userId: first.id, date, sleepMinutes: 420, energy: 3, rested: 3, soreness: 2 },
    });
    await deliverNotification(checkIn, transport);
    assert.equal(
      (await prisma.notificationJob.findUniqueOrThrow({ where: { id: checkIn.id } })).status,
      'SKIPPED',
    );
    await prisma.dailyWellnessEntry.deleteMany({ where: { userId: first.id } });
    await prisma.user.update({ where: { id: first.id }, data: { wearableUsage: 'WEARABLE' } });
    assert.equal(await notificationStillNeeded(checkIn), false);
    await prisma.user.update({ where: { id: first.id }, data: { wearableUsage: 'NONE' } });

    const workout = await prisma.workout.findFirstOrThrow();
    const training = await prisma.userWorkout.create({
      data: {
        userId: first.id,
        weekLabel: 'test',
        scheduledDate: date,
        items: { create: { workoutId: workout.id, dayOfWeek: 'MONDAY', sourceProvider: 'USER' } },
      },
    });
    const workoutJob = await createJob('WORKOUT', true, training.id);
    assert.equal(await notificationStillNeeded(workoutJob), true);
    await prisma.userWorkout.update({ where: { id: training.id }, data: { status: 'COMPLETED' } });
    assert.equal(await notificationStillNeeded(workoutJob), false);

    const food = await prisma.nutrition.findFirstOrThrow({ where: { userId: null } });
    const [year, month, day] = date.split('-');
    const meal = await createJob('MEAL', true, 'LUNCH');
    assert.equal(await notificationStillNeeded(meal), true);
    await prisma.userMealLog.create({
      data: {
        userId: first.id,
        nutritionId: food.id,
        year,
        month: String(Number(month)),
        day: String(Number(day)),
        mealType: 'LUNCH',
        calories: 1,
        protein: 1,
        carbs: 1,
        fat: 1,
      },
    });
    assert.equal(
      await notificationStillNeeded(meal),
      false,
      'Unpadded food-log dates are supported',
    );

    const beforeLimit = sends;
    for (let index = 0; index < 2; index++) {
      const sent = await createJob('CHECK_IN', true);
      await deliverNotification(sent, transport);
      assert.equal(
        (await prisma.notificationJob.findUniqueOrThrow({ where: { id: sent.id } })).status,
        'SENT',
      );
    }
    const limited = await createJob('CHECK_IN', true);
    await deliverNotification(limited, transport);
    assert.equal(sends - beforeLimit, 2, 'Daily routine limit is enforced');

    await savePreferences(first.id, { quietStart: '00:00', quietEnd: '23:59' });
    const quiet = await createJob('PLAN_READY', false);
    const beforeQuiet = sends;
    await deliverNotification(quiet, transport);
    assert.equal(sends, beforeQuiet);
    await savePreferences(first.id, { quietEnd: '00:00' });

    const run = await prisma.weeklyPlanRun.create({
      data: {
        userId: first.id,
        weekStart: date,
        contextHash: randomUUID(),
        input: {},
        status: 'COMPLETED',
      },
    });
    const plan = await prisma.weeklyPersonalPlan.create({
      data: {
        userId: first.id,
        runId: run.id,
        weekStart: date,
        version: 1,
        status: 'ACTIVE',
        payload: {},
        promptVersion: 'test',
        ruleVersion: 'test',
        model: 'test',
        createdAt: new Date(Date.now() - 8 * 86400000),
      },
    });
    const ready = await createJob('PLAN_READY', false, plan.id);
    assert.equal(await notificationStillNeeded(ready), true);
    const available = await createJob('PLAN_AVAILABLE', true, plan.id);
    assert.equal(await notificationStillNeeded(available), true);
    const pendingRun = await prisma.weeklyPlanRun.create({
      data: {
        userId: first.id,
        weekStart: date,
        contextHash: randomUUID(),
        input: {},
        status: 'RUNNING',
      },
    });
    assert.equal(
      await notificationStillNeeded(available),
      false,
      'Do not remind while a plan is already generating',
    );
    await prisma.weeklyPlanRun.delete({ where: { id: pendingRun.id } });
    await prisma.weeklyPersonalPlan.update({ where: { id: plan.id }, data: { synthetic: true } });
    assert.equal(
      await notificationStillNeeded(ready),
      false,
      'Synthetic plans do not send updates',
    );

    const stolen = await createJob();
    await registerDevice(second.id, {
      installationId,
      token: 'a'.repeat(100),
      platform: 'android',
      foreground: false,
    });
    const reassigned = await prisma.notificationDevice.findUniqueOrThrow({
      where: { installationId },
    });
    const beforeReassigned = sends;
    await deliverNotification({ ...stolen, deviceIds: [reassigned.id] }, transport);
    assert.equal(
      sends,
      beforeReassigned,
      'Queued alerts cannot follow a device to another account',
    );

    const old = await createJob();
    await registerDevice(second.id, {
      installationId,
      token: 'a'.repeat(100),
      platform: 'android',
      foreground: false,
    });
    await removeDevice(second.id, 'not-the-first-device');
    assert.equal(
      await prisma.notificationDevice.count({ where: { userId: first.id, installationId } }),
      0,
    );
    const firstDevice = await prisma.notificationDevice.findFirstOrThrow({
      where: { userId: first.id },
    });
    await prisma.notificationJob.update({
      where: { id: old.id },
      data: { deviceIds: [firstDevice.id] },
    });
    responseCodes = ['messaging/registration-token-not-registered'];
    await deliverNotification({ ...old, deviceIds: [firstDevice.id] }, transport);
    assert.equal(await prisma.notificationDevice.count({ where: { id: firstDevice.id } }), 0);

    const pending = await createJob();
    await savePreferences(first.id, { enabled: false });
    assert.equal(
      (await prisma.notificationJob.findUniqueOrThrow({ where: { id: pending.id } })).status,
      'SKIPPED',
    );
    const beforeDisabled = sends;
    await deliverNotification(pending, transport);
    assert.equal(sends, beforeDisabled);
    console.log(
      'Notification checks passed: consent, DST, quiet hours, deduplication, retries, completed actions, limits, token ownership and revocation.',
    );
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: [first.id, second.id] } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
