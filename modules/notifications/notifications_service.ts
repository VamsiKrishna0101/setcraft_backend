import { Prisma, NotificationJob } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../config/prisma';
import { fitnessTerm } from '../../utils/fitness_locale';
import { firebaseMessaging } from '../../config/firebase';
import { realMealWhere } from '../../utils/real_data';
import { getmysubscription } from '../subscription/subscription_service';
import { getPlanAvailability } from '../../graphworkflow/service';
import {
  localTime, notificationDevice, notificationPreferences, quietHours,
  effectiveReminder, previousDate, minutes, notificationCategory, notificationPriority,
} from './notifications_types';

export const realWorkoutItems: Prisma.UserWorkoutItemListRelationFilter = {
  some: { NOT: ['preview', 'demo', 'sample', 'synthetic'].map(source => ({
    sourceProvider: { contains: source, mode: 'insensitive' as const },
  })) },
};

export function deliveryReady() {
  try { return firebaseMessaging() !== null; } catch { return false; }
}

export async function getPreferences(userId: string) {
  const preferences = await prisma.notificationPreference.upsert({
    where: { userId }, create: { userId }, update: {},
  });
  const access = await getmysubscription(userId, false);
  const now = new Date();
  const local = localTime(now, preferences.timezone);
  const effective = effectiveReminder(preferences.workoutTime, preferences.quietStart, preferences.quietEnd);
  const start = preferences.pausedUntil && preferences.pausedUntil > now
    ? localTime(preferences.pausedUntil, preferences.timezone).date : local.date;
  const passed = local.minutes >= minutes(effective.time) + 60;
  const activityStart = previousDate(start, effective.dayOffset);
  const workout = preferences.enabled && preferences.workouts ? await prisma.userWorkout.findFirst({
    where: {
      userId, scheduledDate: start === local.date && passed ? { gt: activityStart } : { gte: activityStart },
      status: { in: ['NOT_STARTED', 'IN_PROGRESS'] }, items: realWorkoutItems,
      NOT: { session: { is: { status: 'COMPLETED' } } },
    },
    orderBy: { scheduledDate: 'asc' }, select: { scheduledDate: true },
  }) : null;
  return {
    ...preferences, deliveryReady: deliveryReady(),
    billingInfo: { state: access.state, trialSource: access.trialSource,
      trialEndsAt: access.trialEndsAt, cancelAtPeriodEnd: access.cancelAtPeriodEnd },
    nextWorkoutReminder: workout?.scheduledDate ? {
      date: previousDate(workout.scheduledDate, -effective.dayOffset), time: effective.time,
    } : null,
  };
}

export async function savePreferences(userId: string, changes: z.infer<typeof notificationPreferences>) {
  if (changes.pausedUntil && (new Date(changes.pausedUntil).getTime() <= Date.now() ||
      new Date(changes.pausedUntil).getTime() > Date.now() + 30 * 86400000)) {
    throw new Error('Choose a pause within the next 30 days.');
  }
  await prisma.$transaction(async db => {
    await db.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const current = await db.notificationPreference.findUnique({ where: { userId } });
    const enabledAt = changes.enabled === true && !current?.enabled ? new Date() : undefined;
    await db.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...changes, enabledAt, nextScheduleAt: new Date() },
      update: { ...changes, enabledAt, nextScheduleAt: new Date() },
    });
    if (changes.enabled === false) {
      await db.notificationJob.updateMany({
        where: { userId, status: 'PENDING' }, data: { status: 'SKIPPED', reason: 'DISABLED' },
      });
    }
  });
  return getPreferences(userId);
}

export async function registerDevice(userId: string, input: z.infer<typeof notificationDevice>) {
  const { installationId, token, platform, foreground } = input;
  const foregroundUntil = foreground ? new Date(Date.now() + 90000) : null;
  await prisma.$transaction(async db => {
    await db.notificationDevice.deleteMany({ where: { token, NOT: { installationId } } });
    await db.notificationDevice.upsert({
      where: { installationId },
      create: { userId, installationId, token, platform, foregroundUntil },
      update: { userId, token, platform, lastSeenAt: new Date(), foregroundUntil },
    });
  });
}

