import { Prisma } from '@prisma/client';
import prisma, { pool } from '../../config/prisma';
import { sendEmail } from '../../config/brevo';
import { emailLogoUrl } from '../../utils/verification_email';
import { getmysubscription } from './subscription_service';
import { revenueCatProvider } from './revenuecat';

// Store trials last 14 days. We remind on day 12, two days before the store
// converts the trial into a paid subscription, which is what users expect from
// production subscription apps and what keeps refund requests and complaints low.
export const TRIAL_REMINDER_LEAD_MS = 2 * 86400000;
export const TRIAL_REMINDER_TYPE = 'TRIAL_ENDING_EMAIL';
const MAX_ATTEMPTS = 3;
const LOCK_KEY = 796945284190;

type Plan = 'monthly' | 'annual' | null;

export function trialReminderPlan(productId?: string | null): Plan {
  if (!productId) return null;
  if (/annual|year/i.test(productId)) return 'annual';
  if (/month/i.test(productId)) return 'monthly';
  return null;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function trialReminderWhen(trialEnd: Date, now = new Date()) {
  const days = Math.max(1, Math.ceil((trialEnd.getTime() - now.getTime()) / 86400000));
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

export function buildTrialReminderEmail(input: { trialEnd: Date; plan: Plan; supportEmail?: string; logoUrl?: string; now?: Date }) {
  const when = trialReminderWhen(input.trialEnd, input.now);
  const date = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(input.trialEnd);
  const planName = input.plan === 'annual' ? 'Setcraft Pro Annual'
    : input.plan === 'monthly' ? 'Setcraft Pro Monthly' : 'Setcraft Pro';
  const billing = input.plan === 'annual' ? 'billed once a year' : input.plan === 'monthly' ? 'billed every month' : 'billed each period';
  const support = input.supportEmail?.includes('@') ? input.supportEmail : undefined;
  const subject = `Your Setcraft free trial ends ${when}`;
  const text = `Your Setcraft free trial ends ${when}

Your 14-day free trial ends on ${date} (UTC).

Unless you cancel before then, your ${planName} subscription starts automatically and is ${billing} through your App Store or Google Play account, at the price you saw when you started the trial.

Want to keep training? You don't need to do anything.

Want to cancel? Cancel at least 24 hours before your trial ends and you won't be charged:
- iPhone: Settings > your name > Subscriptions > Setcraft > Cancel Subscription
- Android: Google Play > profile icon > Payments & subscriptions > Subscriptions > Setcraft > Cancel

Deleting the app does not cancel your subscription.
${support ? `\nQuestions? Reply to this email or contact ${support}.\n` : ''}
Setcraft
You're receiving this because you started a free trial of Setcraft Pro.`;

  const logo = input.logoUrl ? `<img src="${escapeHtml(input.logoUrl)}" width="120" alt="Setcraft" style="display:block;border:0;margin:0 0 24px">` : '<p style="margin:0 0 24px;font-size:14px;font-weight:700;letter-spacing:2px">SETCRAFT</p>';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px"><tr><td style="padding:40px 32px">
${logo}
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.3">Your free trial ends ${escapeHtml(when)}</h1>
<p style="margin:0 0 16px;font-size:16px;line-height:1.6">Your 14-day free trial ends on <strong>${escapeHtml(date)}</strong> (UTC).</p>
<p style="margin:0 0 16px;font-size:16px;line-height:1.6">Unless you cancel before then, your <strong>${escapeHtml(planName)}</strong> subscription starts automatically and is ${escapeHtml(billing)} through your App Store or Google Play account, at the price you saw when you started the trial.</p>
<p style="margin:0 0 24px;font-size:16px;line-height:1.6"><strong>Want to keep training?</strong> You don't need to do anything.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;border-radius:12px"><tr><td style="padding:20px">
<p style="margin:0 0 8px;font-size:15px;font-weight:700">Want to cancel?</p>
<p style="margin:0 0 12px;font-size:14px;line-height:1.6">Cancel at least 24 hours before your trial ends and you won't be charged.</p>
<p style="margin:0 0 6px;font-size:14px;line-height:1.6"><strong>iPhone:</strong> Settings &rsaquo; your name &rsaquo; Subscriptions &rsaquo; Setcraft &rsaquo; Cancel Subscription</p>
<p style="margin:0;font-size:14px;line-height:1.6"><strong>Android:</strong> Google Play &rsaquo; profile icon &rsaquo; Payments &amp; subscriptions &rsaquo; Subscriptions &rsaquo; Setcraft &rsaquo; Cancel</p>
</td></tr></table>
<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#52525b">Deleting the app does not cancel your subscription.${support ? ` Questions? Contact <a href="mailto:${escapeHtml(support)}" style="color:#18181b">${escapeHtml(support)}</a>.` : ''}</p>
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#71717a">You're receiving this because you started a free trial of Setcraft Pro.</p>
</td></tr></table></body></html>`;
  return { subject, html, text };
}

const storeProviders = () => ['apple', 'google_play', revenueCatProvider()];

// Queues one reminder per trial (keyed by its end time). The unique
// (userId, eventKey) ledger makes this safe across restarts and replicas.
export async function queueTrialReminderEmails(now = new Date()) {
  const due = await prisma.subscription.findMany({
    where: {
      gatewayProvider: { in: storeProviders() },
      status: 'ACTIVE', cancelAtPeriodEnd: false,
      trialEnd: { gt: now, lte: new Date(now.getTime() + TRIAL_REMINDER_LEAD_MS) },
    },
    select: { userId: true, trialEnd: true },
    take: 500,
  });
  let queued = 0;
  for (const row of due) {
    try {
      await prisma.notificationJob.create({ data: {
        userId: row.userId, type: TRIAL_REMINDER_TYPE,
        eventKey: `${TRIAL_REMINDER_TYPE}:${row.trialEnd!.toISOString()}`,
        date: now.toISOString().slice(0, 10), title: 'Your Setcraft free trial ends in 2 days',
        body: 'Trial reminder email', routine: false, deviceIds: [],
        // Not 'PENDING': the push dispatcher only handles PENDING jobs.
        status: 'EMAIL_PENDING', expiresAt: row.trialEnd!,
      } });
      queued++;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    }
  }
  return queued;
}

export async function sendTrialReminderEmails(now = new Date(), send = sendEmail) {
  // Recover jobs left mid-send by a crashed worker.
  await prisma.notificationJob.updateMany({
    where: { type: TRIAL_REMINDER_TYPE, status: 'EMAIL_SENDING', leaseUntil: { lt: now } },
    data: { status: 'EMAIL_PENDING', leaseUntil: null },
  });
  const jobs = await prisma.notificationJob.findMany({
    where: { type: TRIAL_REMINDER_TYPE, status: 'EMAIL_PENDING', nextAttemptAt: { lte: now } },
    orderBy: { createdAt: 'asc' }, take: 100,
  });
  let sent = 0;
  for (const job of jobs) {
    const claimed = await prisma.notificationJob.updateMany({
      where: { id: job.id, status: 'EMAIL_PENDING' },
      data: { status: 'EMAIL_SENDING', leaseUntil: new Date(now.getTime() + 300000) },
    });
    if (!claimed.count) continue;
    const finish = (status: string, reason: string) => prisma.notificationJob.update({
      where: { id: job.id }, data: { status, reason, leaseUntil: null },
    });
    try {
      if (job.expiresAt <= now) { await finish('SKIPPED', 'STALE'); continue; }
      // Re-check live store state: never remind someone who already cancelled.
      const access = await getmysubscription(job.userId, true);
      if (access.state !== 'trial' || access.trialSource !== 'store' || access.cancelAtPeriodEnd) {
        await finish('SKIPPED', 'NO_LONGER_NEEDED'); continue;
      }
      const [user, subscription] = await Promise.all([
        prisma.user.findUnique({ where: { id: job.userId }, select: { email: true } }),
        prisma.subscription.findFirst({
          where: { userId: job.userId, gatewayProvider: { in: storeProviders() }, trialEnd: { not: null } },
          orderBy: { currentPeriodEnd: 'desc' }, select: { storeProductId: true, trialEnd: true },
        }),
      ]);
      if (!user?.email?.includes('@') || !subscription?.trialEnd) { await finish('SKIPPED', 'NO_EMAIL'); continue; }
      const message = buildTrialReminderEmail({
        trialEnd: subscription.trialEnd, plan: trialReminderPlan(subscription.storeProductId),
        supportEmail: process.env.SUPPORT_EMAIL, logoUrl: emailLogoUrl(), now,
      });
      await send(user.email, message.subject, message.html, message.text);
      await prisma.notificationJob.update({
        where: { id: job.id }, data: { status: 'SENT', sentAt: new Date(), leaseUntil: null, attempts: { increment: 1 } },
      });
      sent++;
    } catch (error) {
      const attempts = job.attempts + 1;
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'SEND_FAILED';
      console.warn(JSON.stringify({ event: 'trial_reminder_email.failed', code }));
      await prisma.notificationJob.update({ where: { id: job.id }, data: {
        status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'EMAIL_PENDING', attempts, leaseUntil: null,
        errorCode: code, nextAttemptAt: new Date(now.getTime() + attempts * 15 * 60000),
      } });
    }
  }
  return sent;
}

export function trialReminderEmailReady() {
  return !!process.env.BREVO_API_KEY && !!process.env.BREVO_SENDER_EMAIL;
}

export function startTrialReminderEmailWorker(intervalMs = 15 * 60000) {
  if (!trialReminderEmailReady()) {
    console.warn('Trial reminder emails are off: BREVO_API_KEY and BREVO_SENDER_EMAIL are required.');
    return;
  }
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    const client = await pool.connect().catch(() => null);
    if (!client) { running = false; return; }
    let locked = false;
    try {
      // One replica at a time; the ledger still prevents duplicates if this is bypassed.
      locked = (await client.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_KEY])).rows[0].locked;
      if (locked) {
        await queueTrialReminderEmails();
        await sendTrialReminderEmails();
      }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN';
      console.warn(JSON.stringify({ event: 'trial_reminder_email.worker_failed', code }));
    } finally {
      try { if (locked) await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]); }
      finally { client.release(); running = false; }
    }
  };
  void run();
  setInterval(() => void run(), intervalMs).unref();
}
