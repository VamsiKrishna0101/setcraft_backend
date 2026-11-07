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
  return {
    supportEmail: email(process.env.SUPPORT_EMAIL),
    privacyEmail: email(process.env.PRIVACY_EMAIL),
    privacyPolicyUrl: httpsUrl(process.env.PRIVACY_POLICY_URL),
    termsUrl: httpsUrl(process.env.TERMS_URL),
    privacyPolicyUpdated: process.env.PRIVACY_POLICY_UPDATED?.slice(0, 40) || null,
    aiProvider,
    aiPolicyVersion: `planning-sharing-v1-${createHash('sha256').update([aiProvider,process.env.OPENAI_BASE_URL||'https://api.openai.com/v1'].join('|')).digest('hex').slice(0,12)}`,
  };
}
