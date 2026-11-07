import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../config/prisma';
import { syncRevenueCat, RCCustomer } from '../modules/subscription/revenuecat';
import { getmysubscription } from '../modules/subscription/subscription_service';

async function main() {
  process.env.SUBSCRIPTION_PROVIDER = 'revenuecat';
  process.env.REVENUECAT_ENVIRONMENT = 'sandbox';
  process.env.NODE_ENV = 'test';
  const id = randomUUID();
  const end = new Date(Date.now() + 86400000).toISOString();
  const payload: RCCustomer = { subscriber: {
    entitlements: { setcraft_pro: { product_identifier: 'monthly',
      purchase_date: new Date().toISOString(), expires_date: end } },
    subscriptions: { monthly: { is_sandbox: true, period_type: 'trial', store: 'test_store' } },
  } };
  try {
    await prisma.user.create({ data: { id, email: `revenuecat-${id}@example.invalid`, password: 'not-a-login' } });
    const read = async (owner: string) => { assert.equal(owner, id); return payload; };
    await syncRevenueCat(id, read);
    let access = await getmysubscription(id, false);
    assert.equal(access.state, 'trial');
    assert.equal(access.hasAccess, true);
    assert.equal(access.billingProvider, 'revenuecat');
    await syncRevenueCat(id, read);
    assert.equal(await prisma.subscription.count({ where: { userId: id } }), 1);
    payload.subscriber.subscriptions.monthly.period_type = 'normal';
    payload.subscriber.subscriptions.monthly.unsubscribe_detected_at = new Date().toISOString();
    await syncRevenueCat(id, read);
    access = await getmysubscription(id, false);
    assert.equal(access.state, 'active');
    assert.equal(access.cancelAtPeriodEnd, true);
    process.env.NODE_ENV = 'production';
    assert.equal((await getmysubscription(id, false)).hasAccess, false, 'Cached sandbox rows cannot unlock production');
    process.env.NODE_ENV = 'test';
    payload.subscriber.entitlements = {};
    await syncRevenueCat(id, read);
    assert.equal((await getmysubscription(id, false)).hasAccess, false);
    await prisma.user.update({ where: { id }, data: { trialStartedAt: new Date(), trialEndsAt: new Date(end) } });
    assert.equal((await getmysubscription(id, false)).hasAccess, true, 'Existing legacy trial remains valid');
    console.log('RevenueCat database integration passed: trial, cancellation, expiry, replay and legacy access.');
  } finally {
    await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
