import { NotificationPreference } from '@prisma/client';
import prisma, { pool } from '../../config/prisma';
import { deliveryReady, deliverNotification, queueNotification, realWorkoutItems } from './notifications_service';
import { localTime, previousDate, reminderDue, effectiveReminder, NotificationType } from './notifications_types';
import { getmysubscription } from '../subscription/subscription_service';
import { getPlanAvailability } from '../../graphworkflow/service';

function logFailure(event: string, error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN';
  console.warn(JSON.stringify({ event, code }));
}

export async function scheduleUser(preferences: NotificationPreference, now: Date) {
  const { userId } = preferences;
  const local = localTime(now, preferences.timezone);
  const devices = await prisma.notificationDevice.findMany({
    where: { userId, lastSeenAt: { gte: new Date(now.getTime() - 60 * 86400000) } },
    take: 10, orderBy: { lastSeenAt: 'desc' }, select: { id: true },
  });
  if (!devices.length) return;

  if (preferences.billing) {
    const access = await getmysubscription(userId, false);
    const ending = access.state === 'trial' && access.daysRemaining <= 2;
    const expired = access.state === 'expired' && access.trialEndsAt &&
      now.getTime() >= access.trialEndsAt.getTime() &&
      now.getTime() - access.trialEndsAt.getTime() < 86400000;
    if (ending || expired) {
      const type = ending ? 'TRIAL_ENDING' : 'TRIAL_EXPIRED';
      const body = !ending
        ? 'Your saved progress is safe. Subscribe to continue training with Setcraft.'
        : access.trialSource !== 'store'
          ? 'No automatic charge applies to your existing trial. Subscribe when you’re ready to keep going.'
          : access.cancelAtPeriodEnd
            ? 'Your trial ends soon. Your subscription is set to end without renewal.'
            : 'Your trial ends soon. Manage or cancel your subscription in your app store before renewal.';
      await queueNotification({
        userId, type, date: local.date, routine: false,
        eventKey: type + ':' + access.trialEndsAt!.toISOString(),
        title: ending ? 'Your trial ends soon' : 'Your trial has ended', body,
        deviceIds: devices.map(device => device.id),
        expiresAt: ending ? access.trialEndsAt! : new Date(access.trialEndsAt!.getTime() + 86400000),
      });
    }
  }

  if (preferences.pausedUntil && preferences.pausedUntil > now) return;
  const due = (time: string) => {
    const effective = effectiveReminder(time, preferences.quietStart, preferences.quietEnd);
    return reminderDue(local.minutes, effective.time) ? previousDate(local.date, effective.dayOffset) : null;
  };
  const queue = (type: NotificationType, targetId: string | null, title: string, body: string,
      eventKey: string, activityDate: string | null = null, routine = true) => queueNotification({
    userId, type, targetId, title, body, eventKey, date: local.date, activityDate, routine,
    deviceIds: devices.map(device => device.id),
    expiresAt: new Date(now.getTime() + (routine ? 3600000 : 86400000)),
  });

  if (preferences.plans && preferences.enabledAt) {
    const plan = await prisma.weeklyPersonalPlan.findFirst({
      where: { userId, synthetic: false }, orderBy: { createdAt: 'desc' },
    });
    if (plan?.status === 'ACTIVE' && plan.createdAt >= preferences.enabledAt &&
        now.getTime() - plan.createdAt.getTime() < 86400000) {
      await queue('PLAN_READY', plan.id, 'Your week is ready',
        'Open Setcraft to explore your new training plan.', 'PLAN_READY:' + plan.id, null, false);
    }
    if (plan && due(preferences.workoutTime) && (await getPlanAvailability(userId, prisma, now)).canGenerate) {
      await queue('PLAN_AVAILABLE', plan.id, 'Ready for your next week?',
        'Your next personalized plan is available to generate.', 'PLAN_AVAILABLE:' + plan.id);
    }
  }

  const workoutDate = preferences.workouts ? due(preferences.workoutTime) : null;
  if (workoutDate) {
    const workout = await prisma.userWorkout.findFirst({ where: {
      userId, scheduledDate: workoutDate, status: { in: ['NOT_STARTED', 'IN_PROGRESS'] },
      items: realWorkoutItems, NOT: { session: { is: { status: 'COMPLETED' } } },
    }, select: { id: true } });
    if (workout) await queue('WORKOUT', workout.id, 'Your session is waiting',
      'Open your scheduled workout when you’re ready.', 'WORKOUT:' + workoutDate, workoutDate);
  }
  const checkInDate = preferences.checkIns ? due(preferences.checkInTime) : null;
  if (checkInDate) await queue('CHECK_IN', null, 'How are you feeling today?',
    'A quick check-in helps you plan your day.', 'CHECK_IN:' + checkInDate, checkInDate);
  const mealDate = preferences.meals ? due(preferences.mealTime) : null;
  if (mealDate) await queue('MEAL', preferences.mealType, 'A moment for your food log',
    'Add your meal when it suits you.', 'MEAL:' + mealDate + ':' + preferences.mealType, mealDate);
  const summaryDate = preferences.summaries ? due(preferences.summaryTime) : null;
  if (summaryDate && new Date(summaryDate + 'T12:00:00Z').getUTCDay() === 0) {
    const count = await prisma.workoutSession.count({ where: {
      userId, status: 'COMPLETED', date: { gte: previousDate(summaryDate, 6), lte: summaryDate },
      userWorkout: { items: realWorkoutItems },
    } });
    if (count) await queue('SUMMARY', null, 'Your weekly recap is ready',
      'See your training progress in Setcraft.', 'SUMMARY:' + summaryDate, summaryDate);
  }
}

