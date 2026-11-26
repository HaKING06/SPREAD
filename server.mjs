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

const PHASE_SUFFIX_RE = /\s+-\s+(Phase [1-4]|Ruby|Sapphire|Black Pearl|Emerald)$/i;
const GEM_PHASE_SET = new Set(['Ruby', 'Sapphire', 'Emerald', 'Black Pearl']);

function stripPhaseSuffix(name) {
  return String(name || '').replace(PHASE_SUFFIX_RE, '').trim();
}

function expandSearchTokens(normQ) {
  const out = [];
  for (const tok of normQ.split(' ').filter(Boolean).slice(0, 8)) {
    if (tok === 'fn') out.push('factory');
    else if (tok === 'mw') out.push('minimal');
    else if (tok === 'ft') out.push('field');
    else if (tok === 'ww') out.push('well');
    else if (tok === 'bs') out.push('battle');
    else if (tok === 'p1') out.push('phase', '1');
    else if (tok === 'p2') out.push('phase', '2');
    else if (tok === 'p3') out.push('phase', '3');
    else if (tok === 'p4') out.push('phase', '4');
    else if (tok === 'bp') out.push('black', 'pearl');
    else if (tok === 'sap' || tok === 'saphire') out.push('sapphire');
    else if (tok === 'em') out.push('emerald');
    else if (tok === 'rub') out.push('ruby');
    else out.push(tok);
  }
  return out;
}

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
      const key = item.n;
      const baseMhn = item.mhn || item.n;
      const ph = item.ph || '';
      const prev = baseSnap.prices?.[key] || {};
      const st = steamObj[baseMhn];
      const st24 = Number(st?.last_24h) || 0;
      const st7 = Number(st?.last_7d) || 0;
      const st30 = Number(st?.last_30d) || 0;
      const st90 = Number(st?.last_90d) || 0;
      const steamUsd = st24 > 0 ? st24 : st7 > 0 ? st7 : st30;

      const cfLive = cfLiveMap.get(baseMhn);
      const cfOrd = cfOrdObj[baseMhn];
      const ypNode = ypObj[baseMhn];
      const bObj = buffObj[baseMhn];

      const baseCfMin = cfLive?.minUsd || Number(cfOrd?.starting_at?.price) || Number(cfOrd?.price) || 0;
      const baseBuffMin = Number(bObj?.starting_at?.price) || 0;
      const isGem = Boolean(item.isGem || (ph && GEM_PHASE_SET.has(ph)));

      const cfPrice = ph
        ? Number(cfOrd?.starting_at?.doppler?.[ph]) || Number(prev.cf) || 0
        : baseCfMin;
      const cfQty = ph
        ? cfLive?.qty > 0
          ? Math.max(1, Math.round(cfLive.qty * (isGem ? 0.04 : 0.22)))
          : Number(prev.q) || 0
        : cfLive?.qty || 0;
      const cfBuyOrder = ph
        ? Number(cfOrd?.highest_order?.doppler?.[ph]) || Number(prev.cfo) || 0
        : Number(cfOrd?.highest_order?.price) || 0;
      const ypPrice = ph
        ? Number(ypNode?.starting_at?.doppler?.[ph]) || Number(prev.yp) || 0
        : Number(ypNode?.starting_at?.price ?? ypNode) || Number(prev.yp) || 0;
      const ypBuyOrder = ph
        ? Number(ypNode?.highest_order?.doppler?.[ph]) || Number(prev.ypo) || 0
        : Number(ypNode?.highest_order?.price) || Number(prev.ypo) || 0;
      const bPrice = ph
        ? Number(bObj?.starting_at?.doppler?.[ph]) || Number(prev.b) || 0
        : baseBuffMin || Number(prev.b) || 0;
      const bOrder = ph
        ? Number(bObj?.highest_order?.doppler?.[ph]) || Number(prev.bo) || 0
        : Number(bObj?.highest_order?.price) || Number(prev.bo) || 0;
      const rawMv = mcsMap.has(baseMhn) ? mcsMap.get(baseMhn) : Number(prev.mv) || 0;
      const mv = isGem ? Math.min(rawMv, 5) : rawMv;

      const isEstSteam = steamUsd <= 0 && (item.c === 'Knives' || item.c === 'Gloves' || Boolean(ph)) && (cfPrice > 0 || ypPrice > 0);
      const estBaseRef = ph ? Math.max(baseCfMin, baseBuffMin) : Math.max(cfPrice, bPrice);
      const effSteamUsd = isEstSteam ? Number(prev.s) || round2(Math.min(1850, estBaseRef * 1.32)) : steamUsd;

      if (effSteamUsd > 0 && (cfPrice > 0 || ypPrice > 0)) {
        liveCount += 1;
        prices[key] = {
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
          mv,
          ...(prev.stHist
            ? {
              stHist: 1,
              st24: Number(prev.st24) || 0,
              st24Checked: 1,
              st7: Number(prev.st7) || 0,
              st30: Number(prev.st30) || 0,
              stLast: Number(prev.stLast) || 0,
              stLastH: Number(prev.stLastH) || 0,
              stAvg7: Number(prev.stAvg7) || 0,
              stAvg30: Number(prev.stAvg30) || 0,
              stReal: Number(prev.stReal) || 0,
              ...(Array.isArray(prev.stSales) && prev.stSales.length ? { stSales: prev.stSales } : {})
            }
            : {}),
          ...(Number(prev.stBuyOrd) > 0 ? { stBuyOrd: Number(prev.stBuyOrd) } : {}),
          ...(Number(prev.stSellOrd) > 0 ? { stSellOrd: Number(prev.stSellOrd) } : {}),
          ...(Number(prev.stSellCnt) > 0 ? { stSellCnt: Number(prev.stSellCnt) } : {})
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

function parseSteamSummaryCount(htmlStr) {
  if (!htmlStr || typeof htmlStr !== 'string') return 0;
  const m = htmlStr.match(/>([0-9,]+)</);
  if (!m) return 0;
  const v = parseInt(m[1].replace(/,/g, ''), 10);
  return Number.isFinite(v) ? v : 0;
}

function calcRealisticSteamSell({ lastSaleUsd = 0, avg7Usd = 0, avg30Usd = 0, sold7d = 0, lowestAskUsd = 0, buyOrderUsd = 0 }) {
  if (lastSaleUsd <= 0 && avg7Usd <= 0 && avg30Usd <= 0) return 0;
  const last = lastSaleUsd > 0 ? lastSaleUsd : avg7Usd || avg30Usd;
  const a7 = avg7Usd > 0 ? avg7Usd : last;
  let est = last;
  if (sold7d >= 2) {
    est = last < a7 ? last * 0.65 + a7 * 0.35 : Math.min(last, a7 * 1.03) * 0.35 + a7 * 0.65;
  } else if (sold7d === 1) {
    est = avg30Usd > 0 ? Math.min(last, last * 0.65 + avg30Usd * 0.35) : last;
  } else if (avg30Usd > 0) {
    est = last * 0.6 + avg30Usd * 0.4;
  }
  if (lowestAskUsd > 0) est = Math.min(est, lowestAskUsd);
  if (buyOrderUsd > 0 && est < buyOrderUsd) {
    est = lowestAskUsd > 0 ? Math.min(lowestAskUsd, buyOrderUsd * 1.01) : buyOrderUsd;
  }
  return round2(Math.max(0.03, est));
}

function extractSteamPriceHistory(html, exactMhn) {
  if (!html || typeof html !== 'string' || !exactMhn) return null;
  const jsonEscaped = JSON.stringify(exactMhn).slice(1, -1);
  const doubleEsc = jsonEscaped.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const markerEsc = `\\"queryKey\\":[\\"market\\",\\"pricehistory\\",730,\\"${doubleEsc}\\"]`;
  const markerPlain = `"queryKey":["market","pricehistory",730,"${jsonEscaped}"]`;

  let idx = html.indexOf(markerEsc);
  let escaped = true;
  if (idx < 0) {
    idx = html.indexOf(markerPlain);
    escaped = false;
  }
  if (idx < 0) return null;

  const endIdx = html.lastIndexOf(']}', idx);
  if (endIdx < 0) return null;
  const slice = html.slice(Math.max(0, endIdx - 50000), endIdx + 1);
  const unescaped = escaped ? slice.replace(/\\"/g, '"') : slice;

  const re = /\{"time":(\d+),"price_median":([0-9.]+),"purchases":(\d+)\}/g;
  const rows = [];
  let m;
  while ((m = re.exec(unescaped)) !== null) {
    rows.push({ time: Number(m[1]), price: Number(m[2]), qty: Number(m[3]) });
  }
  if (rows.length === 0) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  let sold24h = 0, sold7d = 0, sold30d = 0, sum7 = 0, sum30 = 0;
  for (const r of rows) {
    if (r.time >= nowSec - 86400) sold24h += r.qty;
    if (r.time >= nowSec - 7 * 86400) { sold7d += r.qty; sum7 += r.price * r.qty; }
    if (r.time >= nowSec - 30 * 86400) { sold30d += r.qty; sum30 += r.price * r.qty; }
  }

  const lastRow = rows[rows.length - 1];
  return {
    sold24h,
    sold7d,
    sold30d,
    lastSaleUsd: round2(lastRow.price),
    lastSaleAgeH: Math.max(0, Math.round((nowSec - lastRow.time) / 3600)),
    avg7Usd: sold7d > 0 ? round2(sum7 / sold7d) : 0,
    avg30Usd: sold30d > 0 ? round2(sum30 / sold30d) : 0,
    recentSales: rows.slice(-4).map((r) => ({ t: r.time, p: round2(r.price), q: r.qty }))
  };
}

  async function fetchTextTimeout(url, ms = 7000) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), ms);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
          Cookie: 'Steam_Language=english; timezoneOffset=0,0'
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(t);
    }
  }

  async function handleSteamVerify(res, reqUrl) {
    // CS2 skin names contain "|", so use repeated ?name= & ?nid= params (or ;; fallback)
    const multiNames = reqUrl.searchParams.getAll('name');
    const multiNids = reqUrl.searchParams.getAll('nid');
    const legacyNames = (reqUrl.searchParams.get('names') || '')
      .split(';;')
      .map((s) => s.trim())
      .filter(Boolean);

    const nidMap = new Map();
    multiNames.forEach((n, idx) => {
      const clean = n.trim();
      const nid = parseInt(multiNids[idx] || '0', 10);
      if (clean && Number.isFinite(nid) && nid > 0) nidMap.set(clean, nid);
    });

    const names = Array.from(new Set([...multiNames, ...legacyNames].map((s) => s.trim())))
      .filter((s) => s.length > 0 && s.length <= 130)
      .slice(0, 6);

    if (names.length === 0) {
      res.writeHead(400, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'name param required' }));
      return;
    }

    const mkt = (reqUrl.searchParams.get('mkt') || 'CSFLOAT').toUpperCase() === 'YOUPIN' ? 'YOUPIN' : 'CSFLOAT';
    const key = `v7:${mkt}:${names.map((n) => `${n}:${nidMap.get(n) || 0}`).join(';;')}`;
    const now = Date.now();
    const cached = cacheStore.steamVerify.get(key);
    if (cached && now < cached.expiresAt) {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(cached.payload);
      return;
    }

    const results = {};
    await Promise.allSettled(
      names.map(async (name, idx) => {
        const baseQueryName = stripPhaseSuffix(name);
        const enc = encodeURIComponent(baseQueryName);
        const nid = nidMap.get(name) || 0;
        const stPoTask = fetchJsonTimeout(
          `https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=${enc}`,
          5000
        );
        const stHistTask =
          nid > 0
            ? fetchJsonTimeout(
              `https://steamcommunity.com/market/itemordershistogram?country=US&language=english&currency=1&item_nameid=${nid}&two_factor=0`,
              5000
            )
            : Promise.resolve(null);
        const stSalesTask =
          idx < 3
          ? fetchTextTimeout(`https://steamcommunity.com/market/listings/730/${enc}`, 7000)
          : Promise.resolve(null);
        const cfTask =
          mkt === 'CSFLOAT'
            ? fetchJsonTimeout(`https://csfloat.com/api/v1/history/${enc}/graph`, 5500)
            : Promise.resolve(null);

        const [stRes, histRes, salesRes, cfRes] = await Promise.allSettled([stPoTask, stHistTask, stSalesTask, cfTask]);
        const entry = {
          live: false,
          sold24hChecked: false,
          histLive: false,
          medianUsd: 0,
          lowestUsd: 0,
          steamBuyOrderUsd: 0,
          steamSellOrderUsd: 0,
          steamBuyCount: 0,
          steamSellCount: 0,
          csfloat: null
        };
        if (stRes?.status === 'fulfilled' && stRes.value?.success) {
          entry.live = true;
          const rawVol = stRes.value.volume;
          const hasExplicitVol = rawVol !== undefined && rawVol !== null && String(rawVol).trim() !== '';
          const medUsd = round2(parseSteamNumber(stRes.value.median_price));
          const lowUsd = round2(parseSteamNumber(stRes.value.lowest_price));
          if (medUsd > 0) entry.medianUsd = medUsd;
          if (lowUsd > 0) entry.lowestUsd = lowUsd;
          if (hasExplicitVol) {
            entry.sold24hChecked = true;
            entry.volume24h = Math.round(parseSteamNumber(rawVol));
          } else if (medUsd <= 0 && lowUsd > 0) {
            entry.sold24hChecked = true;
            entry.volume24h = 0;
          }
        }
        if (histRes?.status === 'fulfilled' && histRes.value?.success === 1) {
          const h = histRes.value;
          const bo = Number(h.highest_buy_order) || 0;
          const so = Number(h.lowest_sell_order) || 0;
          if (bo > 0) entry.steamBuyOrderUsd = round2(bo / 100);
          if (so > 0) entry.steamSellOrderUsd = round2(so / 100);
          entry.steamBuyCount = parseSteamSummaryCount(h.buy_order_summary);
          entry.steamSellCount = parseSteamSummaryCount(h.sell_order_summary);
          entry.live = true;
        }
        if (salesRes?.status === 'fulfilled' && typeof salesRes.value === 'string') {
          const parsedHist = extractSteamPriceHistory(salesRes.value, baseQueryName);
          if (parsedHist) {
            entry.live = true;
            entry.histLive = true;
            entry.sold24hChecked = true;
            entry.volume24h = parsedHist.sold24h;
            entry.sold7d = Math.max(parsedHist.sold7d, parsedHist.sold24h);
            entry.sold30d = Math.max(parsedHist.sold30d, entry.sold7d);
            entry.lastSaleUsd = parsedHist.lastSaleUsd;
            entry.lastSaleAgeH = parsedHist.lastSaleAgeH;
            entry.avg7Usd = parsedHist.avg7Usd;
            entry.avg30Usd = parsedHist.avg30Usd;
            entry.recentSales = parsedHist.recentSales;
            const lowestAsk = entry.steamSellOrderUsd || entry.lowestUsd || 0;
            entry.realisticSellUsd = calcRealisticSteamSell({
              lastSaleUsd: parsedHist.lastSaleUsd,
              avg7Usd: parsedHist.avg7Usd,
              avg30Usd: parsedHist.avg30Usd,
              sold7d: entry.sold7d,
              lowestAskUsd: lowestAsk,
              buyOrderUsd: entry.steamBuyOrderUsd
            });
          }
        }
        if (mkt === 'CSFLOAT' && cfRes?.status === 'fulfilled' && cfRes.value) {
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

    const tokens = expandSearchTokens(normQ);

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
      const cfInfo = cfMap.get(mhn);
      const cfOrd = cfOrdObj[mhn];
      const st = steamObj[mhn];
      const bObj = buffObj[mhn];
      const ypNode = ypObj[mhn];

      const baseCfPrice = cfInfo?.cf || Number(cfOrd?.starting_at?.price) || Number(cfOrd?.price) || 0;
      const st24 = Number(st?.last_24h) || 0;
      const st7 = Number(st?.last_7d) || 0;
      const st30 = Number(st?.last_30d) || 0;
      const st90 = Number(st?.last_90d) || 0;
      const steamUsd = st24 > 0 ? st24 : st7 > 0 ? st7 : st30;
      const baseYpPrice = Number(ypNode?.starting_at?.price ?? ypNode) || 0;
      const baseBPrice = Number(bObj?.starting_at?.price) || 0;
      const isEstSteam = steamUsd <= 0;
      const sharedEffSteam = steamUsd > 0 ? steamUsd : round2(Math.min(1850, Math.max(baseCfPrice, baseYpPrice, baseBPrice) * 1.25));

      const doppAsks = cfOrd?.starting_at?.doppler;
      if (doppAsks && typeof doppAsks === 'object' && Object.keys(doppAsks).length > 0) {
        const cheapestPhCf = Math.min(...Object.values(doppAsks).map((v) => Number(v) || Infinity));
        for (const [ph, rawAsk] of Object.entries(doppAsks)) {
          const fullName = `${mhn} - ${ph}`;
          const normPhName = normalizeLookupText(fullName);
          if (!tokens.every((tok) => normPhName.includes(tok))) continue;
          const phCf = Number(rawAsk) || 0;
          const phYp = Number(ypNode?.starting_at?.doppler?.[ph]) || 0;
          const phBf = Number(bObj?.starting_at?.doppler?.[ph]) || 0;
          if (phCf <= 0 && phYp <= 0) continue;
          const isGem = GEM_PHASE_SET.has(ph);
          const isPrem = isGem || (Number.isFinite(cheapestPhCf) && phCf > cheapestPhCf * 1.05);
          hits.push({
            exact: normPhName === normQ ? 1 : 0,
            n: fullName,
            mhn,
            ph,
            c: inferCategory(mhn),
            w: inferWearCode(mhn),
            r: mhn.startsWith('★') ? 'Covert' : 'Classified',
            rc: mhn.startsWith('★') ? '#eb4b4b' : '#d32ce6',
            st: mhn.includes('StatTrak') ? 1 : 0,
            sv: mhn.includes('Souvenir') ? 1 : 0,
            ...(isGem ? { isGem: 1 } : {}),
            ...(isPrem ? { phPrem: 1 } : {}),
            img: '',
            s: round2(sharedEffSteam),
            s7: round2(st7 || sharedEffSteam),
            s30: round2(st30 || sharedEffSteam),
            s90: round2(st90 || sharedEffSteam),
            ...(isEstSteam ? { sEst: 1 } : {}),
            cf: round2(phCf),
            cfo: round2(Number(cfOrd?.highest_order?.doppler?.[ph]) || 0),
            q: cfInfo?.q > 0 ? Math.max(1, Math.round(cfInfo.q * (isGem ? 0.04 : 0.22))) : 0,
            yp: round2(phYp),
            ypo: round2(Number(ypNode?.highest_order?.doppler?.[ph]) || 0),
            b: round2(phBf),
            bo: round2(Number(bObj?.highest_order?.doppler?.[ph]) || 0),
            v24: 0,
            v7: 0,
            v30: 0,
            mv: 0,
            liveLookup: true
          });
        }
        continue;
      }

      const normName = normalizeLookupText(mhn);
      if (!tokens.every((tok) => normName.includes(tok))) continue;
      if (baseCfPrice <= 0 && steamUsd <= 0 && baseYpPrice <= 0) continue;

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
        s: round2(sharedEffSteam),
        s7: round2(st7 || sharedEffSteam),
        s30: round2(st30 || sharedEffSteam),
        s90: round2(st90 || sharedEffSteam),
        ...(isEstSteam ? { sEst: 1 } : {}),
        cf: round2(baseCfPrice),
        cfo: round2(Number(cfOrd?.highest_order?.price) || 0),
        q: cfInfo?.q || 0,
        yp: round2(baseYpPrice),
        ypo: round2(Number(ypNode?.highest_order?.price) || 0),
        b: round2(baseBPrice),
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
