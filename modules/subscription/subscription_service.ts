import { revenueCatEnabled, revenueCatReady, revenueCatSandbox, revenueCatProvider, syncRevenueCat } from './revenuecat';
import { NextFunction, Request, Response } from "express";
import prisma from "../../config/prisma";
import {
  accessState,
  billingAccountId,
  playEntitlement,
  prices,
  SubscriptionError,
  subscriptionPricing,
} from "./subscription_types";
import {
  acknowledgePurchase,
  billingReady,
  readPlayPurchase,
} from "./google_play";
import { appleBillingReady, appleProducts, appleEntitlement, readApplePurchase } from './apple_store';

export async function getSubscriptionPricing(userId: string) {
  const profile = await prisma.onboarding.findUnique({
    where: { userId },
    select: { countryCode: true },
  });
  return subscriptionPricing(profile?.countryCode ?? null);
}

export async function getmysubscription(userId: string, refresh = true, platform = 'android') {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { trialStartedAt: true, trialEndsAt: true },
  });

  let subscriptions = await prisma.subscription.findMany({
    where: { userId, gatewayProvider: { in: ['google_play', 'apple', revenueCatProvider()] } },
    orderBy: { currentPeriodEnd: "desc" },
  });

  if (revenueCatEnabled() && refresh) {
    const cached = subscriptions.find(p => p.gatewayProvider === revenueCatProvider());
    if (!cached?.verifiedAt || cached.verifiedAt.getTime() < Date.now() - 30000) {
      await syncRevenueCat(userId);
      subscriptions = await prisma.subscription.findMany({ where: { userId,
        gatewayProvider: { in: ['google_play', 'apple', revenueCatProvider()] } }, orderBy: { currentPeriodEnd: 'desc' } });
    }
  }
  // RTDN normally updates immediately. Recheck periodically if a webhook was missed.
  const latest =
    subscriptions.find(
      (plan) =>
        ["ACTIVE", "CANCELED", "PAST_DUE"].includes(plan.status) &&
        plan.currentPeriodEnd.getTime() > Date.now(),
    ) ?? subscriptions[0];
  if (
    refresh &&
    !latest?.gatewayProvider?.startsWith('revenuecat') &&
    latest?.gatewaySubscriptionId &&
    (!latest.verifiedAt || latest.verifiedAt.getTime() < Date.now() - 3600000)
  ) {
    if (latest.gatewayProvider === 'apple') {
      await saveApplePurchase(userId, latest.gatewaySubscriptionId.replace(/^apple:/, ''));
    } else await savePlayPurchase(userId, latest.gatewaySubscriptionId);
    subscriptions = await prisma.subscription.findMany({
      where: { userId, gatewayProvider: { in: ['google_play', 'apple', revenueCatProvider()] } },
      orderBy: { currentPeriodEnd: "desc" },
    });
  }

  const now = new Date();
  const paid = subscriptions.find(
    (plan) =>
      ["ACTIVE", "CANCELED", "PAST_DUE"].includes(plan.status) &&
      plan.currentPeriodEnd > now,
  );
  const nativeTrial = paid?.trialEnd && paid.trialEnd > now ? paid.trialEnd : null;
  const trialEnd = nativeTrial ?? user.trialEndsAt;
  const baseState = accessState(
    user.trialEndsAt,
    paid?.currentPeriodEnd ?? null,
    now,
  );
  const state = nativeTrial ? 'trial' : baseState === 'available' && subscriptions.length ? 'expired' : baseState;

  return {
    state,
    hasAccess: state === "active" || state === "trial",
    trialDays: prices.trialDays,
    trialStartedAt: nativeTrial ? paid!.currentPeriodStart : user.trialStartedAt,
    trialEndsAt: trialEnd,
    trialSource: nativeTrial ? 'store' : 'legacy',
    serverTime: now,
    daysRemaining:
      state === "trial"
        ? Math.ceil((trialEnd!.getTime() - now.getTime()) / 86400000)
        : 0,
    paidUntil: paid?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: paid?.cancelAtPeriodEnd ?? false,
    paymentIssue: paid?.status === "PAST_DUE",
    billingReady:
      (revenueCatEnabled() ? revenueCatReady() : platform === 'ios' ? appleBillingReady() : billingReady()) &&
      ((revenueCatEnabled() && revenueCatSandbox()) || (!!legalUrl(process.env.SUBSCRIPTION_TERMS_URL) &&
      !!legalUrl(process.env.SUBSCRIPTION_PRIVACY_URL))),
    billingProvider: revenueCatEnabled() ? 'revenuecat' : 'native',
    revenueCatAppUserId: userId,
    termsUrl: legalUrl(process.env.SUBSCRIPTION_TERMS_URL) || testInformationUrl('terms'),
    privacyUrl: legalUrl(process.env.SUBSCRIPTION_PRIVACY_URL) || testInformationUrl('privacy'),
    accountId: billingAccountId(userId),
    appleAccountId: userId,
    products: platform === 'ios' ? appleProducts() : prices.products,
    basePlans: prices.basePlans,
  };
}

