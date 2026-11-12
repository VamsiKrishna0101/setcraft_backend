// Cloudflare Worker on api.setcraft.fit/* — sends each user to the nearest
// Setcraft Cloud Run region. Everyone else keeps the default path
// (api.setcraft.fit domain mapping -> us-central1).
//
// Note: the database lives in Supabase us-west-2, so regional servers still
// make every query to Oregon. Regional routing only gets faster once the
// database has replicas in those regions.

const REGIONS = {
  EU: "https://setcraft-backend-9251616044.europe-west1.run.app", // Europe
  AF: "https://setcraft-backend-9251616044.europe-west1.run.app", // Africa
  OC: "https://setcraft-backend-9251616044.australia-southeast1.run.app", // Oceania
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export default {
  async fetch(request) {
    const continent = request.cf?.continent;
    const origin = REGIONS[continent];
    // Subrequests to this zone do not re-enter the Worker: this is the
    // existing us-central1 path.
    if (!origin) return fetch(request);

    const url = new URL(request.url);
    const target = origin + url.pathname + url.search;
    const safe = SAFE_METHODS.has(request.method);
    const fallback = safe ? request.clone() : null;
    const headers = new Headers(request.headers);
    headers.set("X-Setcraft-Edge-Region", continent);

    try {
      const response = await fetch(target, {
        method: request.method,
        headers,
        body: safe ? undefined : request.body,
        redirect: "manual",
      });
      // Read-only requests fail over to us-central1 if the region is unhealthy.
      if (fallback && response.status >= 502 && response.status <= 504) {
        return fetch(fallback);
      }
      return response;
    } catch {
      if (fallback) return fetch(fallback);
      return new Response(
        JSON.stringify({ error: "Service temporarily unavailable. Please retry." }),
        { status: 503, headers: { "content-type": "application/json", "retry-after": "2" } },
      );
    }
  },
};
