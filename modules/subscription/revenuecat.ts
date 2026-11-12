import { timingSafeEqual } from 'node:crypto';
import prisma from '../../config/prisma';
import { SubscriptionError } from './subscription_types';

export const revenueCatEnabled = () => process.env.SUBSCRIPTION_PROVIDER === 'revenuecat';
export const revenueCatSandbox = () => process.env.REVENUECAT_ENVIRONMENT === 'sandbox' && process.env.NODE_ENV !== 'production';
export const revenueCatProvider = () => revenueCatSandbox() ? 'revenuecat_sandbox' : 'revenuecat';
export const revenueCatReady = () => !!process.env.REVENUECAT_API_KEY &&
  (!process.env.REVENUECAT_API_KEY.startsWith('test_') || revenueCatSandbox());

export interface RCCustomer {
  subscriber: {
    entitlements: Record<string, { expires_date: string | null; product_identifier: string; purchase_date: string; grace_period_expires_date?: string | null }>;
    subscriptions: Record<string, { is_sandbox: boolean; period_type: string; unsubscribe_detected_at?: string | null; billing_issues_detected_at?: string | null; refunded_at?: string | null; store: string }>;
    management_url?: string | null;
  };
}

// TestFlight, App Review and Play license testers always buy through the real
// store's sandbox, so production must honour those purchases (Apple guideline:
// a production server must accept sandbox receipts). RevenueCat's own
// "test_store" stays limited to non-production sandbox mode.
const STORE_SANDBOXES = new Set(['app_store', 'mac_app_store', 'play_store']);
const storeSandbox = (store: string | undefined) => STORE_SANDBOXES.has(String(store || '').toLowerCase());

export function revenueCatAccess(customer: RCCustomer, now = new Date()) {
  const entitlement = customer.subscriber.entitlements[process.env.REVENUECAT_ENTITLEMENT_ID || 'setcraft_pro'];
  const subscription = entitlement && customer.subscriber.subscriptions[entitlement.product_identifier];
  const expiry = entitlement && new Date(entitlement.grace_period_expires_date || entitlement.expires_date || '');
  const start = entitlement && new Date(entitlement.purchase_date);
  const active = !!(subscription && expiry && start && Number.isFinite(expiry.getTime()) &&
    Number.isFinite(start.getTime()) && expiry > now && !subscription.refunded_at &&
    typeof subscription.is_sandbox === 'boolean' &&
    (!subscription.is_sandbox || revenueCatSandbox() || storeSandbox(subscription.store)));
  return { active, end: expiry && Number.isFinite(expiry.getTime()) ? expiry : now,
    start: start && Number.isFinite(start.getTime()) ? start : now,
    trial: active && subscription?.period_type === 'trial',
    canceled: !!subscription?.unsubscribe_detected_at,
    billingIssue: !!subscription?.billing_issues_detected_at,
    productId: entitlement?.product_identifier };
}

export async function readRevenueCatCustomer(userId: string): Promise<RCCustomer> {
  if (!revenueCatReady()) throw new SubscriptionError('RevenueCat billing is not configured.', 503);
  try {
    const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${process.env.REVENUECAT_API_KEY}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('RevenueCat unavailable');
    const customer = await response.json() as RCCustomer;
    if (!customer.subscriber?.entitlements || !customer.subscriber?.subscriptions) throw new Error('Invalid customer');
    return customer;
  } catch { throw new SubscriptionError('Could not verify your membership. Please retry.', 503); }
}

// Always fetch current trusted state while holding the user lock. Duplicate and
// delayed webhooks cannot replay stale entitlement data into the database.
export async function syncRevenueCat(userId: string, read = readRevenueCatCustomer) {
  return prisma.$transaction(async db => {
    await db.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const customer = await read(userId);
    const access = revenueCatAccess(customer);
    const data = {
      gatewayProvider: revenueCatProvider(), gatewayCustomerId: userId,
      storeProductId: access.productId || null,
      status: (access.active ? access.billingIssue ? 'PAST_DUE' : access.canceled ? 'CANCELED' : 'ACTIVE' : 'EXPIRED') as 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED',
      currentPeriodStart: access.start, currentPeriodEnd: access.end,
      trialEnd: access.trial ? access.end : null, cancelAtPeriodEnd: access.canceled,
      verifiedAt: new Date(),
    };
    const key = `${revenueCatProvider()}:${userId}`;
    await db.subscription.upsert({ where: { gatewaySubscriptionId: key },
      create: { userId, gatewaySubscriptionId: key, startDate: access.start, ...data }, update: data });
    return access;
  }, { timeout: 25000, maxWait: 10000 });
}

export function authenticateRevenueCatWebhook(header?: string) {
  const secret = process.env.REVENUECAT_WEBHOOK_AUTH;
  if (!secret) throw new SubscriptionError('RevenueCat webhook is not configured.', 503);
  const expected = Buffer.from(secret), actual = Buffer.from(header || '');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new SubscriptionError('Invalid webhook authorization.', 401);
  }
}
