#!/usr/bin/env node
/**
 * SPREAD (spread.haking.tr) — Official CS2 Catalog & Live Market Sync Script
 *
 * Downloads official CS2 item metadata & image URLs from ByMykel/CSGO-API (GitHub)
 * and merges live market prices from CSFloat, Steam Community Market, Youpin898,
 * and open.er-api.com FX rates into compact, fast-loading local JSON datasets:
 *   - data/catalog.json         (official item metadata + Steam CDN image hashes)
 *   - data/market-snapshot.json (fresh live pricing snapshot for instant boot & offline fallback)
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
  steamPrices: 'https://prices.csgotrader.app/latest/steam.json',
  youpinPrices: 'https://prices.csgotrader.app/latest/youpin.json',
  fx: 'https://open.er-api.com/v6/latest/USD'
};

async function fetchJson(label, url, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'SpreadTerminal-Sync/1.0 (+https://spread.haking.tr)' }
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
  if (url.startsWith(STEAM_IMG_PREFIX)) {
    return url.slice(STEAM_IMG_PREFIX.length);
  }
  return url;
}

function wearCode(wearName) {
  if (!wearName) return '';
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
  console.log('SPREAD Sync: Fetching ByMykel/CSGO-API + live market feeds...');
  await fs.mkdir(DATA_DIR, { recursive: true });

  const [crates, skins, agents, csfloatLive, csfloatOrders, steamPrices, youpinPrices, fxData] =
    await Promise.all([
      fetchJson('ByMykel crates.json', ENDPOINTS.crates),
      fetchJson('ByMykel skins_not_grouped.json', ENDPOINTS.skins),
      fetchJson('ByMykel agents.json', ENDPOINTS.agents),
      fetchJson('CSFloat Live Price List', ENDPOINTS.csfloatLive),
      fetchJson('CSGOTrader CSFloat Orders', ENDPOINTS.csfloatOrders),
      fetchJson('CSGOTrader Steam Prices', ENDPOINTS.steamPrices),
      fetchJson('CSGOTrader Youpin898 Prices', ENDPOINTS.youpinPrices),
      fetchJson('Open ER-API FX Rates', ENDPOINTS.fx)
    ]);

  // Index CSFloat live array -> map
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

  // Build unified metadata index from ByMykel/CSGO-API
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
    const catName = s.category?.name || 'Skin';
    metaMap.set(mhn, {
      n: mhn,
      c: catName,
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

  // Merge catalog items that have valid Steam + (CSFloat or Youpin) pricing & real market activity
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

    // Require valid Steam price + at least one secondary marketplace price
    if (steamUsd <= 0.02 || (cfPrice <= 0.02 && ypPrice <= 0.02)) continue;
    // Keep all Cases/Capsules with any listings, and skins/agents with meaningful liquidity (qty >= 4)
    const isContainer = meta.c === 'Case' || meta.c === 'Capsule';
    if (!isContainer && cfQty < 4 && ypPrice <= 0) continue;
    // Filter extreme illiquid/garbage souvenirs & anomalous > $5000 collector items for arbitrage clarity
    if (steamUsd > 3500) continue;
    if (!meta.img) continue;

    catalogItems.push(meta);

    snapshotPrices[mhn] = {
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

  // Sort catalog: Cases first, then by CSFloat listing depth descending
  catalogItems.sort((a, b) => {
    const qa = snapshotPrices[a.n]?.q || 0;
    const qb = snapshotPrices[b.n]?.q || 0;
    const ca = a.c === 'Case' ? 1 : 0;
    const cb = b.c === 'Case' ? 1 : 0;
    if (ca !== cb) return cb - ca;
    return qb - qa;
  });

  // Cap to top 4,500 most liquid CS2 items to keep bundle ultra-fast (< 1.5MB uncompressed, ~250KB gzipped)
  const MAX_ITEMS = 4500;
  const trimmedCatalog = catalogItems.slice(0, MAX_ITEMS);
  const trimmedPrices = {};
  for (const item of trimmedCatalog) {
    trimmedPrices[item.n] = snapshotPrices[item.n];
  }

  const fxRates = {
    USD: 1,
    TRY: Number(fxData?.rates?.TRY) || 34.5,
    CNY: Number(fxData?.rates?.CNY) || 7.25,
    EUR: Number(fxData?.rates?.EUR) || 0.92
  };

  const nowIso = new Date().toISOString();

  const catalogPayload = {
    schemaVersion: 1,
    source: 'ByMykel/CSGO-API',
    updatedAt: nowIso,
    imgPrefix: STEAM_IMG_PREFIX,
    count: trimmedCatalog.length,
    items: trimmedCatalog
  };

  const snapshotPayload = {
    schemaVersion: 1,
    sources: {
      csfloat: 'csfloat.com/api/v1/listings/price-list + csgotrader',
      steam: 'prices.csgotrader.app/latest/steam.json',
      youpin: 'prices.csgotrader.app/latest/youpin.json',
      fx: 'open.er-api.com/v6/latest/USD'
    },
    updatedAt: nowIso,
    fx: fxRates,
    count: trimmedCatalog.length,
    prices: trimmedPrices
  };

  const catalogPath = path.join(DATA_DIR, 'catalog.json');
  const snapshotPath = path.join(DATA_DIR, 'market-snapshot.json');

  await Promise.all([
    fs.writeFile(catalogPath, JSON.stringify(catalogPayload), 'utf8'),
    fs.writeFile(snapshotPath, JSON.stringify(snapshotPayload), 'utf8')
  ]);

  const [catStat, snapStat] = await Promise.all([fs.stat(catalogPath), fs.stat(snapshotPath)]);
  console.log(`\n[DONE] Catalog:  ${trimmedCatalog.length} items (${(catStat.size / 1024).toFixed(1)} KB) -> data/catalog.json`);
  console.log(`[DONE] Snapshot: ${trimmedCatalog.length} items (${(snapStat.size / 1024).toFixed(1)} KB) -> data/market-snapshot.json`);
  console.log(`[DONE] Live FX:  1 USD = ${fxRates.TRY} TRY | ${fxRates.CNY} CNY | ${fxRates.EUR} EUR`);
}

main().catch((err) => {
  console.error('[SYNC ERROR]', err);
  process.exit(1);
});
