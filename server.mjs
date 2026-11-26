#!/usr/bin/env node
/**
 * SPREAD (spread.haking.tr) — Zero-Dependency Local Development & Live Proxy Server
 *
 * Serves static project files AND mirrors the exact Cloudflare Pages Functions:
 *   - GET /api/market  (live CSFloat + Steam + Youpin898 aggregator, 5m in-memory cache)
 *   - GET /api/fx      (live USD/TRY/CNY/EUR FX rates, 1h in-memory cache)
 *
 * Usage:
 *   node server.mjs
 *   PORT=8788 node server.mjs
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://community.akamai.steamstatic.com https://community.cloudflare.steamstatic.com https://raw.githubusercontent.com",
    "connect-src 'self' https://open.er-api.com",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join('; ')
};

const cacheStore = {
  market: { expiresAt: 0, payload: null },
  fx: { expiresAt: 0, payload: null },
  steamVerify: new Map()
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

async function fetchJsonTimeout(url, ms = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'SpreadTerminal-Local/1.0 (+https://spread.haking.tr)' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function handleApiMarket(res, forceRefresh) {
  const now = Date.now();
  if (!forceRefresh && cacheStore.market.payload && now < cacheStore.market.expiresAt) {
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'X-Spread-Cache': 'HIT'
    });
    res.end(cacheStore.market.payload);
    return;
  }

  try {
    const [catalogRaw, snapRaw] = await Promise.all([
      fs.readFile(path.join(PUBLIC_DIR, 'data', 'catalog.json'), 'utf8'),
      fs.readFile(path.join(PUBLIC_DIR, 'data', 'market-snapshot.json'), 'utf8')
    ]);
    const catalog = JSON.parse(catalogRaw);
    const baseSnap = JSON.parse(snapRaw);

    const [cfLiveRes, cfOrdRes, buffRes, steamRes, ypRes, mcsRes] = await Promise.allSettled([
      fetchJsonTimeout('https://csfloat.com/api/v1/listings/price-list', 15000),
      fetchJsonTimeout('https://prices.csgotrader.app/latest/csfloat.json', 15000),
      fetchJsonTimeout('https://prices.csgotrader.app/latest/buff163.json', 15000),
      fetchJsonTimeout('https://prices.csgotrader.app/latest/steam.json', 15000),
      fetchJsonTimeout('https://prices.csgotrader.app/latest/youpin898.json', 15000),
      fetchJsonTimeout('https://market.csgo.com/api/v2/prices/USD.json', 15000)
    ]);

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
      const ypNode = ypObj[mhn];
      const ypPrice = Number(ypNode?.starting_at?.price ?? ypNode) || Number(prev.yp) || 0;
      const ypBuyOrder = Number(ypNode?.highest_order?.price) || Number(prev.ypo) || 0;
      const bObj = buffObj[mhn];
      const bPrice = Number(bObj?.starting_at?.price) || Number(prev.b) || 0;
      const bOrder = Number(bObj?.highest_order?.price) || Number(prev.bo) || 0;
      const mv = mcsMap.has(mhn) ? mcsMap.get(mhn) : Number(prev.mv) || 0;

        const isEstSteam = steamUsd <= 0 && (item.c === 'Knives' || item.c === 'Gloves') && cfPrice > 0;
        const effSteamUsd = isEstSteam ? Number(prev.s) || round2(Math.min(1850, Math.max(cfPrice, bPrice) * 1.32)) : steamUsd;

        if (effSteamUsd > 0 && (cfPrice > 0 || ypPrice > 0)) {
          liveCount += 1;
          prices[mhn] = {
            s: round2(effSteamUsd),
            s7: round2(st7 || effSteamUsd),
            s30: round2(st30 || effSteamUsd),
            s90: round2(st90 || effSteamUsd),
            ...(isEstSteam ? { sEst: 1 } : {}),
            cf: cfPrice > 0 ? round2(cfPrice) : 0,
            cfo: cfBuyOrder > 0 ? round2(cfBuyOrder) : 0,
            q: cfQty,
            yp: ypPrice > 0 ? round2(ypPrice) : 0,
            ypo: ypBuyOrder > 0 ? round2(ypBuyOrder) : 0,
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

      const jsonStr = JSON.stringify({
        ok: true,
        mode: 'live-local',
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
      });

      cacheStore.market = { expiresAt: now + 5 * 60 * 1000, payload: jsonStr };
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'X-Spread-Cache': 'MISS'
      });
      res.end(jsonStr);
    } catch (err) {
      res.writeHead(502, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
    }
  }

async function handleApiFx(res) {
    const now = Date.now();
    if (cacheStore.fx.payload && now < cacheStore.fx.expiresAt) {
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'X-Spread-Cache': 'HIT'
      });
      res.end(cacheStore.fx.payload);
      return;
    }

    try {
      const data = await fetchJsonTimeout('https://open.er-api.com/v6/latest/USD', 10000);
      const rates = data?.rates || {};
      const jsonStr = JSON.stringify({
        ok: true,
        base: 'USD',
        updatedAt: data?.time_last_update_utc || new Date().toISOString(),
        rates: {
          USD: 1,
          TRY: Number(rates.TRY) || 34.5,
          CNY: Number(rates.CNY) || 7.25,
          EUR: Number(rates.EUR) || 0.92
        }
      });
      cacheStore.fx = { expiresAt: now + 60 * 60 * 1000, payload: jsonStr };
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'X-Spread-Cache': 'MISS'
      });
      res.end(jsonStr);
    } catch (err) {
      res.writeHead(502, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
    }
  }

  function parseCsfloatGraph(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const now = new Date();
    const utcDayFrac = (now.getUTCHours() + now.getUTCMinutes() / 60) / 24;
    const todayCnt = Number(arr[0]?.count) || 0;
    const ydayCnt = Number(arr[1]?.count) || 0;
    const rolling24h = Math.max(todayCnt, Math.round(todayCnt + ydayCnt * Math.max(0, 1 - utcDayFrac)));
    const s7 = arr.slice(0, 7).reduce((a, x) => a + (Number(x?.count) || 0), 0);
    const s30 = arr.slice(0, 30).reduce((a, x) => a + (Number(x?.count) || 0), 0);
    const weightedSum = arr.slice(0, 7).reduce((a, x) => a + (Number(x?.avg_price) || 0) * (Number(x?.count) || 0), 0);
    const avg7Usd = s7 > 0 ? round2(weightedSum / s7 / 100) : 0;
    return { live: true, sold24h: rolling24h, sold7d: s7, sold30d: s30, avg7Usd };
  }

  async function handleSteamVerify(res, reqUrl) {
    // CS2 skin names contain "|", so use repeated ?name= params (or ;; fallback)
    const multiNames = reqUrl.searchParams.getAll('name');
    const legacyNames = (reqUrl.searchParams.get('names') || '')
      .split(';;')
      .map((s) => s.trim())
      .filter(Boolean);
    const names = Array.from(new Set([...multiNames, ...legacyNames].map((s) => s.trim())))
      .filter((s) => s.length > 0 && s.length <= 130)
      .slice(0, 6);

    if (names.length === 0) {
      res.writeHead(400, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'name param required' }));
      return;
    }

    const mkt = (reqUrl.searchParams.get('mkt') || 'CSFLOAT').toUpperCase() === 'YOUPIN' ? 'YOUPIN' : 'CSFLOAT';
    const key = `${mkt}:${names.join(';;')}`;
    const now = Date.now();
    const cached = cacheStore.steamVerify.get(key);
    if (cached && now < cached.expiresAt) {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(cached.payload);
      return;
    }

    const results = {};
    await Promise.allSettled(
      names.map(async (name) => {
        const enc = encodeURIComponent(name);
        const tasks = [
          fetchJsonTimeout(`https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=${enc}`, 5000)
        ];
        if (mkt === 'CSFLOAT') {
          tasks.push(fetchJsonTimeout(`https://csfloat.com/api/v1/history/${enc}/graph`, 5500));
        }
        const [stRes, cfRes] = await Promise.allSettled(tasks);
        const entry = { live: false, volume24h: 0, medianUsd: 0, lowestUsd: 0, csfloat: null };
        if (stRes?.status === 'fulfilled' && stRes.value?.success) {
          entry.live = true;
          entry.volume24h = Math.round(parseSteamNumber(stRes.value.volume));
          entry.medianUsd = round2(parseSteamNumber(stRes.value.median_price));
          entry.lowestUsd = round2(parseSteamNumber(stRes.value.lowest_price));
        }
        if (mkt === 'CSFLOAT' && cfRes?.status === 'fulfilled') {
          const parsedCf = parseCsfloatGraph(cfRes.value);
          if (parsedCf) entry.csfloat = parsedCf;
        }
        if (entry.live || entry.csfloat?.live) {
          results[name] = entry;
        }
      })
    );

    const payload = JSON.stringify({ ok: true, updatedAt: new Date().toISOString(), items: results });
    cacheStore.steamVerify.set(key, { expiresAt: now + 15 * 60 * 1000, payload });
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(payload);
  }

  function normalizeLookupText(str) {
    return String(str || '')
      .replace(/[★™|()\-_]/g, ' ')
      .replace(/İ/g, 'i')
      .replace(/ı/g, 'i')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function inferWearCode(name) {
    if (name.includes('(Factory New)')) return 'FN';
    if (name.includes('(Minimal Wear)')) return 'MW';
    if (name.includes('(Field-Tested)')) return 'FT';
    if (name.includes('(Well-Worn)')) return 'WW';
    if (name.includes('(Battle-Scarred)')) return 'BS';
    return '';
  }

  function inferCategory(name) {
    if (name.startsWith('★') && /Gloves|Wraps/i.test(name)) return 'Gloves';
    if (name.startsWith('★')) return 'Knives';
    if (/Case$/i.test(name)) return 'Case';
    if (/Capsule/i.test(name)) return 'Capsule';
    if (/^(AK-47|M4A4|M4A1-S|AWP|AUG|SG 553|FAMAS|Galil|SSG 08|SCAR-20|G3SG1)/i.test(name)) return 'Rifles';
    if (/^(Desert Eagle|USP-S|Glock-18|P250|Five-SeveN|Tec-9|CZ75|Dual Berettas|P2000|R8 Revolver)/i.test(name)) return 'Pistols';
    return 'Skin';
  }

  async function handleItemLookup(res, reqUrl) {
    const rawQ = (reqUrl.searchParams.get('q') || '').trim();
    const normQ = normalizeLookupText(rawQ);
    if (normQ.length < 2 || rawQ.length > 130) {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, items: [] }));
      return;
    }

    const tokens = normQ
      .split(' ')
      .filter(Boolean)
      .slice(0, 8)
      .map((tok) =>
        tok === 'fn' ? 'factory' : tok === 'mw' ? 'minimal' : tok === 'ft' ? 'field' : tok === 'ww' ? 'well' : tok === 'bs' ? 'battle' : tok
      );

    const [cfLiveRes, cfOrdRes, steamRes, buffRes, ypRes] = await Promise.allSettled([
      fetchJsonTimeout('https://csfloat.com/api/v1/listings/price-list', 10000),
      fetchJsonTimeout('https://prices.csgotrader.app/latest/csfloat.json', 10000),
      fetchJsonTimeout('https://prices.csgotrader.app/latest/steam.json', 10000),
      fetchJsonTimeout('https://prices.csgotrader.app/latest/buff163.json', 10000),
      fetchJsonTimeout('https://prices.csgotrader.app/latest/youpin898.json', 10000)
    ]);

    const cfLiveArr = cfLiveRes.status === 'fulfilled' && Array.isArray(cfLiveRes.value) ? cfLiveRes.value : [];
    const cfOrdObj = cfOrdRes.status === 'fulfilled' && cfOrdRes.value ? cfOrdRes.value : {};
    const steamObj = steamRes.status === 'fulfilled' && steamRes.value ? steamRes.value : {};
    const buffObj = buffRes.status === 'fulfilled' && buffRes.value ? buffRes.value : {};
    const ypObj = ypRes.status === 'fulfilled' && ypRes.value ? ypRes.value : {};

    const cfMap = new Map();
    for (const row of cfLiveArr) {
      if (row && typeof row.market_hash_name === 'string' && Number.isFinite(row.min_price)) {
        cfMap.set(row.market_hash_name, { cf: row.min_price / 100, q: Number(row.quantity) || 0 });
      }
    }

    const allNames = new Set([...cfMap.keys(), ...Object.keys(steamObj)]);
    const hits = [];
    for (const mhn of allNames) {
      const normName = normalizeLookupText(mhn);
      if (!tokens.every((tok) => normName.includes(tok))) continue;
      const cfInfo = cfMap.get(mhn);
      const cfOrd = cfOrdObj[mhn];
      const st = steamObj[mhn];
      const bObj = buffObj[mhn];
      const cfPrice = cfInfo?.cf || Number(cfOrd?.starting_at?.price) || Number(cfOrd?.price) || 0;
      const st24 = Number(st?.last_24h) || 0;
      const st7 = Number(st?.last_7d) || 0;
      const st30 = Number(st?.last_30d) || 0;
      const st90 = Number(st?.last_90d) || 0;
      const steamUsd = st24 > 0 ? st24 : st7 > 0 ? st7 : st30;
      const ypNode = ypObj[mhn];
      const ypPrice = Number(ypNode?.starting_at?.price ?? ypNode) || 0;
      const ypBuyOrder = Number(ypNode?.highest_order?.price) || 0;
      if (cfPrice <= 0 && steamUsd <= 0 && ypPrice <= 0) continue;

      const bPrice = Number(bObj?.starting_at?.price) || 0;
      const isEstSteam = steamUsd <= 0;
      const effSteam = steamUsd > 0 ? steamUsd : round2(Math.min(1850, Math.max(cfPrice, ypPrice, bPrice) * 1.25));

      hits.push({
        exact: normName === normQ ? 1 : 0,
        n: mhn,
        c: inferCategory(mhn),
        w: inferWearCode(mhn),
        r: mhn.startsWith('★') ? 'Covert' : 'Classified',
        rc: mhn.startsWith('★') ? '#eb4b4b' : '#d32ce6',
        st: mhn.includes('StatTrak') ? 1 : 0,
        sv: mhn.includes('Souvenir') ? 1 : 0,
        img: '',
        s: round2(effSteam),
        s7: round2(st7 || effSteam),
        s30: round2(st30 || effSteam),
        s90: round2(st90 || effSteam),
        ...(isEstSteam ? { sEst: 1 } : {}),
        cf: round2(cfPrice),
        cfo: round2(Number(cfOrd?.highest_order?.price) || 0),
        q: cfInfo?.q || 0,
        yp: round2(ypPrice),
        ypo: round2(ypBuyOrder),
        b: round2(bPrice),
        bo: round2(Number(bObj?.highest_order?.price) || 0),
        v24: 0,
        v7: 0,
        v30: 0,
        mv: 0,
        liveLookup: true
      });
    }

    hits.sort((a, b) => b.exact - a.exact || (b.q || 0) - (a.q || 0) || (b.cf || 0) - (a.cf || 0));
    const out = hits.slice(0, 12).map(({ exact, ...rest }) => rest);
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, items: out }));
  }

  const BLOCKED_PREFIXES = ['/scripts/', '/functions/', '/src/', '/.git', '/.github/', '/server.mjs'];

  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url || '/', `http://${HOST}:${PORT}`);
      const pathname = decodeURIComponent(reqUrl.pathname);

      if (pathname === '/api/market' && req.method === 'GET') {
        await handleApiMarket(res, reqUrl.searchParams.get('refresh') === '1');
        return;
      }

      if (pathname === '/api/steam-verify' && req.method === 'GET') {
        await handleSteamVerify(res, reqUrl);
        return;
      }

      if (pathname === '/api/item-lookup' && req.method === 'GET') {
        await handleItemLookup(res, reqUrl);
        return;
      }

      if (pathname === '/api/fx' && req.method === 'GET') {
        await handleApiFx(res);
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, SECURITY_HEADERS);
        res.end('Method Not Allowed');
        return;
      }

      if (BLOCKED_PREFIXES.some((p) => pathname.startsWith(p))) {
        res.writeHead(403, SECURITY_HEADERS);
        res.end('Forbidden');
        return;
      }

      const safeRel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const resolved = path.resolve(PUBLIC_DIR, safeRel);
      if (!resolved.startsWith(PUBLIC_DIR + path.sep) && resolved !== path.join(PUBLIC_DIR, 'index.html')) {
        res.writeHead(403, SECURITY_HEADERS);
        res.end('Forbidden');
        return;
      }

      let filePath = resolved;
      try {
        const stat = await fs.stat(filePath);
        if (stat.isDirectory()) {
          filePath = path.join(filePath, 'index.html');
        }
      } catch {
        // Clean SPA route fallback matching Cloudflare not_found_handling = "single-page-application"
        if (['/masa', '/hesaplayici', '/calculator', '/tarayici', '/scanner', '/takip', '/tracker', '/akademi', '/academy', '/about', '/hakkinda'].includes(pathname)) {
          filePath = path.join(PUBLIC_DIR, 'index.html');
        } else {
          res.writeHead(404, SECURITY_HEADERS);
          res.end('Not Found');
          return;
        }
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const buf = await fs.readFile(filePath);

      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': contentType,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300'
      });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        res.end(buf);
      }
    } catch (err) {
      res.writeHead(500, SECURITY_HEADERS);
      res.end('Internal Server Error');
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`\n  SPREAD — CS2 Arbitrage Terminal (spread.haking.tr)`);
    console.log(`  Local Live Server: http://${HOST}:${PORT}`);
    console.log(`  Live API Endpoints: /api/market | /api/fx\n`);
  });
