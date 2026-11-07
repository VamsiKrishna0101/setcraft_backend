import { createHash } from "node:crypto";
import { z } from "zod";
import prices from "../../data/subscription_prices.json";

export { prices };

export const androidPurchase = z.object({
  purchaseToken: z.string().min(10).max(4096),
});
export const iosPurchase = z.object({
  transactionId: z.string().regex(/^\d{1,64}$/),
  signedTransaction: z.string().min(10).max(32000).optional(),
});

export class SubscriptionError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function billingAccountId(userId: string) {
  return createHash("sha256").update(`fitai:${userId}`).digest("hex");
}

export function accessState(
  trialEnd: Date | null,
  paidEnd: Date | null,
  now = new Date(),
) {
  if (paidEnd && paidEnd > now) return "active";
  if (trialEnd && trialEnd > now) return "trial";
  return trialEnd ? "expired" : "available";
}

export interface PlayPurchase {
  subscriptionState: string;
  startTime?: string;
  regionCode?: string;
  acknowledgementState?: string;
  linkedPurchaseToken?: string;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: Array<{
    productId: string;
    expiryTime: string;
    offerDetails?: { basePlanId?: string; offerId?: string };
    autoRenewingPlan?: { autoRenewEnabled?: boolean };
    offerPhase?: { freeTrial?: Record<string, unknown> };
  }>;
}

export function playEntitlement(purchase: PlayPurchase, now = new Date()) {
  const item = purchase.lineItems?.find(
    (line) =>
      (line.productId === prices.products.monthly &&
        line.offerDetails?.basePlanId === prices.basePlans.monthly) ||
      (line.productId === prices.products.annual &&
        line.offerDetails?.basePlanId === prices.basePlans.annual),
  );

  if (!item) throw new SubscriptionError("This purchase is not a Setcraft plan.");

  const end = new Date(item.expiryTime);
  if (!Number.isFinite(end.getTime()))
    throw new SubscriptionError("Invalid purchase expiry.");

  const state = purchase.subscriptionState;
  const active =
    [
      "SUBSCRIPTION_STATE_ACTIVE",
      "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
      "SUBSCRIPTION_STATE_CANCELED",
    ].includes(state) && end > now;

  return {
    item,
    end,
    active,
    status: active
      ? state === "SUBSCRIPTION_STATE_CANCELED"
        ? "CANCELED"
        : state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
          ? "PAST_DUE"
          : "ACTIVE"
      : state === "SUBSCRIPTION_STATE_PENDING"
        ? "INCOMPLETE"
        : ["SUBSCRIPTION_STATE_PAUSED", "SUBSCRIPTION_STATE_ON_HOLD"].includes(
              state,
            )
          ? "PAUSED"
          : "EXPIRED",
  } as const;
}

// Configured country amounts are previews. Store products determine checkout.
export function subscriptionPricing(countryCode: string | null) {
  const countries = Object.entries(prices.countries).map(([code, price]) => ({
    code,
    ...price,
    annualSavings: Math.max(0, Math.round((1 - price.annual / (price.monthly * 12)) * 100)),
    annualSavingsAmount: Math.max(0, Math.round((price.monthly * 12 - price.annual) * 100) / 100),
  }));
  return {
    source: 'planned' as const,
    trialDays: prices.trialDays,
    countryCode: countryCode?.toUpperCase() ?? null,
    countries,
  };
}
