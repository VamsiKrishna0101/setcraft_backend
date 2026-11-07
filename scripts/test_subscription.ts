import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../config/prisma";
import express from "express";
import jwt from "jsonwebtoken";
import subscriptionRoutes from "../modules/subscription/subscription_routes";
import { authenticateStrict } from "../middleware/auth";
import { requirePremium } from "../modules/subscription/subscription_service";
import {
  accessState,
  billingAccountId,
  playEntitlement,
  PlayPurchase,
  prices,
  subscriptionPricing,
} from "../modules/subscription/subscription_types";
import {
  assertPremium,
  getmysubscription,
  savePlayPurchase,
  saveApplePurchase,
  startTrial,
} from "../modules/subscription/subscription_service";
import { appleEntitlement, appleProducts, ApplePurchase } from '../modules/subscription/apple_store';

async function main() {
  assert.equal(prices.countries.US.monthly, 9.99);
  assert.equal(prices.countries.US.annual, 69);
  const now = new Date("2026-10-14T12:00:00Z");
  const future = new Date(now.getTime() + 86400000);
  assert.equal(accessState(null, null, now), "available");
  assert.equal(accessState(future, null, now), "trial");
  assert.equal(accessState(now, null, now), "expired");
  assert.equal(accessState(now, future, now), "active");

  const base: PlayPurchase = {
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    lineItems: [
      {
        productId: prices.products.monthly,
        expiryTime: future.toISOString(),
        offerDetails: { basePlanId: prices.basePlans.monthly },
        autoRenewingPlan: { autoRenewEnabled: true },
      },
    ],
  };
  for (const state of ["ACTIVE", "CANCELED", "IN_GRACE_PERIOD"]) {
    assert.equal(
      playEntitlement(
        { ...base, subscriptionState: `SUBSCRIPTION_STATE_${state}` },
        now,
      ).active,
      true,
    );
  }
  for (const state of [
    "PENDING",
    "PAUSED",
    "ON_HOLD",
    "EXPIRED",
    "PENDING_PURCHASE_CANCELED",
  ]) {
    assert.equal(
      playEntitlement(
        { ...base, subscriptionState: `SUBSCRIPTION_STATE_${state}` },
        now,
      ).active,
      false,
    );
  }
  assert.equal(playEntitlement(base, future).active, false);
  assert.throws(() =>
    playEntitlement(
      {
        ...base,
        lineItems: [{ ...base.lineItems![0], productId: "other_app" }],
      },
      now,
    ),
  );
  assert.throws(() =>
    playEntitlement(
      {
        ...base,
        lineItems: [
          { ...base.lineItems![0], offerDetails: { basePlanId: "other" } },
        ],
      },
      now,
    ),
  );
  assert.throws(() =>
    playEntitlement(
      { ...base, lineItems: [{ ...base.lineItems![0], expiryTime: "broken" }] },
      now,
    ),
  );

  const catalog = subscriptionPricing('dk');
  assert.equal(catalog.countryCode, 'DK');
  assert.equal(catalog.source, 'planned');
  assert.equal(catalog.countries.length, Object.keys(prices.countries).length);
  const denmark = catalog.countries.find(country => country.code === 'DK')!;
  assert.equal(denmark.currency, 'DKK');
  assert.equal(denmark.monthly, 99);
  assert.equal(denmark.annual, 749);
  assert.equal(denmark.annualSavings, 37);
  assert.equal(denmark.annualSavingsAmount, 439);
  assert.equal(subscriptionPricing('ZZ').countryCode, 'ZZ', 'Unknown countries never silently become another market.');
  for (const country of catalog.countries) {
    assert(country.monthly > 0 && country.annual > 0);
    assert.equal(country.annualSavings, Math.round((1 - country.annual / (country.monthly * 12)) * 100));
  }
  const ids = [randomUUID(), randomUUID()];
  try {
    for (const id of ids)
      await prisma.user.create({
        data: {
          id,
          email: `billing-test-${id}@example.invalid`,
          password: "not-a-login",
        },
      });
    const userId = ids[0];
    assert.equal((await getmysubscription(userId)).state, "available");
    await assert.rejects(() => assertPremium(userId), /Start your trial/);
    const attempts = await Promise.allSettled([startTrial(userId), startTrial(userId), startTrial(userId)]);
    assert(attempts.every(result => result.status === 'rejected'), 'The old endpoint cannot grant a trial.');
    assert.equal((await getmysubscription(userId)).trialEndsAt, null);
    // Honor a trial granted by an older build until its original expiry.
    const legacyStart = new Date();
    await prisma.user.update({ where: { id: userId }, data: {
      trialStartedAt: legacyStart, trialEndsAt: new Date(legacyStart.getTime() + 14 * 86400000),
    } });
    const preserved = await startTrial(userId);
    assert.equal(preserved.trialEndsAt!.getTime() - legacyStart.getTime(), 14 * 86400000);
    assert.equal(preserved.trialSource, 'legacy');
    await assertPremium(userId);
    await prisma.user.update({
      where: { id: userId },
      data: { trialEndsAt: new Date(Date.now() - 1000) },
    });
    await assert.rejects(() => startTrial(userId), /store trial/);
    await assert.rejects(() => assertPremium(userId), /Start your trial/);

    let acknowledgements = 0;
    let purchase: PlayPurchase = {
      ...base,
      regionCode: "DK",
      startTime: new Date().toISOString(),
      externalAccountIdentifiers: {
        obfuscatedExternalAccountId: billingAccountId(userId),
      },
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
      lineItems: [
        {
          ...base.lineItems![0],
          expiryTime: new Date(Date.now() + 86400000).toISOString(),
        },
      ],
    };
    const gateway = {
      read: async () => purchase,
      acknowledge: async () => {
        acknowledgements++;
        purchase.acknowledgementState = "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";
      },
    };
    const token = `test-token-${randomUUID()}`;
    await savePlayPurchase(userId, token, gateway);
    await savePlayPurchase(userId, token, gateway);
    assert.equal(acknowledgements, 1);
    assert.equal(
      await prisma.subscription.count({
        where: { userId, gatewaySubscriptionId: token },
      }),
      1,
    );
    assert.equal((await getmysubscription(userId, false)).state, "active");
    purchase.lineItems![0].offerPhase = { freeTrial: {} };
    await savePlayPurchase(userId, token, gateway);
    const nativeTrial = await getmysubscription(userId, false);
    assert.equal(nativeTrial.state, 'trial');
    assert.equal(nativeTrial.trialSource, 'store');
    delete purchase.lineItems![0].offerPhase;
    await savePlayPurchase(userId, token, gateway);
    await assert.rejects(
      () => savePlayPurchase(ids[1], token, gateway),
      /another account/,
    );
    await assert.rejects(
      () => savePlayPurchase(ids[1], `unowned-${randomUUID()}`, gateway),
      /different Setcraft account/,
    );
    assert.equal(
      await prisma.subscription.count({ where: { userId: ids[1] } }),
      0,
    );

    purchase.subscriptionState = "SUBSCRIPTION_STATE_CANCELED";
    await savePlayPurchase(userId, token, gateway);
    assert.equal((await getmysubscription(userId, false)).hasAccess, true);
    assert.equal(
      (await getmysubscription(userId, false)).cancelAtPeriodEnd,
      true,
    );
    purchase.subscriptionState = "SUBSCRIPTION_STATE_ON_HOLD";
    await savePlayPurchase(userId, token, gateway);
    assert.equal((await getmysubscription(userId, false)).hasAccess, false);
    // The adapter represents already signature-verified Apple API responses.
    // Untrusted app payloads never call appleEntitlement directly in production.
    let apple: ApplePurchase = { status: 1, transaction: {
      originalTransactionId: '200000000000001', transactionId: '200000000000002',
      productId: appleProducts().annual, type: 'Auto-Renewable Subscription',
      appAccountToken: ids[1], purchaseDate: Date.now(), expiresDate: Date.now() + 86400000,
      offerDiscountType: 'FREE_TRIAL',
    }, renewal: { autoRenewStatus: 1, originalTransactionId: '200000000000001' } };
    const appleGateway = { read: async () => apple };
    assert.throws(() => appleEntitlement(apple, userId), /different Setcraft account/);
    assert.throws(() => appleEntitlement({ ...apple, transaction: { ...apple.transaction, productId: 'foreign' } }, ids[1]), /not a Setcraft/);
    assert.equal(appleEntitlement({ ...apple, status: 5 }, ids[1]).active, false);
    assert.equal(appleEntitlement({ ...apple, transaction: { ...apple.transaction, revocationDate: Date.now() } }, ids[1]).active, false);
    assert.equal(appleEntitlement({ ...apple, transaction: { ...apple.transaction, isUpgraded: true } }, ids[1]).active, false);
    const grace = appleEntitlement({ ...apple, status: 4, transaction: {
      ...apple.transaction, expiresDate: Date.now() - 1000,
    }, renewal: { ...apple.renewal, gracePeriodExpiresDate: Date.now() + 86400000 } }, ids[1]);
    assert.equal(grace.active, true);
    assert.equal(grace.status, 'PAST_DUE');
    await saveApplePurchase(ids[1], '200000000000002', undefined, appleGateway);
    await saveApplePurchase(ids[1], '200000000000002', undefined, appleGateway);
    assert.equal((await getmysubscription(ids[1], false, 'ios')).trialSource, 'store');
    assert.equal(await prisma.subscription.count({ where: { userId: ids[1], gatewayProvider: 'apple' } }), 1);
    await assert.rejects(() => saveApplePurchase(userId, '200000000000002', undefined, appleGateway), /different Setcraft account/);
    apple = { ...apple, status: 5 };
    await saveApplePurchase(ids[1], '200000000000002', undefined, appleGateway);
    assert.equal((await getmysubscription(ids[1], false, 'ios')).hasAccess, false);
    purchase.subscriptionState = "SUBSCRIPTION_STATE_PENDING";
    purchase.acknowledgementState = "ACKNOWLEDGEMENT_STATE_PENDING";
    await savePlayPurchase(userId, token, gateway);
    assert.equal(acknowledgements, 1);
    assert.equal((await getmysubscription(userId, false)).hasAccess, false);
    purchase.subscriptionState = "SUBSCRIPTION_STATE_ACTIVE";
    purchase.acknowledgementState = "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";
    await savePlayPurchase(userId, token, gateway);
    assert.equal((await getmysubscription(userId, false)).hasAccess, true);
    purchase.subscriptionState = "SUBSCRIPTION_STATE_EXPIRED";
    await savePlayPurchase(userId, token, gateway);
    assert.equal((await getmysubscription(userId, false)).hasAccess, false);
    const app = express();
    app.use(express.json());
    app.use("/api/subscription", subscriptionRoutes);
    app.post("/premium", authenticateStrict, requirePremium, (_req, res) =>
      res.json({ ok: true }),
    );
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    try {
      const address = server.address() as { port: number };
      const root = `http://127.0.0.1:${address.port}`;
      const token = jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET!, {
        expiresIn: "1h",
      });
      const headers = { Authorization: `Bearer ${token}` };
      assert.equal(
        (await fetch(root + "/api/subscription/status")).status,
        401,
      );
      assert.equal(
        (await fetch(root + "/api/subscription/status", { headers })).status,
        200,
      );
      assert.equal((await fetch(root + '/api/subscription/pricing')).status, 401);
      const pricingResponse = await fetch(root + '/api/subscription/pricing', { headers });
      assert.equal(pricingResponse.status, 200);
      const pricingBody = await pricingResponse.json() as { data: ReturnType<typeof subscriptionPricing> };
      assert.equal(pricingBody.data.countries.length, catalog.countries.length);
      assert.equal(pricingBody.data.source, 'planned');
      const denied = await fetch(root + "/premium", {
        method: "POST",
        headers,
      });
      assert.equal(denied.status, 402);
      assert.equal((await fetch(root + '/api/subscription/start-trial', { method: 'POST', headers })).status, 409);
      assert.equal((await denied.json() as { code: string }).code, "SUBSCRIPTION_REQUIRED");
      await prisma.user.update({
        where: { id: userId },
        data: { trialEndsAt: new Date(Date.now() + 86400000) },
      });
      assert.equal(
        (await fetch(root + "/premium", { method: "POST", headers })).status,
        200,
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    console.log(
      "Subscription checks passed: strict checkout, legacy expiry, ownership, idempotency, Play and Apple lifecycle, authenticated API guards.",
    );
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
