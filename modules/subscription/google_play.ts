import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { PlayPurchase, prices, SubscriptionError } from "./subscription_types";

const publisher = new GoogleAuth({
  keyFilename: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE,
  scopes: ["https://www.googleapis.com/auth/androidpublisher"],
});

const identity = new OAuth2Client();
export const playPackageName = () =>
  process.env.GOOGLE_PLAY_PACKAGE_NAME || prices.androidPackageName;
const root = () =>
  `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(playPackageName())}`;

export function billingReady() {
  return !!(
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  );
}

export async function readPlayPurchase(token: string): Promise<PlayPurchase> {
  if (!billingReady())
    throw new SubscriptionError(
      "Google Play billing is not configured yet.",
      503,
    );
  try {
    const client = await publisher.getClient();
    const result = await client.request<PlayPurchase>({
      url: `${root()}/purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}`,
      timeout: 15000,
    });
    return result.data;
  } catch (error: any) {
    const code = error?.response?.status;
    throw new SubscriptionError(
      code === 404 || code === 400
        ? "Google Play could not verify this purchase."
        : "Could not contact Google Play. Try again shortly.",
      code === 404 || code === 400 ? 400 : 503,
    );
  }
}

export async function acknowledgePurchase(token: string, product: string) {
  const client = await publisher.getClient();
  try {
    await client.request({
      url: `${root()}/purchases/subscriptions/${encodeURIComponent(product)}/tokens/${encodeURIComponent(token)}:acknowledge`,
      method: "POST",
      data: {},
      timeout: 15000,
    });
  } catch {
    throw new SubscriptionError(
      "Purchase saved. Restore purchases to retry confirmation with Google Play.",
      503,
    );
  }
}

export async function verifyGoogleNotification(authorization?: string) {
  const audience = process.env.GOOGLE_PLAY_RTDN_AUDIENCE;
  const email = process.env.GOOGLE_PLAY_RTDN_EMAIL;
  if (!audience || !email)
    throw new SubscriptionError("Play notifications are not configured.", 503);

  const token = /^Bearer (\S+)$/.exec(authorization ?? "")?.[1];
  if (!token)
    throw new SubscriptionError("Google authentication required.", 401);

  try {
    const ticket = await identity.verifyIdToken({ idToken: token, audience });
    const claims = ticket.getPayload();
    if (claims?.email !== email || !claims.email_verified)
      throw new Error("Wrong publisher");
  } catch {
    throw new SubscriptionError("Invalid Google notification identity.", 401);
  }
}
