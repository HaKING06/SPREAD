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
  fx: { expiresAt: 0, payload: null }
};

function round2(n) {
  return Math.round(n * 100) / 100;
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
    const catalogRaw = await fs.readFile(path.join(__dirname, 'data', 'catalog.json'), 'utf8');
    const catalog = JSON.parse(catalogRaw);

    const [cfLiveRes, cfOrdRes, steamRes, ypRes] = await Promise.allSettled([
      fetchJsonTimeout('https://csfloat.com/api/v1/listings/price-list', 15000),
      fetchJsonTimeout('https://prices.csgotrader.app/latest/csfloat.json', 15000),
      fetchJsonTimeout('https://prices.csgotrader.app/latest/steam.json', 15000),
      fetchJsonTimeout('https://prices.csgotrader.app/latest/youpin.json', 15000)
    ]);

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

    const jsonStr = JSON.stringify({
      ok: true,
      mode: 'live-local',
      updatedAt: new Date().toISOString(),
      feeds: {
        csfloatLive: cfLiveRes.status === 'fulfilled',
        csfloatOrders: cfOrdRes.status === 'fulfilled',
        steam: steamRes.status === 'fulfilled',
        youpin: ypRes.status === 'fulfilled'
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

const BLOCKED_PREFIXES = ['/scripts/', '/functions/', '/.git', '/.github/', '/server.mjs'];

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    const pathname = decodeURIComponent(reqUrl.pathname);

    if (pathname === '/api/market' && req.method === 'GET') {
      await handleApiMarket(res, reqUrl.searchParams.get('refresh') === '1');
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
    const resolved = path.resolve(__dirname, safeRel);
    if (!resolved.startsWith(__dirname + path.sep) && resolved !== path.join(__dirname, 'index.html')) {
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
      res.writeHead(404, SECURITY_HEADERS);
      res.end('Not Found');
      return;
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
