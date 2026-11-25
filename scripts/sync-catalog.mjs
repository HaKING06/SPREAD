#!/usr/bin/env node
/**
 * SPREAD (spread.haking.tr) — Official CS2 Catalog, Prices & Real Sales Volume Sync
 *
 * Pulls official CS2 skin/case/agent metadata from ByMykel/CSGO-API and enriches
 * every item with:
 *   - CSFloat live min_price, listing depth (q), and highest Buy Order (cfo)
 *   - Steam Community Market 24h / 7d / 30d / 90d prices
 *   - Youpin898 USD prices
 *   - REAL Sales Velocity: Skinport 24h / 7d / 30d actual sold counts (v24, v7, v30)
 *     + 7d median sold price (vm) + Market.CSGO cross-market volume (mv)
 *   - Live USD / TRY / CNY / EUR exchange rates
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'public', 'data');

const STEAM_IMG_PREFIX = 'https://community.akamai.steamstatic.com/economy/image/';

const ENDPOINTS = {
  crates: 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/crates.json',
  skins: 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins_not_grouped.json',
  agents: 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/agents.json',
  csfloatLive: 'https://csfloat.com/api/v1/listings/price-list',
  csfloatOrders: 'https://prices.csgotrader.app/latest/csfloat.json',
  buff163: 'https://prices.csgotrader.app/latest/buff163.json',
  steamPrices: 'https://prices.csgotrader.app/latest/steam.json',
  youpinPrices: 'https://prices.csgotrader.app/latest/youpin.json',
  skinportSales: 'https://api.skinport.com/v1/sales/history?app_id=730&currency=USD',
  marketCsgo: 'https://market.csgo.com/api/v2/prices/USD.json',
  fx: 'https://open.er-api.com/v6/latest/USD'
};

async function fetchJson(label, url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'SpreadTerminal-Sync/1.2 (+https://spread.haking.tr)',
        'Accept-Encoding': 'br, gzip, deflate'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    console.log(`[OK] ${label}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function stripImagePrefix(url) {
  if (!url || typeof url !== 'string') return '';
  return url.startsWith(STEAM_IMG_PREFIX) ? url.slice(STEAM_IMG_PREFIX.length) : url;
}

function wearCode(wearName) {
  const map = {
    'Factory New': 'FN',
    'Minimal Wear': 'MW',
    'Field-Tested': 'FT',
    'Well-Worn': 'WW',
    'Battle-Scarred': 'BS'
  };
  return map[wearName] || '';
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function main() {
  console.log('SPREAD Sync: Fetching ByMykel/CSGO-API + live prices + real 24h/7d sales volumes...');
  await fs.mkdir(DATA_DIR, { recursive: true });

  const [
    crates,
    skins,
    agents,
    csfloatLive,
    csfloatOrders,
    buff163Prices,
    steamPrices,
    youpinPrices,
    skinportSales,
    marketCsgo,
    fxData
  ] = await Promise.all([
    fetchJson('ByMykel crates.json', ENDPOINTS.crates),
    fetchJson('ByMykel skins_not_grouped.json', ENDPOINTS.skins),
    fetchJson('ByMykel agents.json', ENDPOINTS.agents),
    fetchJson('CSFloat Live Price List', ENDPOINTS.csfloatLive),
    fetchJson('CSGOTrader CSFloat Orders', ENDPOINTS.csfloatOrders),
    fetchJson('Buff163 Global Benchmark', ENDPOINTS.buff163),
    fetchJson('CSGOTrader Steam Prices', ENDPOINTS.steamPrices),
    fetchJson('CSGOTrader Youpin898 Prices', ENDPOINTS.youpinPrices),
    fetchJson('Skinport Sales History (24h/7d/30d)', ENDPOINTS.skinportSales),
    fetchJson('Market.CSGO Volume Feed', ENDPOINTS.marketCsgo),
    fetchJson('Open ER-API FX Rates', ENDPOINTS.fx)
  ]);

  const cfLiveMap = new Map();
  if (Array.isArray(csfloatLive)) {
    for (const row of csfloatLive) {
      if (row && typeof row.market_hash_name === 'string' && Number.isFinite(row.min_price)) {
        cfLiveMap.set(row.market_hash_name, {
          minUsd: row.min_price / 100,
          qty: Number(row.quantity) || 0
        });
      }
    }
  }

  const spMap = new Map();
  if (Array.isArray(skinportSales)) {
    for (const row of skinportSales) {
      if (row && typeof row.market_hash_name === 'string') {
        spMap.set(row.market_hash_name, {
          v24: Number(row.last_24_hours?.volume) || 0,
          v7: Number(row.last_7_days?.volume) || 0,
          v30: Number(row.last_30_days?.volume) || 0,
          vm: Number(row.last_7_days?.median) || Number(row.last_30_days?.median) || 0
        });
      }
    }
  }

  const mcsMap = new Map();
  if (Array.isArray(marketCsgo?.items)) {
    for (const row of marketCsgo.items) {
      if (row && typeof row.market_hash_name === 'string') {
        mcsMap.set(row.market_hash_name, Number(row.volume) || 0);
      }
    }
  }

  const metaMap = new Map();

  for (const c of crates) {
    const mhn = c?.market_hash_name || c?.name;
    if (!mhn || metaMap.has(mhn)) continue;
    metaMap.set(mhn, {
      n: mhn,
      c: c.type === 'Case' ? 'Case' : c.type === 'Souvenir' ? 'Souvenir' : 'Capsule',
      w: '',
      r: c.rarity?.name || 'Base Grade',
      rc: c.rarity?.color || '#b0c3d9',
      st: 0,
      sv: c.type === 'Souvenir' ? 1 : 0,
      img: stripImagePrefix(c.image)
    });
  }

  for (const s of skins) {
    const mhn = s?.market_hash_name || s?.name;
    if (!mhn || metaMap.has(mhn)) continue;
    metaMap.set(mhn, {
      n: mhn,
      c: s.category?.name || 'Skin',
      wp: s.weapon?.name || '',
      w: wearCode(s.wear?.name),
      r: s.rarity?.name || 'Consumer Grade',
      rc: s.rarity?.color || '#b0c3d9',
      st: s.stattrak ? 1 : 0,
      sv: s.souvenir ? 1 : 0,
      img: stripImagePrefix(s.image)
    });
  }

  for (const a of agents) {
    const mhn = a?.market_hash_name || a?.name;
    if (!mhn || metaMap.has(mhn)) continue;
    metaMap.set(mhn, {
      n: mhn,
      c: 'Agent',
      w: '',
      r: a.rarity?.name || 'Distinguished',
      rc: a.rarity?.color || '#4b69ff',
      st: 0,
      sv: 0,
      img: stripImagePrefix(a.image)
    });
  }

  const catalogItems = [];
  const snapshotPrices = {};

  for (const [mhn, meta] of metaMap.entries()) {
    const stObj = steamPrices[mhn];
    const st24 = Number(stObj?.last_24h) || 0;
    const st7 = Number(stObj?.last_7d) || 0;
    const st30 = Number(stObj?.last_30d) || 0;
    const st90 = Number(stObj?.last_90d) || 0;
    const steamUsd = st24 > 0 ? st24 : st7 > 0 ? st7 : st30;

    const cfLive = cfLiveMap.get(mhn);
    const cfOrd = csfloatOrders[mhn];
    const cfPrice = cfLive?.minUsd || Number(cfOrd?.starting_at?.price) || Number(cfOrd?.price) || 0;
    const cfQty = cfLive?.qty || 0;
    const cfBuyOrder = Number(cfOrd?.highest_order?.price) || 0;
    const ypPrice = Number(youpinPrices[mhn]) || 0;
    const b163Obj = buff163Prices?.[mhn];
    const b163Price = Number(b163Obj?.starting_at?.price) || 0;
    const b163Order = Number(b163Obj?.highest_order?.price) || 0;

    const sp = spMap.get(mhn) || { v24: 0, v7: 0, v30: 0, vm: 0 };
    const mv = mcsMap.get(mhn) || 0;

    if (steamUsd <= 0.02 || (cfPrice <= 0.02 && ypPrice <= 0.02)) continue;
    const isContainer = meta.c === 'Case' || meta.c === 'Capsule';
    if (!isContainer && cfQty < 4 && ypPrice <= 0) continue;
    if (steamUsd > 3500 || !meta.img) continue;

    catalogItems.push(meta);

    snapshotPrices[mhn] = {
      s: round2(steamUsd),
      s7: round2(st7 || steamUsd),
      s30: round2(st30 || steamUsd),
      s90: round2(st90 || steamUsd),
      cf: cfPrice > 0 ? round2(cfPrice) : 0,
      cfo: cfBuyOrder > 0 ? round2(cfBuyOrder) : 0,
      q: cfQty,
      yp: ypPrice > 0 ? round2(ypPrice) : 0,
      b: b163Price > 0 ? round2(b163Price) : 0,
      bo: b163Order > 0 ? round2(b163Order) : 0,
      v24: sp.v24,
      v7: sp.v7,
      v30: sp.v30,
      vm: sp.vm > 0 ? round2(sp.vm) : 0,
      mv
    };
  }

  // Prioritize items with REAL sales velocity (v7 & mv) so top 4,500 are the truly active CS2 market
  catalogItems.sort((a, b) => {
    const pa = snapshotPrices[a.n];
    const pb = snapshotPrices[b.n];
    const scoreA = (pa.v7 || 0) * 10 + (pa.mv || 0) * 1.5 + (pa.q || 0) * 0.5 + (a.c === 'Case' ? 400 : 0);
    const scoreB = (pb.v7 || 0) * 10 + (pb.mv || 0) * 1.5 + (pb.q || 0) * 0.5 + (b.c === 'Case' ? 400 : 0);
    return scoreB - scoreA;
  });

  const MAX_ITEMS = 4500;
  const trimmedCatalog = catalogItems.slice(0, MAX_ITEMS);
  const trimmedPrices = {};
  for (const item of trimmedCatalog) {
    trimmedPrices[item.n] = snapshotPrices[item.n];
  }

  const fxRates = {
    USD: 1,
    TRY: Number(fxData?.rates?.TRY) || 50.67,
    CNY: Number(fxData?.rates?.CNY) || 6.68,
    EUR: Number(fxData?.rates?.EUR) || 0.91
  };

  const nowIso = new Date().toISOString();

  await Promise.all([
    fs.writeFile(
      path.join(DATA_DIR, 'catalog.json'),
      JSON.stringify({
        schemaVersion: 2,
        source: 'ByMykel/CSGO-API',
        updatedAt: nowIso,
        imgPrefix: STEAM_IMG_PREFIX,
        count: trimmedCatalog.length,
        items: trimmedCatalog
      }),
      'utf8'
    ),
    fs.writeFile(
      path.join(DATA_DIR, 'market-snapshot.json'),
      JSON.stringify({
        schemaVersion: 2,
        sources: {
          csfloat: 'csfloat.com/api/v1/listings/price-list + csgotrader',
          steam: 'prices.csgotrader.app/latest/steam.json',
          youpin: 'prices.csgotrader.app/latest/youpin.json',
          salesVelocity: 'api.skinport.com/v1/sales/history + market.csgo.com',
          fx: 'open.er-api.com/v6/latest/USD'
        },
        updatedAt: nowIso,
        fx: fxRates,
        count: trimmedCatalog.length,
        prices: trimmedPrices
      }),
      'utf8'
    )
  ]);

  const [catStat, snapStat] = await Promise.all([
    fs.stat(path.join(DATA_DIR, 'catalog.json')),
    fs.stat(path.join(DATA_DIR, 'market-snapshot.json'))
  ]);
  const withVel = Object.values(trimmedPrices).filter((p) => p.v7 > 0 || p.mv > 0).length;
  console.log(`\n[DONE] Catalog:  ${trimmedCatalog.length} items (${(catStat.size / 1024).toFixed(1)} KB)`);
  console.log(`[DONE] Snapshot: ${trimmedCatalog.length} items (${(snapStat.size / 1024).toFixed(1)} KB) | ${withVel} with real sales velocity`);
}

main().catch((err) => {
  console.error('[SYNC ERROR]', err);
  process.exit(1);
});
