import assert from 'node:assert/strict';
const restores: Array<() => void> = [];
function stub(model: any, key: string, fn: any) { const old = model[key]; model[key] = fn; restores.push(() => { model[key] = old; }); }
import { NotificationJob } from '@prisma/client';
import { Messaging } from 'firebase-admin/messaging';
import prisma from '../config/prisma';
import { effectiveReminder, quietHours, notificationPriority } from '../modules/notifications/notifications_types';
import { deliverNotification, snoozeNotification } from '../modules/notifications/notifications_service';
import { scheduleUser } from '../modules/notifications/notifications_scheduler';

async function main() {
  assert.deepEqual(effectiveReminder('07:00', '22:00', '08:00'), { time: '08:00', dayOffset: 0 });
  assert.deepEqual(effectiveReminder('23:00', '22:00', '08:00'), { time: '08:00', dayOffset: 1 });
  assert.deepEqual(effectiveReminder('18:00', '22:00', '08:00'), { time: '18:00', dayOffset: 0 });
  assert.equal(quietHours(480, '22:00', '08:00'), false);
  assert.ok(notificationPriority('WORKOUT') > notificationPriority('MEAL'));
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const preferences = {
    userId: 'policy-user', enabled: true, enabledAt: new Date('2026-10-01T00:00:00Z'),
    workouts: true, plans: true, checkIns: true, summaries: false, meals: true, billing: false,
    workoutTime: '08:00', checkInTime: '09:00', summaryTime: '18:00', mealTime: '12:30',
    mealType: 'LUNCH' as const, quietStart: '00:00', quietEnd: '00:00', timezone: 'UTC',
    pausedUntil: null as Date | null, nextScheduleAt: now, updatedAt: now,
    user: { onboarding: { language: 'en' } },
  };
  let sent = 0;
  const updates: Record<string, unknown>[] = [];
  const queued: Record<string, unknown>[] = [];
  const transport = { sendEachForMulticast: async (message: { data: Record<string, string> }) => {
    sent++;
    assert.equal(message.data.userId, 'policy-user');
    return { responses: [{ success: true }] };
  } } as unknown as Messaging;
  stub(prisma.notificationPreference, 'findUnique', async () => preferences);
  stub(prisma.notificationDevice, 'findMany', async () => [
    { id: 'device', token: 'fake-token', foregroundUntil: null },
  ]);
  stub(prisma.userWorkout, 'findFirst', async () => ({ id: 'workout' }));
  stub(prisma.userMealLog, 'findFirst', async () => null);
  stub(prisma.notificationJob, 'count', async () => 1);
  stub(prisma.notificationJob, 'findFirst', async () => null);
  stub(prisma.notificationJob, 'update', async (args: { data: Record<string, unknown> }) => {
    updates.push(args.data); return args.data;
  });
  stub(prisma.notificationJob, 'create', async (args: { data: Record<string, unknown> }) => {
    queued.push(args.data); return args.data;
  });
  const job = (type: string, changes: Partial<NotificationJob> = {}) => ({
    id: 'job', userId: 'policy-user', type, date, activityDate: null,
    targetId: type === 'MEAL' ? 'LUNCH' : 'workout', eventKey: 'fixture',
    title: 'Title', body: 'Body', routine: true, deviceIds: ['device'],
    status: 'PENDING', attempts: 0, nextAttemptAt: now,
    expiresAt: new Date(Date.now() + 3600000), leaseUntil: null, sentAt: null,
    errorCode: null, reason: null, priority: 50, openedAt: null, createdAt: now, ...changes,
  }) as NotificationJob;
  try {
    await deliverNotification(job('MEAL'), transport);
    assert.equal(sent, 0, 'A meal reminder cannot consume the reserved workout slot');
    assert.equal(updates.at(-1)?.reason, 'WORKOUT_RESERVED');
    await deliverNotification(job('WORKOUT'), transport);
    assert.equal(sent, 1, 'The unfinished workout can use its reserved slot');

    stub(prisma.notificationJob, 'count', async () => 2);
    const acceptedAt = new Date(now.getTime() - 60000);
    await deliverNotification(job('WORKOUT', { sentAt: acceptedAt }), transport);
    assert.equal(sent, 2, 'A partial delivery retry is not blocked by the daily cap');
    assert.equal(updates.at(-1)?.sentAt, acceptedAt, 'Keep the first provider acceptance time');

    preferences.pausedUntil = new Date(Date.now() + 86400000);
    await deliverNotification(job('WORKOUT'), transport);
    assert.equal(sent, 2);
    assert.equal(updates.at(-1)?.reason, 'PAUSED');
    await deliverNotification(job('TEST', { routine: false }), transport);
    assert.equal(sent, 3, 'An explicitly requested test bypasses the coaching pause');
    await deliverNotification(job('WORKOUT', { routine: false, eventKey: 'SNOOZE:parent' }), transport);
    assert.equal(sent, 4, 'A user-requested snooze follows the explicit request during a pause');
    preferences.pausedUntil = null;
    await deliverNotification(job('INVALID_TYPE'), transport);
    assert.equal(updates.at(-1)?.reason, 'UNKNOWN_TYPE');
    assert.equal(sent, 4);

    preferences.summaries = true;
    stub(prisma.notificationJob, 'count', async () => 0);
    await deliverNotification(job('MEAL', {
      date: '2026-11-08', expiresAt: new Date('2026-11-08T13:00:00Z'),
    }), transport, new Date('2026-11-08T12:00:00Z'));
    assert.equal(sent, 4, 'Sunday leaves room for both a workout and its weekly recap');
    preferences.summaries = false;

    stub(prisma.notificationPreference, 'upsert', async () => preferences);
    stub(prisma.user, 'findUniqueOrThrow', async () => ({ trialStartedAt: null, trialEndsAt: null }));
    stub(prisma.subscription, 'findMany', async () => []);
    stub(prisma.notificationDevice, 'findFirst', async () => ({ id: 'device', installationId: 'install' }));
    stub(prisma.notificationJob, 'findFirst', async (args: { where: { userId: string } }) =>
      args.where.userId === 'policy-user' ? job('WORKOUT', { sentAt: now }) : null);
    await snoozeNotification('policy-user', 'job', 'install');
    const snoozed = queued.find(row => String(row.eventKey).startsWith('SNOOZE:'))!;
    assert.equal(snoozed.routine, false, 'An explicit snooze has its own budget');
    assert.deepEqual(snoozed.deviceIds, ['device']);
    assert.ok((snoozed.nextAttemptAt as Date).getTime() >= Date.now() + 14 * 60000);
    const queuedBefore = queued.length;
    await assert.rejects(() => snoozeNotification('other-user', 'job', 'install'), /no longer needs/);
    assert.equal(queued.length, queuedBefore, 'Another account cannot snooze an owned notification');

    stub(prisma.weeklyPersonalPlan, 'findFirst', async () => ({
      id: 'friday-plan', synthetic: false, status: 'ACTIVE',
      createdAt: new Date('2026-10-30T12:00:00Z'), weekStart: '2026-10-26',
      run: { input: { timezone: 'UTC', selectedSchedule: { dates: ['2026-10-30'] } } },
    }));
    stub(prisma.weeklyPlanRun, 'findFirst', async () => null);
    await scheduleUser({ ...preferences, workouts: false, checkIns: false, meals: false, summaries: false },
      new Date('2026-11-02T08:00:00Z'));
    assert.ok(queued.some(row => row.type === 'PLAN_AVAILABLE'),
      'A Friday plan can unlock on Monday without waiting seven elapsed days');
    console.log('Notification policy checks passed: quiet-time deferral, workout/summary priority, partial retries, pause, unknown types, owned snoozes, and calendar plan availability.');
  } finally { restores.reverse().forEach(restore => restore()); await prisma.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