export async function removeDevice(userId: string, installationId: string) {
  await prisma.notificationDevice.deleteMany({ where: { userId, installationId } });
}

export async function sendTest(userId: string, installationId: string) {
  const preferences = await getPreferences(userId);
  if (!preferences.enabled) throw new Error('Enable notifications first.');
  if (!preferences.deliveryReady) throw new Error('Push delivery is not configured on the server.');
  const device = await prisma.notificationDevice.findFirst({ where: { userId, installationId } });
  if (!device) throw new Error('Enable notifications on this phone first.');
  await queueNotification({
    userId, type: 'TEST', date: localTime(new Date(), preferences.timezone).date,
    eventKey: ['TEST', installationId, Math.floor(Date.now() / 60000)].join(':'),
    title: 'You’re connected', body: 'Setcraft notifications are ready on this phone.',
    routine: false, deviceIds: [device.id], expiresAt: new Date(Date.now() + 300000),
  });
}

export async function queueNotification(input: Prisma.NotificationJobUncheckedCreateInput) {
  try {
    await prisma.notificationJob.create({
      data: { ...input, priority: input.priority ?? notificationPriority(input.type) },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
  }
}

export async function notificationStillNeeded(job: NotificationJob) {
  const date = job.activityDate ?? job.date;
  if (job.type === 'TEST') return true;
  if (job.type === 'TRIAL_ENDING' || job.type === 'TRIAL_EXPIRED') {
    const access = await getmysubscription(job.userId, false);
    return job.type === 'TRIAL_ENDING'
      ? access.state === 'trial' && access.daysRemaining <= 2 : access.state === 'expired';
  }
  if (job.type === 'WORKOUT') {
    return !!(await prisma.userWorkout.findFirst({ where: {
      id: job.targetId ?? '', userId: job.userId, scheduledDate: date,
      status: { in: ['NOT_STARTED', 'IN_PROGRESS'] }, items: realWorkoutItems,
      NOT: { session: { is: { status: 'COMPLETED' } } },
    } }));
  }
  if (job.type === 'CHECK_IN') {
    const [user, entry] = await Promise.all([
      prisma.user.findUnique({ where: { id: job.userId }, select: { wearableUsage: true } }),
      prisma.dailyWellnessEntry.findUnique({ where: { userId_date: { userId: job.userId, date } } }),
    ]);
    return user?.wearableUsage === 'NONE' && !(entry?.energy && entry.rested && entry.soreness);
  }
  if (job.type === 'MEAL') {
    const [year, month, day] = date.split('-');
    return !(await prisma.userMealLog.findFirst({ where: {
      userId: job.userId, year,
      month: { in: [month, String(Number(month))] }, day: { in: [day, String(Number(day))] },
      status: 'LOGGED', mealType: job.targetId as 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK',
      ...realMealWhere,
    } }));
  }
  if (job.type === 'PLAN_READY' || job.type === 'PLAN_AVAILABLE') {
    const plan = await prisma.weeklyPersonalPlan.findFirst({
      where: { userId: job.userId, synthetic: false }, orderBy: { createdAt: 'desc' },
    });
    if (!plan || plan.id !== job.targetId) return false;
    return job.type === 'PLAN_READY' ? plan.status === 'ACTIVE'
      : (await getPlanAvailability(job.userId)).canGenerate;
  }
  if (job.type === 'SUMMARY') {
    return !!(await prisma.workoutSession.findFirst({ where: {
      userId: job.userId, status: 'COMPLETED',
      date: { gte: previousDate(date, 6), lte: date },
      userWorkout: { items: realWorkoutItems },
    } }));
  }
  return false;
}

export async function deliverNotification(job: NotificationJob, messaging = firebaseMessaging(), now = new Date()) {
  if (!messaging) return;
  const preferences = await prisma.notificationPreference.findUnique({
    where: { userId: job.userId },
    include: { user: { select: { onboarding: { select: { language: true } } } } },
  });
  const finish = (reason: string) => prisma.notificationJob.update({
    where: { id: job.id }, data: { status: 'SKIPPED', leaseUntil: null, reason },
  });
  const defer = (reason: string, until: Date) => prisma.notificationJob.update({
    where: { id: job.id },
    data: { status: 'PENDING', leaseUntil: null, reason, nextAttemptAt: until },
  });
  const category = notificationCategory(job.type);
  const requested = job.type === 'TEST' || job.eventKey.startsWith('SNOOZE:');
  if (job.type !== 'TEST' && !category) { await finish('UNKNOWN_TYPE'); return; }
  if (!preferences?.enabled || (category && !preferences[category])) {
    await finish('DISABLED'); return;
  }
  if (job.expiresAt <= now) { await finish('STALE'); return; }
  if (!requested && category !== 'billing' &&
      preferences.pausedUntil && preferences.pausedUntil > now) {
    await defer('PAUSED', preferences.pausedUntil); return;
  }
  const local = localTime(now, preferences.timezone);
  if (job.routine && local.date !== job.date) { await finish('STALE_DATE'); return; }
  if (!requested && quietHours(local.minutes, preferences.quietStart, preferences.quietEnd)) {
    await defer('QUIET_HOURS', new Date(Date.now() + 60000)); return;
  }
  if (!(await notificationStillNeeded(job))) { await finish('NO_LONGER_NEEDED'); return; }

  if (job.routine && !job.sentAt) {
    const sent = await prisma.notificationJob.count({ where: {
      userId: job.userId, date: local.date, routine: true, sentAt: { not: null }, id: { not: job.id },
    } });
    // Reserve one daily slot for the user's unfinished workout.
    const workout = job.type !== 'WORKOUT' && preferences.workouts
      ? await prisma.userWorkout.findFirst({ where: {
        userId: job.userId, scheduledDate: local.date,
        status: { in: ['NOT_STARTED', 'IN_PROGRESS'] }, items: realWorkoutItems,
        NOT: { session: { is: { status: 'COMPLETED' } } },
      }, select: { id: true } }) : null;
    const workoutSent = workout ? await prisma.notificationJob.findFirst({ where: {
      userId: job.userId, date: local.date, type: 'WORKOUT', targetId: workout.id, sentAt: { not: null },
    }, select: { id: true } }) : null;
    const reserve = !!workout && !workoutSent;
    const summaryNeeded = job.type !== 'WORKOUT' && job.type !== 'SUMMARY' &&
      preferences.summaries && local.weekday === 0 &&
      ((!!workout) || !!(await prisma.workoutSession.findFirst({ where: {
        userId: job.userId, status: 'COMPLETED',
        date: { gte: previousDate(local.date, 6), lte: local.date },
        userWorkout: { items: realWorkoutItems },
      }, select: { id: true } }))) &&
      !(await prisma.notificationJob.findFirst({ where: {
        userId: job.userId, date: local.date, type: 'SUMMARY', sentAt: { not: null },
      }, select: { id: true } }));
    if (sent >= 2 - Number(reserve) - Number(summaryNeeded)) {
      await finish(reserve ? 'WORKOUT_RESERVED' : summaryNeeded ? 'SUMMARY_RESERVED' : 'DAILY_LIMIT'); return;
    }
  }
  const devices = await prisma.notificationDevice.findMany({ where: {
    userId: job.userId, id: { in: job.deviceIds },
    lastSeenAt: { gte: new Date(Date.now() - 60 * 86400000) },
  }, take: 10 });
  if (!devices.length) { await finish('NO_DEVICES'); return; }
  if (job.routine && devices.every(device => device.foregroundUntil && device.foregroundUntil > now)) {
    await defer('APP_ACTIVE', new Date(Date.now() + 60000)); return;
  }

  const retry: string[] = [];
  let successes = 0;
  let errorCode: string | null = null;
  try {
    const result = await messaging.sendEachForMulticast({
      tokens: devices.map(device => device.token),
      notification: {
        title: fitnessTerm(job.title, preferences.user.onboarding?.language ?? 'en'),
        body: fitnessTerm(job.body, preferences.user.onboarding?.language ?? 'en'),
      },
      data: {
        notificationId: job.id, userId: job.userId, type: job.type,
        date: job.activityDate ?? job.date, targetId: job.targetId ?? '',
      },
      android: {
        priority: job.type === 'WORKOUT' || job.type === 'TEST' ? 'high' : 'normal',
        ttl: Math.max(0, job.expiresAt.getTime() - Date.now()), collapseKey: job.id,
        notification: {
          channelId: category === 'billing' ? 'setcraft_account' : job.type === 'SUMMARY' ? 'setcraft_insights' : 'fitai_reminders',
          icon: 'ic_notification', tag: job.id,
        },
      },
      apns: {
        headers: { 'apns-collapse-id': job.id, 'apns-expiration': String(Math.floor(job.expiresAt.getTime() / 1000)) },
        payload: { aps: { sound: 'default' } },
      },
    });
    for (let index = 0; index < result.responses.length; index++) {
      const response = result.responses[index];
      if (response.success) { successes++; continue; }
      errorCode = response.error?.code ?? 'messaging/unknown-error';
      if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(errorCode)) {
        await prisma.notificationDevice.deleteMany({ where: { id: devices[index].id, token: devices[index].token } });
      } else if (['messaging/server-unavailable', 'messaging/internal-error', 'messaging/unknown-error', 'messaging/quota-exceeded'].includes(errorCode)) {
        retry.push(devices[index].id);
      }
    }
  } catch {
    retry.push(...devices.map(device => device.id));
    errorCode = 'messaging/transport-error';
  }
  const attempts = job.attempts + 1;
  await prisma.notificationJob.update({ where: { id: job.id }, data: {
    status: retry.length && attempts < 3 ? 'PENDING' : successes || job.sentAt ? 'SENT' : 'FAILED',
    attempts, deviceIds: retry, leaseUntil: null, errorCode,
    reason: retry.length ? attempts < 3 ? 'RETRY' : 'PARTIAL_FAILURE'
      : errorCode && (successes || job.sentAt) ? 'PARTIAL_FAILURE' : successes ? 'ACCEPTED' : 'DELIVERY_FAILED',
    nextAttemptAt: new Date(Date.now() + attempts * 60000), sentAt: successes ? job.sentAt ?? now : job.sentAt,
  } });
}


export async function snoozeNotification(userId: string, id: string, installationId: string) {
  const job = await prisma.notificationJob.findFirst({ where: { id, userId, type: 'WORKOUT', sentAt: { not: null } } });
  const preferences = await getPreferences(userId);
  if (!job || !preferences.enabled || !preferences.workouts || !(await notificationStillNeeded(job))) {
    throw new Error('This workout no longer needs a reminder.');
  }
  const device = await prisma.notificationDevice.findFirst({ where: { userId, installationId } });
  if (!device) throw new Error('Enable notifications on this phone first.');
  const due = new Date(Date.now() + 15 * 60000);
  await queueNotification({
    userId, type: 'WORKOUT', eventKey: 'SNOOZE:' + job.id + ':' + device.installationId,
    date: localTime(due, preferences.timezone).date, activityDate: job.activityDate ?? job.date,
    targetId: job.targetId, title: job.title, body: job.body, routine: false, deviceIds: [device.id],
    nextAttemptAt: due, expiresAt: new Date(due.getTime() + 3600000),
  });
}

export async function markNotificationOpened(userId: string, id: string) {
  await prisma.notificationJob.updateMany({
    where: { id, userId, sentAt: { not: null }, openedAt: null }, data: { openedAt: new Date() },
  });
}
