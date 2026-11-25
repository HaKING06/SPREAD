/**
 * Cloudflare Pages Function: GET /api/fx
 * Live USD -> TRY / CNY / EUR exchange rates with 1-hour Edge caching.
 */

const CACHE_TTL_SECONDS = 3600;
const FX_ENDPOINT = 'https://open.er-api.com/v6/latest/USD';

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const cache = caches.default;
  const cacheKey = new Request(url.origin + '/api/fx?v=1', { method: 'GET' });

  const cached = await cache.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set('X-Spread-Cache', 'HIT');
    return new Response(cached.body, { status: cached.status, headers });
  }

  try {
    const res = await fetch(FX_ENDPOINT, {
      headers: { 'User-Agent': 'SpreadTerminal-FX/1.0 (+https://spread.haking.tr)' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rates = data?.rates || {};

    const payload = {
      ok: true,
      base: 'USD',
      updatedAt: data?.time_last_update_utc || new Date().toISOString(),
      rates: {
        USD: 1,
        TRY: Number(rates.TRY) || 34.5,
        CNY: Number(rates.CNY) || 7.25,
        EUR: Number(rates.EUR) || 0.92
      }
    };

    const response = new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`,
        'X-Spread-Cache': 'MISS',
        'X-Content-Type-Options': 'nosniff'
      }
    });

    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    return Response.json({ ok: false, error: String(err?.message || err) }, { status: 502 });
  }
}
