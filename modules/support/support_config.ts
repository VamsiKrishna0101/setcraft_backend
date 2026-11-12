import { createHash } from "node:crypto";
// Public configuration only. Never expose provider keys or database settings.
export function httpsUrl(value?: string) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function email(value?: string) {
  return value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}
export function supportConfig() {
  const aiProvider=process.env.AI_PROVIDER_NAME?.slice(0,100) || (process.env.OPENAI_BASE_URL && !process.env.OPENAI_BASE_URL.startsWith('https://api.openai.com/') ? 'Configured AI provider' : 'OpenAI');
  const rateAppUrl = process.env.APP_REVIEW_URL || process.env.RATE_APP_URL || null;
  return {
    supportEmail: email(process.env.SUPPORT_EMAIL) ?? "support@setcraft.fit",
    privacyEmail: email(process.env.PRIVACY_EMAIL) ?? "privacy@setcraft.fit",
    privacyPolicyUrl: httpsUrl(process.env.PRIVACY_POLICY_URL) ?? "https://sites.google.com/view/setcraft-legal",
    termsUrl: httpsUrl(process.env.TERMS_URL) ?? "https://sites.google.com/view/setcraft-legal/terms-of-use",
    privacyPolicyUpdated: process.env.PRIVACY_POLICY_UPDATED?.slice(0, 40) || "November 2026",
    aiProvider,
    aiPolicyVersion: `planning-sharing-v1-${createHash('sha256').update([aiProvider,process.env.OPENAI_BASE_URL||'https://api.openai.com/v1'].join('|')).digest('hex').slice(0,12)}`,
    rateAppUrl: rateAppUrl ? rateAppUrl.trim() : null,
  };
}
