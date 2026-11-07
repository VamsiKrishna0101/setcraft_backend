import { authenticateRevenueCatWebhook, revenueCatEnabled, syncRevenueCat } from './revenuecat';
import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import prisma from "../../config/prisma";
import { androidPurchase, iosPurchase, SubscriptionError } from "./subscription_types";
import {
  getmysubscription,
  getSubscriptionPricing,
  savePlayPurchase,
  saveApplePurchase,
  startTrial,
} from "./subscription_service";
import { playPackageName, verifyGoogleNotification } from "./google_play";
import { verifyAppleNotification } from './apple_store';

export function handleSubscription(
  action: (req: Request, res: Response) => Promise<unknown>,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await action(req, res);
    } catch (error) {
      if (error instanceof SubscriptionError)
        res.status(error.status).json({ error: error.message });
      else if (error instanceof z.ZodError)
        res.status(400).json({ error: "Invalid subscription request." });
      else next(error);
    }
  };
}

export const status = handleSubscription(async (req, res) => {
  res
    .set("Cache-Control", "no-store")
    .json({ data: await getmysubscription(req.user!.userId, true, req.query.platform === 'ios' ? 'ios' : 'android') });
});

export const pricing = handleSubscription(async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ data: await getSubscriptionPricing(req.user!.userId) });
});

export const trial = handleSubscription(async (req, res) => {
  res.json({ data: await startTrial(req.user!.userId) });
});

export const verify = handleSubscription(async (req, res) => {
  const { purchaseToken } = androidPurchase.parse(req.body);
  const purchase = await savePlayPurchase(req.user!.userId, purchaseToken);
  res.json({
    data: await getmysubscription(req.user!.userId, false),
    purchaseActive: purchase.active,
  });
});

export const verifyIos = handleSubscription(async (req, res) => {
  const { transactionId, signedTransaction } = iosPurchase.parse(req.body);
  const purchase = await saveApplePurchase(req.user!.userId, transactionId, signedTransaction);
  res.json({ data: await getmysubscription(req.user!.userId, false, 'ios'), purchaseActive: purchase.active });
});

export const appleNotification = handleSubscription(async (req, res) => {
  const { signedPayload } = z.object({ signedPayload: z.string().min(10).max(64000) }).parse(req.body);
  const transaction = await verifyAppleNotification(signedPayload);
  if (transaction?.originalTransactionId) {
    const subscription = await prisma.subscription.findUnique({
      where: { gatewaySubscriptionId: `apple:${transaction.originalTransactionId}` },
    });
    if (subscription) await saveApplePurchase(subscription.userId, transaction.originalTransactionId);
  }
  res.status(204).end();
});

export const googleNotification = handleSubscription(async (req, res) => {
  await verifyGoogleNotification(req.headers.authorization);
  const envelope = z
    .object({ message: z.object({ data: z.string().max(32000) }) })
    .parse(req.body);
  let payload: any;
  try {
    payload = JSON.parse(
      Buffer.from(envelope.message.data, "base64").toString("utf8"),
    );
  } catch {
    throw new SubscriptionError("Invalid Google notification.");
  }
  if (payload.packageName !== playPackageName())
    throw new SubscriptionError("Wrong Android package.");

  const token = payload.subscriptionNotification?.purchaseToken;
  if (typeof token === "string" && token.length <= 4096) {
    const subscription = await prisma.subscription.findUnique({
      where: { gatewaySubscriptionId: token },
    });
    // Unknown tokens are linked by the signed-in app's verification/restore flow.
    if (subscription) await savePlayPurchase(subscription.userId, token);
  }
  res.status(204).end();
});

export const revenueCatSync = handleSubscription(async (req, res) => {
  if (!revenueCatEnabled()) throw new SubscriptionError('RevenueCat is disabled.', 503);
  await syncRevenueCat(req.user!.userId);
  res.set('Cache-Control', 'no-store').json({ data: await getmysubscription(req.user!.userId, false) });
});
export const revenueCatNotification = handleSubscription(async (req, res) => {
  authenticateRevenueCatWebhook(req.headers.authorization);
  if (!revenueCatEnabled()) throw new SubscriptionError('RevenueCat is disabled.', 503);
  const { event } = z.object({ event: z.object({
    type: z.string(), app_user_id: z.string().optional(),
    transferred_from: z.array(z.string()).optional(), transferred_to: z.array(z.string()).optional(),
  }) }).parse(req.body);
  const ids = new Set([event.app_user_id, ...(event.transferred_from || []), ...(event.transferred_to || [])].filter((id): id is string => !!id));
  // IDs from notifications are only lookup hints; payload entitlements are never trusted.
  for (const id of ids) {
    if (await prisma.user.findUnique({ where: { id }, select: { id: true } })) await syncRevenueCat(id);
  }
  res.status(200).json({ received: true });
});