function legalUrl(value?: string) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function testInformationUrl(page: 'terms' | 'privacy') {
  if (!revenueCatEnabled() || !revenueCatSandbox()) return null;
  const origin = legalUrl(process.env.REVENUECAT_TEST_PUBLIC_ORIGIN);
  return origin ? `${new URL(origin).origin}/api/subscription/testing/${page}` : null;
}

export async function startTrial(userId: string) {
  const current = await getmysubscription(userId);
  if (current.hasAccess) return current; // Honor trials that were already granted.
  if (revenueCatSandbox()) {
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + 14 * 86400000);
    await prisma.user.update({
      where: { id: userId },
      data: { trialStartedAt: now, trialEndsAt },
    });
    return getmysubscription(userId, false);
  }
  throw new SubscriptionError('Choose a membership in the app to start your eligible 14-day store trial.', 409);
}

export async function savePlayPurchase(
  userId: string,
  token: string,
  gateway = { read: readPlayPurchase, acknowledge: acknowledgePurchase },
) {
  const result = await prisma.$transaction(
    async (db) => {
      await db.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const existing = await db.subscription.findUnique({
        where: { gatewaySubscriptionId: token },
      });
      if (existing && existing.userId !== userId) {
        throw new SubscriptionError(
          "This purchase is already linked to another account.",
          403,
        );
      }

      // Read inside the lock: delayed/repeated notifications cannot overwrite newer Play state.
      const purchase = await gateway.read(token);
      if (
        purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId !==
        billingAccountId(userId)
      ) {
        throw new SubscriptionError(
          "This purchase belongs to a different Setcraft account.",
          403,
        );
      }
      const entitlement = playEntitlement(purchase);
      const start = purchase.startTime
        ? new Date(purchase.startTime)
        : new Date();
      if (!Number.isFinite(start.getTime()))
        throw new SubscriptionError("Invalid purchase start.");

      const data = {
        status: entitlement.status,
        currentPeriodStart: start,
        currentPeriodEnd: entitlement.end,
        trialEnd: entitlement.item.offerPhase?.freeTrial != null ? entitlement.end : null,
        gatewayProvider: "google_play",
        gatewayCustomerId: billingAccountId(userId),
        storeProductId: entitlement.item.productId,
        storeBasePlanId: entitlement.item.offerDetails?.basePlanId,
        storeCountryCode: purchase.regionCode,
        cancelAtPeriodEnd:
          purchase.subscriptionState === "SUBSCRIPTION_STATE_CANCELED" ||
          entitlement.item.autoRenewingPlan?.autoRenewEnabled === false,
        verifiedAt: new Date(),
      };
      await db.subscription.upsert({
        where: { gatewaySubscriptionId: token },
        create: {
          userId,
          gatewaySubscriptionId: token,
          startDate: start,
          ...data,
        },
        update: data,
      });
      if (purchase.linkedPurchaseToken) {
        await db.subscription.updateMany({
          where: {
            userId,
            gatewaySubscriptionId: purchase.linkedPurchaseToken,
          },
          data: {
            status: "EXPIRED",
            currentPeriodEnd: new Date(),
            verifiedAt: new Date(),
          },
        });
      }
      return {
        ...entitlement,
        acknowledge:
          purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING",
      };
    },
    { timeout: 25000, maxWait: 10000 },
  );

  if (result.active && result.acknowledge)
    await gateway.acknowledge(token, result.item.productId);
  return { active: result.active, status: result.status, end: result.end };
}

export async function saveApplePurchase(userId: string, transactionId: string,
  signedTransaction?: string, gateway = { read: readApplePurchase }) {
  return prisma.$transaction(async db => {
    await db.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const verified = await gateway.read(transactionId, signedTransaction);
    const entitlement = appleEntitlement(verified, userId);
    const key = `apple:${entitlement.originalId}`;
    const existing = await db.subscription.findUnique({ where: { gatewaySubscriptionId: key } });
    if (existing && existing.userId !== userId) {
      throw new SubscriptionError('This purchase is already linked to another account.', 403);
    }
    const data = {
      status: entitlement.status, currentPeriodStart: entitlement.start,
      currentPeriodEnd: entitlement.end, trialEnd: entitlement.trialEnd,
      gatewayProvider: 'apple', gatewayCustomerId: userId,
      storeProductId: entitlement.productId, storeBasePlanId: null,
      storeCountryCode: verified.transaction.storefront,
      cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd, verifiedAt: new Date(),
    };
    await db.subscription.upsert({ where: { gatewaySubscriptionId: key },
      create: { userId, gatewaySubscriptionId: key, startDate: entitlement.start, ...data }, update: data });
    return { active: entitlement.active, status: entitlement.status, end: entitlement.end };
  }, { timeout: 25000, maxWait: 10000 });
}

export async function assertPremium(userId: string) {
  const access = await getmysubscription(userId);
  if (!access.hasAccess)
    throw new SubscriptionError(
      "Start your trial or subscribe to continue.",
      402,
    );
}

export async function requirePremium(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    await assertPremium(req.user!.userId);
    next();
  } catch (error) {
    if (error instanceof SubscriptionError) {
      res
        .status(error.status)
        .json({
          error: error.message,
          code:
            error.status === 402
              ? "SUBSCRIPTION_REQUIRED"
              : "BILLING_UNAVAILABLE",
        });
    } else next(error);
  }
}
