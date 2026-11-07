export const APP_LANGUAGES = ['en', 'de', 'de-CH', 'fr', 'sv', 'no', 'da', 'nl', 'es', 'it'] as const;
export function appLocale(header?: string | string[], fallback = 'en'): string {
  const first = (Array.isArray(header) ? header[0] : header)?.split(',')[0]?.split(';')[0]?.trim().replace('_', '-');
  const value = first || fallback;
  if (/^de-ch$/i.test(value)) return 'de-CH';
  const language = value.toLowerCase().split('-')[0];
  const normalized = language === 'nb' || language === 'nn' ? 'no' : language;
  return (APP_LANGUAGES as readonly string[]).includes(normalized) ? normalized : 'en';
}
export function contentLocale(locale: string) { return appLocale(locale).split('-')[0]; }
