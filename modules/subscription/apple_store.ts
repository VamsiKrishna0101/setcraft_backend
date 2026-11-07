import { existsSync, readFileSync } from 'node:fs';
import {
  AppStoreServerAPIClient, Environment, SignedDataVerifier, Status,
  JWSTransactionDecodedPayload, JWSRenewalInfoDecodedPayload,
} from '@apple/app-store-server-library';
import { prices, SubscriptionError } from './subscription_types';

export const appleProducts = () => ({
  monthly: process.env.APPLE_SUBSCRIPTION_MONTHLY_ID || prices.products.monthly,
  annual: process.env.APPLE_SUBSCRIPTION_ANNUAL_ID || prices.products.annual,
});
const environment = () => process.env.APPLE_STORE_ENVIRONMENT === 'Sandbox'
  ? Environment.SANDBOX : Environment.PRODUCTION;
const roots = () => (process.env.APPLE_ROOT_CA_FILES || '').split(';').map(s => s.trim()).filter(Boolean);
export function appleBillingReady() {
  return !!(process.env.APPLE_STORE_KEY_ID && process.env.APPLE_STORE_ISSUER_ID &&
    process.env.APPLE_STORE_BUNDLE_ID && process.env.APPLE_STORE_PRIVATE_KEY_FILE &&
    existsSync(process.env.APPLE_STORE_PRIVATE_KEY_FILE) && roots().length &&
    roots().every(existsSync) &&
    ['Sandbox', 'Production'].includes(process.env.APPLE_STORE_ENVIRONMENT || '') &&
    (environment() === Environment.SANDBOX || Number(process.env.APPLE_STORE_APP_ID) > 0));
}
function configured() {
  if (!appleBillingReady()) throw new SubscriptionError('App Store billing is not configured yet.', 503);
  const bundle = process.env.APPLE_STORE_BUNDLE_ID!;
  return {
    client: new AppStoreServerAPIClient(
      readFileSync(process.env.APPLE_STORE_PRIVATE_KEY_FILE!, 'utf8'),
      process.env.APPLE_STORE_KEY_ID!, process.env.APPLE_STORE_ISSUER_ID!, bundle, environment()),
    // Trust only operator-provisioned Apple roots, never a certificate sent by a client.
    verifier: new SignedDataVerifier(roots().map(path => readFileSync(path)), true,
      environment(), bundle, environment() === Environment.PRODUCTION ? Number(process.env.APPLE_STORE_APP_ID) : undefined),
  };
}
export interface ApplePurchase {
  transaction: JWSTransactionDecodedPayload;
  renewal: JWSRenewalInfoDecodedPayload;
  status: number;
}
export async function readApplePurchase(transactionId: string, signedTransaction?: string): Promise<ApplePurchase> {
  const { client, verifier } = configured();
  try {
    if (signedTransaction) {
      const submitted = await verifier.verifyAndDecodeTransaction(signedTransaction);
      if (submitted.transactionId !== transactionId) throw new SubscriptionError('The App Store transaction does not match.');
    }
    const initial = await client.getTransactionInfo(transactionId);
    if (!initial.signedTransactionInfo) throw new SubscriptionError('Missing App Store transaction.');
    const original = await verifier.verifyAndDecodeTransaction(initial.signedTransactionInfo);
    if (!original.originalTransactionId) throw new SubscriptionError('Missing original transaction.');
    const current = await client.getAllSubscriptionStatuses(original.originalTransactionId);
    const candidates: ApplePurchase[] = [];
    for (const group of current.data ?? []) {
      for (const line of group.lastTransactions ?? []) {
        if (line.originalTransactionId !== original.originalTransactionId ||
            !line.signedTransactionInfo || !line.signedRenewalInfo || line.status == null) continue;
        const transaction = await verifier.verifyAndDecodeTransaction(line.signedTransactionInfo);
        const renewal = await verifier.verifyAndDecodeRenewalInfo(line.signedRenewalInfo);
        if (transaction.originalTransactionId !== original.originalTransactionId ||
            renewal.originalTransactionId !== original.originalTransactionId) {
          throw new SubscriptionError('App Store subscription identity does not match.');
        }
        candidates.push({ transaction, renewal, status: line.status });
      }
    }
    candidates.sort((a, b) => (b.transaction.purchaseDate ?? 0) - (a.transaction.purchaseDate ?? 0));
    if (!candidates[0]) throw new SubscriptionError('App Store subscription status is unavailable.');
    return candidates[0];
  } catch (error) {
    if (error instanceof SubscriptionError) throw error;
    throw new SubscriptionError('Could not verify your App Store membership. Restore purchases to retry.', 503);
  }
}

export function appleEntitlement(purchase: ApplePurchase, userId: string, now = new Date()) {
  const { transaction: tx, renewal, status } = purchase;
  if (tx.appAccountToken?.toLowerCase() !== userId.toLowerCase()) {
    throw new SubscriptionError('This purchase belongs to a different Setcraft account.', 403);
  }
  if (!Object.values(appleProducts()).includes(tx.productId ?? '') ||
      !tx.originalTransactionId || !/^\d{1,64}$/.test(tx.originalTransactionId) ||
      tx.type !== 'Auto-Renewable Subscription') {
    throw new SubscriptionError('This purchase is not a Setcraft subscription.');
  }
  const expiry = status === Status.BILLING_GRACE_PERIOD
    ? renewal.gracePeriodExpiresDate : tx.expiresDate;
  if (!expiry || !Number.isFinite(expiry) || !tx.purchaseDate || !Number.isFinite(tx.purchaseDate)) {
    throw new SubscriptionError('Invalid App Store membership dates.');
  }
  const end = new Date(expiry);
  const active = !tx.revocationDate && !tx.isUpgraded &&
    [Status.ACTIVE, Status.BILLING_GRACE_PERIOD].includes(status) && end > now;
  const cancelAtPeriodEnd = renewal.autoRenewStatus === 0;
  return {
    active, end, start: new Date(tx.purchaseDate),
    originalId: tx.originalTransactionId, productId: tx.productId!,
    trialEnd: tx.offerDiscountType === 'FREE_TRIAL' ? new Date(tx.expiresDate!) : null,
    cancelAtPeriodEnd,
    status: (active ? status === Status.BILLING_GRACE_PERIOD ? 'PAST_DUE' :
      cancelAtPeriodEnd ? 'CANCELED' : 'ACTIVE' : 'EXPIRED') as 'ACTIVE' | 'CANCELED' | 'PAST_DUE' | 'EXPIRED',
  };
}

export async function verifyAppleNotification(signedPayload: string) {
  const { verifier } = configured();
  try {
    const payload = await verifier.verifyAndDecodeNotification(signedPayload);
    const signed = payload.data?.signedTransactionInfo;
    return signed ? await verifier.verifyAndDecodeTransaction(signed) : null;
  } catch {
    throw new SubscriptionError('Invalid App Store notification.', 401);
  }
}
