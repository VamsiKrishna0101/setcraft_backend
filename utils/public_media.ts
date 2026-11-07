// Only public catalogue buckets belong here. User body/progress photos must
// continue through their authenticated storage routes.
export const PUBLIC_MEDIA_BUCKETS = [
  { env: 'R2_EXERCISE_PUBLIC_URL', legacy: 'https://pub-2111ee02db9e4d4396611479b3804ef3.r2.dev' },
  { env: 'R2_EXERCISE_FEMALE_PUBLIC_URL', legacy: 'https://pub-7d883b21f04e4fdab24b23d2b46ec995.r2.dev' },
  { env: 'R2_EXERCISE_IMAGES_PUBLIC_URL', legacy: 'https://pub-96e41025927f40dc87971efaa9b5cf54.r2.dev' },
  { env: 'R2_FOOD_PUBLIC_URL', legacy: 'https://pub-134bda0dd83b4c4793daf0b75e890947.r2.dev' },
] as const;

export function publicMediaOrigin(envName: string, fallback: string): string {
  const value = process.env[envName]?.trim();
  if (!value) return fallback;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || url.port) {
    throw new Error(`${envName} must be an HTTPS origin without a path or credentials`);
  }
  return url.origin;
}

// Translate at the response boundary so existing database rows and Redis
// entries migrate together without destructive data updates or cache flushes.
export function createPublicMediaRewriter() {
  const origins = new Map<string, string>();
  for (const bucket of PUBLIC_MEDIA_BUCKETS) {
    const origin = publicMediaOrigin(bucket.env, bucket.legacy);
    if (origin !== bucket.legacy) origins.set(bucket.legacy, origin);
  }
  if (!origins.size) return (value: unknown) => value;
  function rewrite(value: unknown): unknown {
    if (typeof value === 'string') {
      if (!value.startsWith('https://')) return value;
      try {
        const url = new URL(value);
        const target = origins.get(url.origin);
        // Signed URLs and credentials are never migrated to another host.
        if (!target || url.username || url.password || url.search || url.hash) return value;
        return target + url.pathname;
      } catch { return value; }
    }
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewrite(entry)]));
    }
    return value;
  }
  return rewrite;
}
