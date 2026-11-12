import assert from 'node:assert/strict';
import {
  buildTrialReminderEmail, trialReminderPlan, trialReminderWhen, TRIAL_REMINDER_LEAD_MS,
} from '../modules/subscription/trial_reminder_email';

const day = 86400000;
const now = new Date('2026-11-12T09:00:00Z');

// Day 12 of a 14-day trial is exactly two days before it converts.
assert.equal(TRIAL_REMINDER_LEAD_MS, 2 * day);
assert.equal(trialReminderWhen(new Date(now.getTime() + 2 * day), now), 'in 2 days');
assert.equal(trialReminderWhen(new Date(now.getTime() + 36 * 3600000), now), 'in 2 days');
assert.equal(trialReminderWhen(new Date(now.getTime() + 20 * 3600000), now), 'tomorrow');
assert.equal(trialReminderWhen(new Date(now.getTime() - 1000), now), 'tomorrow');

assert.equal(trialReminderPlan('setcraft_monthly'), 'monthly');
assert.equal(trialReminderPlan('setcraft_annual'), 'annual');
assert.equal(trialReminderPlan('setcraft_pro:annual-base'), 'annual');
assert.equal(trialReminderPlan(null), null);

const trialEnd = new Date('2026-11-14T09:00:00Z');
const annual = buildTrialReminderEmail({ trialEnd, plan: 'annual', supportEmail: 'support@setcraft.fit', now });
assert.equal(annual.subject, 'Your Setcraft free trial ends in 2 days');
assert.match(annual.text, /Saturday, November 14, 2026/);
assert.match(annual.text, /Setcraft Pro Annual/);
assert.match(annual.text, /billed once a year/);
assert.match(annual.text, /Cancel at least 24 hours before your trial ends/);
assert.match(annual.text, /Deleting the app does not cancel your subscription/);
assert.match(annual.html, /mailto:support@setcraft\.fit/);
// Honest copy: never promise "no charge" for a store trial.
assert.doesNotMatch(annual.text + annual.html, /no (card|automatic charge)/i);

const monthly = buildTrialReminderEmail({ trialEnd, plan: 'monthly', now: new Date(trialEnd.getTime() - 10 * 3600000) });
assert.equal(monthly.subject, 'Your Setcraft free trial ends tomorrow');
assert.match(monthly.text, /Setcraft Pro Monthly/);
assert.match(monthly.text, /billed every month/);
assert.doesNotMatch(monthly.text, /Questions\?/);

// Untrusted values are escaped in HTML.
const hostile = buildTrialReminderEmail({ trialEnd, plan: null, supportEmail: 'a@b.c"><script>', now });
assert.doesNotMatch(hostile.html, /<script>/);

console.log('trial reminder email tests passed');
