/**
 * SPREAD (spread.haking.tr) — Cloudflare Worker + Static Assets Entry Point
 *
 * Routes:
 *   GET /api/market  -> Live CSFloat + Steam + Youpin898 aggregator (5m Edge cache)
 *   GET /api/fx      -> Live USD / TRY / CNY / EUR exchange rates (1h Edge cache)
 *   *                -> Cloudflare Static Assets binding (env.ASSETS)
 */

const MARKET_CACHE_TTL = 300; // 5 minutes
const FX_CACHE_TTL = 3600;    // 1 hour

const UPSTREAM = {
  csfloatLive: 'https://csfloat.com/api/v1/listings/price-list',
  csfloatOrders: 'https://prices.csgotrader.app/latest/csfloat.json',
  steam: 'https://prices.csgotrader.app/latest/steam.json',
  youpin: 'https://prices.csgotrader.app/latest/youpin.json',
  fx: 'https://open.er-api.com/v6/latest/USD'
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function fetchJsonWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'SpreadTerminal-Worker/1.0 (+https://spread.haking.tr)' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

async function handleApiMarket(request, env, ctx) {
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get('refresh') === '1';
  const cache = caches.default;
  const cacheKey = new Request(url.origin + '/api/market?v=1', { method: 'GET' });

  if (!forceRefresh) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const headers = new Headers(cached.headers);
        headers.set('X-Spread-Cache', 'HIT');
        return new Response(cached.body, { status: cached.status, headers });
      }
    } catch {
      // Ignore cache lookup errors on preview domains
    }
  }

  try {
    const catalogReq = new Request(url.origin + '/data/catalog.json');
    const [catalogRes, cfLiveRes, cfOrdRes, steamRes, ypRes] = await Promise.allSettled([
      env.ASSETS.fetch(catalogReq),
      fetchJsonWithTimeout(UPSTREAM.csfloatLive, 12000),
      fetchJsonWithTimeout(UPSTREAM.csfloatOrders, 12000),
      fetchJsonWithTimeout(UPSTREAM.steam, 12000),
      fetchJsonWithTimeout(UPSTREAM.youpin, 12000)
    ]);

    if (catalogRes.status !== 'fulfilled' || !catalogRes.value.ok) {
      return Response.json({ ok: false, error: 'Catalog asset unavailable' }, { status: 500 });
    }

    const catalog = await catalogRes.value.json();
    const cfLiveArr = cfLiveRes.status === 'fulfilled' && Array.isArray(cfLiveRes.value) ? cfLiveRes.value : [];
    const cfOrdObj = cfOrdRes.status === 'fulfilled' && cfOrdRes.value ? cfOrdRes.value : {};
    const steamObj = steamRes.status === 'fulfilled' && steamRes.value ? steamRes.value : {};
    const ypObj = ypRes.status === 'fulfilled' && ypRes.value ? ypRes.value : {};

    const cfLiveMap = new Map();
    for (const row of cfLiveArr) {
      if (row && typeof row.market_hash_name === 'string' && Number.isFinite(row.min_price)) {
        cfLiveMap.set(row.market_hash_name, {
          minUsd: row.min_price / 100,
          qty: Number(row.quantity) || 0
        });
      }
    }

    const prices = {};
    let liveCount = 0;

    for (const item of catalog.items || []) {
      const mhn = item.n;
      const st = steamObj[mhn];
      const st24 = Number(st?.last_24h) || 0;
      const st7 = Number(st?.last_7d) || 0;
      const st30 = Number(st?.last_30d) || 0;
      const st90 = Number(st?.last_90d) || 0;
      const steamUsd = st24 > 0 ? st24 : st7 > 0 ? st7 : st30;

      const cfLive = cfLiveMap.get(mhn);
      const cfOrd = cfOrdObj[mhn];
      const cfPrice = cfLive?.minUsd || Number(cfOrd?.starting_at?.price) || Number(cfOrd?.price) || 0;
      const cfQty = cfLive?.qty || 0;
      const cfBuyOrder = Number(cfOrd?.highest_order?.price) || 0;
      const ypPrice = Number(ypObj[mhn]) || 0;

      if (steamUsd > 0 && (cfPrice > 0 || ypPrice > 0)) {
        liveCount += 1;
        prices[mhn] = {
          s: round2(steamUsd),
          s7: round2(st7 || steamUsd),
          s30: round2(st30 || steamUsd),
          s90: round2(st90 || steamUsd),
          cf: cfPrice > 0 ? round2(cfPrice) : 0,
          cfo: cfBuyOrder > 0 ? round2(cfBuyOrder) : 0,
          q: cfQty,
          yp: ypPrice > 0 ? round2(ypPrice) : 0
        };
      }
    }

    const payload = {
      ok: true,
      mode: 'live-edge',
      updatedAt: new Date().toISOString(),
      feeds: {
        csfloatLive: cfLiveRes.status === 'fulfilled',
        csfloatOrders: cfOrdRes.status === 'fulfilled',
        steam: steamRes.status === 'fulfilled',
        youpin: ypRes.status === 'fulfilled'
      },
      count: liveCount,
      prices
    };

    const response = new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${MARKET_CACHE_TTL}, s-maxage=${MARKET_CACHE_TTL}`,
        'X-Spread-Cache': 'MISS',
        'X-Content-Type-Options': 'nosniff'
      }
    });

    try {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    } catch {
      // Ignore cache write errors
    }
    return response;
  } catch (err) {
    return Response.json(
      { ok: false, error: 'Upstream market sync failed', detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}

async function handleApiFx(request, ctx) {
  const url = new URL(request.url);
  const cache = caches.default;
  const cacheKey = new Request(url.origin + '/api/fx?v=1', { method: 'GET' });

  try {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set('X-Spread-Cache', 'HIT');
      return new Response(cached.body, { status: cached.status, headers });
    }
  } catch {
    // Ignore cache lookup errors
  }

  try {
    const data = await fetchJsonWithTimeout(UPSTREAM.fx, 10000);
    const rates = data?.rates || {};
    const payload = {
      ok: true,
      base: 'USD',
      updatedAt: data?.time_last_update_utc || new Date().toISOString(),
      rates: {
        USD: 1,
        TRY: Number(rates.TRY) || 50.67,
        CNY: Number(rates.CNY) || 6.68,
        EUR: Number(rates.EUR) || 0.91
      }
    };

    const response = new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${FX_CACHE_TTL}, s-maxage=${FX_CACHE_TTL}`,
        'X-Spread-Cache': 'MISS',
        'X-Content-Type-Options': 'nosniff'
      }
    });

    try {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    } catch {
      // Ignore cache write errors
    }
    return response;
  } catch (err) {
    return Response.json({ ok: false, error: String(err?.message || err) }, { status: 502 });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/market' && request.method === 'GET') {
      return handleApiMarket(request, env, ctx);
    }

    if (url.pathname === '/api/fx' && request.method === 'GET') {
      return handleApiFx(request, ctx);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  }
};
