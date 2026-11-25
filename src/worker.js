/**
 * SPREAD (spread.haking.tr) — Cloudflare Worker + Static Assets Entry Point
 *
 * Routes:
 *   GET /api/market        -> Live CSFloat + Steam + Youpin898 + Market.CSGO volume (5m Edge cache)
 *   GET /api/steam-verify  -> Live Steam Market 24h sold volume & median price for active desk items (15m cache)
 *   GET /api/fx            -> Live USD / TRY / CNY / EUR exchange rates (1h Edge cache)
 *   *                      -> Cloudflare Static Assets binding (env.ASSETS)
 */

const MARKET_CACHE_TTL = 300; // 5 minutes
const STEAM_CACHE_TTL = 900;  // 15 minutes
const FX_CACHE_TTL = 3600;    // 1 hour

const UPSTREAM = {
  csfloatLive: 'https://csfloat.com/api/v1/listings/price-list',
  csfloatOrders: 'https://prices.csgotrader.app/latest/csfloat.json',
  buff163: 'https://prices.csgotrader.app/latest/buff163.json',
  steam: 'https://prices.csgotrader.app/latest/steam.json',
  youpin: 'https://prices.csgotrader.app/latest/youpin.json',
  marketCsgo: 'https://market.csgo.com/api/v2/prices/USD.json',
  fx: 'https://open.er-api.com/v6/latest/USD'
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

function parseSteamNumber(str) {
  if (!str || typeof str !== 'string') return 0;
  const cleaned = str.replace(/[^0-9.,]/g, '').replace(/,/g, '');
  const v = parseFloat(cleaned);
  return Number.isFinite(v) ? v : 0;
}

async function fetchJsonWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'SpreadTerminal-Worker/1.2 (+https://spread.haking.tr)' }
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
  const cacheKey = new Request(url.origin + '/api/market?v=3', { method: 'GET' });

  if (!forceRefresh) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const headers = new Headers(cached.headers);
        headers.set('X-Spread-Cache', 'HIT');
        return new Response(cached.body, { status: cached.status, headers });
      }
    } catch {
      // Ignore cache errors on workers.dev preview
    }
  }

  try {
    const catalogReq = new Request(url.origin + '/data/catalog.json');
    const snapReq = new Request(url.origin + '/data/market-snapshot.json');

    const [catalogRes, snapRes, cfLiveRes, cfOrdRes, buffRes, steamRes, ypRes, mcsRes] = await Promise.allSettled([
      env.ASSETS.fetch(catalogReq),
      env.ASSETS.fetch(snapReq),
      fetchJsonWithTimeout(UPSTREAM.csfloatLive, 12000),
      fetchJsonWithTimeout(UPSTREAM.csfloatOrders, 12000),
      fetchJsonWithTimeout(UPSTREAM.buff163, 12000),
      fetchJsonWithTimeout(UPSTREAM.steam, 12000),
      fetchJsonWithTimeout(UPSTREAM.youpin, 12000),
      fetchJsonWithTimeout(UPSTREAM.marketCsgo, 12000)
    ]);

    if (catalogRes.status !== 'fulfilled' || !catalogRes.value.ok) {
      return Response.json({ ok: false, error: 'Catalog asset unavailable' }, { status: 500 });
    }

    const catalog = await catalogRes.value.json();
    const baseSnap = snapRes.status === 'fulfilled' && snapRes.value.ok ? await snapRes.value.json() : { prices: {} };
    const cfLiveArr = cfLiveRes.status === 'fulfilled' && Array.isArray(cfLiveRes.value) ? cfLiveRes.value : [];
    const cfOrdObj = cfOrdRes.status === 'fulfilled' && cfOrdRes.value ? cfOrdRes.value : {};
    const buffObj = buffRes.status === 'fulfilled' && buffRes.value ? buffRes.value : {};
    const steamObj = steamRes.status === 'fulfilled' && steamRes.value ? steamRes.value : {};
    const ypObj = ypRes.status === 'fulfilled' && ypRes.value ? ypRes.value : {};
    const mcsItems = mcsRes.status === 'fulfilled' && Array.isArray(mcsRes.value?.items) ? mcsRes.value.items : [];

    const cfLiveMap = new Map();
    for (const row of cfLiveArr) {
      if (row && typeof row.market_hash_name === 'string' && Number.isFinite(row.min_price)) {
        cfLiveMap.set(row.market_hash_name, {
          minUsd: row.min_price / 100,
          qty: Number(row.quantity) || 0
        });
      }
    }

    const mcsMap = new Map();
    for (const row of mcsItems) {
      if (row && typeof row.market_hash_name === 'string') {
        mcsMap.set(row.market_hash_name, Number(row.volume) || 0);
      }
    }

    const prices = {};
    let liveCount = 0;

    for (const item of catalog.items || []) {
      const mhn = item.n;
      const prev = baseSnap.prices?.[mhn] || {};
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
      const bObj = buffObj[mhn];
      const bPrice = Number(bObj?.starting_at?.price) || Number(prev.b) || 0;
      const bOrder = Number(bObj?.highest_order?.price) || Number(prev.bo) || 0;
      const mv = mcsMap.has(mhn) ? mcsMap.get(mhn) : Number(prev.mv) || 0;

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
          yp: ypPrice > 0 ? round2(ypPrice) : 0,
          b: bPrice > 0 ? round2(bPrice) : 0,
          bo: bOrder > 0 ? round2(bOrder) : 0,
          v24: Number(prev.v24) || 0,
          v7: Number(prev.v7) || 0,
          v30: Number(prev.v30) || 0,
          vm: Number(prev.vm) || 0,
          mv
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
        buff163: buffRes.status === 'fulfilled',
        steam: steamRes.status === 'fulfilled',
        youpin: ypRes.status === 'fulfilled',
        marketVol: mcsRes.status === 'fulfilled'
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
      // Ignore
    }
    return response;
  } catch (err) {
    return Response.json(
      { ok: false, error: 'Upstream market sync failed', detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}

/**
 * Live On-Demand Steam 24-Hour Sales Volume & Median Price Verification
 * Accepts up to 3 item names via ?names=Name1|Name2
 */
async function handleSteamVerify(request, ctx) {
  const url = new URL(request.url);
  const rawNames = (url.searchParams.get('names') || '')
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 130)
    .slice(0, 3);

  if (rawNames.length === 0) {
    return Response.json({ ok: false, error: 'names param required' }, { status: 400 });
  }

  const cache = caches.default;
  const cacheKey = new Request(url.origin + '/api/steam-verify?k=' + encodeURIComponent(rawNames.join('|')), {
    method: 'GET'
  });

  try {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  } catch {
    // Ignore
  }

  const results = {};
  await Promise.allSettled(
    rawNames.map(async (name) => {
      try {
        const steamUrl = `https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=${encodeURIComponent(name)}`;
        const data = await fetchJsonWithTimeout(steamUrl, 4500);
        if (data?.success) {
          results[name] = {
            live: true,
            volume24h: Math.round(parseSteamNumber(data.volume)),
            medianUsd: round2(parseSteamNumber(data.median_price)),
            lowestUsd: round2(parseSteamNumber(data.lowest_price))
          };
        }
      } catch {
        // Gracefully skip if Steam rate-limits this edge PoP
      }
    })
  );

  const response = new Response(
    JSON.stringify({ ok: true, updatedAt: new Date().toISOString(), items: results }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${STEAM_CACHE_TTL}, s-maxage=${STEAM_CACHE_TTL}`,
        'X-Content-Type-Options': 'nosniff'
      }
    }
  );

  try {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  } catch {
    // Ignore
  }
  return response;
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
    // Ignore
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
      // Ignore
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

    if (url.pathname === '/api/steam-verify' && request.method === 'GET') {
      return handleSteamVerify(request, ctx);
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