// Indexed due-user batches replace a full scan before every delivery cycle.
export async function scheduleDueNotifications(now = new Date()) {
  const preferences = await prisma.notificationPreference.findMany({
    where: { enabled: true, nextScheduleAt: { lte: now }, user: { notificationDevices: { some: {} } } },
    orderBy: { nextScheduleAt: 'asc' }, take: 500,
  });
  for (let offset = 0; offset < preferences.length; offset += 10) {
    await Promise.all(preferences.slice(offset, offset + 10).map(async preference => {
      const claimed = await prisma.notificationPreference.updateMany({
        where: { userId: preference.userId, nextScheduleAt: { lte: now } },
        data: { nextScheduleAt: new Date(now.getTime() + 60000) },
      });
      if (!claimed.count) return;
      try { await scheduleUser(preference, now); }
      catch (error) { logFailure('notification.schedule.failed', error); }
    }));
  }
}

// Different users can send concurrently; a user's jobs stay sequential so daily limits hold.
export async function dispatchNotifications(maxBatches = 10) {
  const now = new Date();
  await prisma.notificationJob.updateMany({
    where: { status: 'SENDING', leaseUntil: { lt: now } },
    data: { status: 'PENDING', leaseUntil: null, reason: 'LEASE_RECOVERED' },
  });
  await prisma.notificationJob.updateMany({
    where: { status: 'PENDING', expiresAt: { lte: now } },
    data: { status: 'EXPIRED', reason: 'STALE', leaseUntil: null },
  });
  const deadline = Date.now() + 20000;
  for (let batch = 0; batch < maxBatches && Date.now() < deadline; batch++) {
    const jobs = await prisma.notificationJob.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: new Date() }, expiresAt: { gt: new Date() } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }], take: 200,
    });
    if (!jobs.length) break;
    const users = new Map<string, typeof jobs>();
    for (const job of jobs) users.set(job.userId, [...(users.get(job.userId) ?? []), job]);
    const groups = [...users.values()];
    for (let offset = 0; offset < groups.length; offset += 10) {
      await Promise.all(groups.slice(offset, offset + 10).map(async group => {
        for (const job of group) {
          const claimed = await prisma.notificationJob.updateMany({
            where: { id: job.id, status: 'PENDING' },
            data: { status: 'SENDING', leaseUntil: new Date(Date.now() + 300000) },
          });
          if (!claimed.count) continue;
          try { await deliverNotification(job); }
          catch (error) {
            logFailure('notification.delivery.failed', error);
            await prisma.notificationJob.updateMany({
              where: { id: job.id, status: 'SENDING' },
              data: { status: 'PENDING', leaseUntil: null, reason: 'WORKER_ERROR',
                nextAttemptAt: new Date(Date.now() + 60000) },
            });
          }
        }
      }));
    }
  }
}

export async function processNotifications() {
  if (!deliveryReady()) return;
  await scheduleDueNotifications();
  await dispatchNotifications();
}

export function startNotificationsWorker() {
  const running = new Set<number>();
  const tick = async (key: number, task: () => Promise<unknown>) => {
    if (running.has(key) || !deliveryReady()) return;
    running.add(key);
    const client = await pool.connect().catch(() => null);
    if (!client) { running.delete(key); return; }
    let locked = false;
    try {
      locked = (await client.query('SELECT pg_try_advisory_lock($1) AS locked', [key])).rows[0].locked;
      if (locked) await task();
    } catch (error) { logFailure('notification.worker.failed', error); }
    finally {
      try { if (locked) await client.query('SELECT pg_advisory_unlock($1)', [key]); }
      finally { client.release(); running.delete(key); }
    }
  };
  const schedule = () => tick(796945284177, () => scheduleDueNotifications());
  const dispatch = () => tick(796945284176, () => dispatchNotifications());
  void schedule();
  void dispatch();
  setInterval(() => void schedule(), 10000).unref();
  setInterval(() => void dispatch(), 5000).unref();
  // Keep delivery diagnostics for 90 days without accumulating tokens forever.
  const prune = () => tick(796945284178, async () => {
    await prisma.notificationJob.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 90 * 86400000) }, status: { notIn: ['PENDING', 'SENDING'] } },
    });
    await prisma.notificationDevice.deleteMany({ where: { lastSeenAt: { lt: new Date(Date.now() - 90 * 86400000) } } });
  });
  setInterval(() => void prune(), 86400000).unref();
}
