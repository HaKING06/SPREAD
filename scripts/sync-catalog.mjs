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
  youpinPrices: 'https://prices.csgotrader.app/latest/youpin898.json',
  skinportSales: 'https://api.skinport.com/v1/sales/history?app_id=730&currency=USD',
  marketCsgo: 'https://market.csgo.com/api/v2/prices/USD.json',
  steamNameIds: 'https://raw.githubusercontent.com/somespecialone/steam-market-ids/main/data/CS2/item_names.json',
  marketplaceIds: 'https://raw.githubusercontent.com/ModestSerhat/cs2-marketplace-ids/main/cs2_marketplaceids.json',
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
    steamNameIds,
    marketplaceIdsRaw,
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
    fetchJson('Steam Market item_nameid DB', ENDPOINTS.steamNameIds).catch(() => ({})),
    fetchJson('CS2 Marketplace IDs (Youpin/Buff)', ENDPOINTS.marketplaceIds).catch(() => ({})),
    fetchJson('Open ER-API FX Rates', ENDPOINTS.fx)
  ]);
  const mpIds = marketplaceIdsRaw?.items || marketplaceIdsRaw || {};

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
  const phaseMetaMap = new Map(); // key: `${mhn}::${phase}` -> { img, def, pi, c, wp, w, r, rc, st, sv, ph }

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
      if(!mhn) continue;
      const baseRec = {
        n: mhn,
        c: s.category?.name || 'Skin',
        wp: s.weapon?.name || '',
        w: wearCode(s.wear?.name),
        r: s.rarity?.name || 'Consumer Grade',
        rc: s.rarity?.color || '#b0c3d9',
        st: s.stattrak ? 1 : 0,
        sv: s.souvenir ? 1 : 0,
        img: stripImagePrefix(s.image)
  };
  if (s.phase) {
    phaseMetaMap.set(`${mhn}::${s.phase}`, {
      ...baseRec,
      mhn,
      ph: s.phase,
      def: Number(s.weapon?.weapon_id) || 0,
      pi: Number(s.paint_index) || 0
    });
  }
  if (!metaMap.has(mhn)) {
    metaMap.set(mhn, baseRec);
  }
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

const GEM_PHASES = new Set(['Ruby', 'Sapphire', 'Emerald', 'Black Pearl']);
const PHASE_ORDER = ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Ruby', 'Sapphire', 'Emerald', 'Black Pearl'];

const catalogItems = [];
const snapshotPrices = {};
let dopplerPhaseCount = 0;

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
  const ypObj = youpinPrices?.[mhn];
  const ypPrice = Number(ypObj?.starting_at?.price ?? ypObj) || 0;
  const ypBuyOrder = Number(ypObj?.highest_order?.price) || 0;
  const b163Obj = buff163Prices?.[mhn];
  const b163Price = Number(b163Obj?.starting_at?.price) || 0;
  const b163Order = Number(b163Obj?.highest_order?.price) || 0;

  const sp = spMap.get(mhn) || { v24: 0, v7: 0, v30: 0, vm: 0 };
  const mv = mcsMap.get(mhn) || 0;
  const nid = Number(steamNameIds?.[mhn]) || 0;
  const ypId = Number(mpIds?.[mhn]?.youpin_id) || 0;

  // V10.0 FULL DOPPLER & GAMMA DOPPLER PHASE EXPANSION (Phase 1-4, Ruby, Sapphire, Emerald, Black Pearl)
  const cfDopplerAsks = cfOrd?.starting_at?.doppler;
  const ypDopplerAsks = ypObj?.starting_at?.doppler;
  const bfDopplerAsks = b163Obj?.starting_at?.doppler;
  if (!meta.st && cfDopplerAsks && typeof cfDopplerAsks === 'object' && Object.keys(cfDopplerAsks).length > 0) {
    const phaseKeys = Array.from(
      new Set([
        ...Object.keys(cfDopplerAsks),
        ...Object.keys(ypDopplerAsks || {}),
        ...Object.keys(bfDopplerAsks || {})
      ])
    ).sort((a, b) => {
      const ia = PHASE_ORDER.indexOf(a);
      const ib = PHASE_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    const isEstSteam = steamUsd <= 0.02;
    // CRITICAL: Steam Market shares ONE floor across all phases; base floor ALWAYS derives from cheapest base phase!
    const baseFloorRef = Math.min(
      ...[cfPrice, b163Price, ypPrice].filter((v) => v > 0)
    ) || cfPrice || b163Price || ypPrice;
    const sharedSteamUsd = isEstSteam
      ? round2(Math.min(1850, Math.max(cfPrice, b163Price || baseFloorRef) * 1.32))
      : steamUsd;
    const cheapestPhaseCf = Math.min(
      ...phaseKeys.map((ph) => Number(cfDopplerAsks[ph]) || Infinity)
    );

    let expandedAny = false;
    for (const ph of phaseKeys) {
      const pMeta = phaseMetaMap.get(`${mhn}::${ph}`);
      const phCf = Number(cfDopplerAsks[ph]) || 0;
      const phCfo = Number(cfOrd?.highest_order?.doppler?.[ph]) || 0;
      const phYp = Number(ypDopplerAsks?.[ph]) || 0;
      const phYpo = Number(ypObj?.highest_order?.doppler?.[ph]) || 0;
      const phBf = Number(bfDopplerAsks?.[ph]) || 0;
      const phBfo = Number(b163Obj?.highest_order?.doppler?.[ph]) || 0;
      if (phCf <= 0.02 && phYp <= 0.02) continue;
      const phImg = pMeta?.img || meta.img;
      if (!phImg) continue;

      const isGem = GEM_PHASES.has(ph);
      // Any gem OR phase priced >5% above cheapest phase carries P2P overpay (guard against Leg 2 Steam Buy!)
      const isPremiumPhase = isGem || (Number.isFinite(cheapestPhaseCf) && phCf > cheapestPhaseCf * 1.05);
      const phaseQty = cfQty > 0 ? Math.max(1, Math.round(cfQty * (isGem ? 0.04 : 0.22))) : 0;
      const phaseName = `${mhn} - ${ph}`;

      catalogItems.push({
        n: phaseName,
        mhn,
        ph,
        c: pMeta?.c || meta.c,
        wp: pMeta?.wp || meta.wp || '',
        w: pMeta?.w || meta.w,
        r: pMeta?.r || meta.r,
        rc: pMeta?.rc || meta.rc,
        st: 0,
        sv: 0,
        img: phImg,
        ...(pMeta?.def ? { def: pMeta.def } : {}),
        ...(pMeta?.pi ? { pi: pMeta.pi } : {}),
        ...(isGem ? { isGem: 1 } : {}),
        ...(isPremiumPhase ? { phPrem: 1 } : {}),
        ...(nid > 0 ? { nid } : {}),
        ...(ypId > 0 ? { ypId } : {})
      });

      snapshotPrices[phaseName] = {
        s: round2(sharedSteamUsd),
        s7: round2(st7 || sharedSteamUsd),
        s30: round2(st30 || sharedSteamUsd),
        s90: round2(st90 || sharedSteamUsd),
        ...(isEstSteam ? { sEst: 1 } : {}),
        cf: phCf > 0 ? round2(phCf) : 0,
        cfo: phCfo > 0 ? round2(phCfo) : 0,
        q: phaseQty,
        yp: phYp > 0 ? round2(phYp) : 0,
        ypo: phYpo > 0 ? round2(phYpo) : 0,
        b: phBf > 0 ? round2(phBf) : 0,
        bo: phBfo > 0 ? round2(phBfo) : 0,
        v24: isGem ? 0 : sp.v24,
        v7: isGem ? Math.min(sp.v7, 2) : sp.v7,
        v30: isGem ? Math.min(sp.v30, 8) : sp.v30,
        vm: sp.vm > 0 ? round2(sp.vm) : 0,
        mv: isGem ? Math.min(mv, 5) : mv
      };
      expandedAny = true;
      dopplerPhaseCount += 1;
    }
    if (expandedAny) continue; // Replace ambiguous phase-less Doppler entry with exact phases
  }

  const isContainer = meta.c === 'Case' || meta.c === 'Capsule';
  const isHighTier = meta.c === 'Knives' || meta.c === 'Gloves';
  const hasMarketPrice = cfPrice > 0.02 || ypPrice > 0.02;
  if (!hasMarketPrice || !meta.img) continue;
  // Allow high-tier knives/gloves even when CSGOTrader steam.json is null
  const isEstimatedSteam = steamUsd <= 0.02;
  if (isEstimatedSteam && !(isHighTier && cfQty >= 10)) continue;
  if (!isContainer && !isHighTier && cfQty < 4 && ypPrice <= 0) continue;
  if (isHighTier && cfQty < 1 && ypPrice <= 0) continue;
  const finalSteamUsd = isEstimatedSteam
    ? round2(Math.min(1850, Math.max(cfPrice, b163Price) * 1.32))
    : steamUsd;
  if (finalSteamUsd > 20000) continue;

  catalogItems.push({
    ...meta,
    ...(nid > 0 ? { nid } : {}),
    ...(ypId > 0 ? { ypId } : {})
  });

  snapshotPrices[mhn] = {
    s: round2(finalSteamUsd),
    s7: round2(st7 || finalSteamUsd),
    s30: round2(st30 || finalSteamUsd),
    s90: round2(st90 || finalSteamUsd),
    ...(isEstimatedSteam ? { sEst: 1 } : {}),
    cf: cfPrice > 0 ? round2(cfPrice) : 0,
    cfo: cfBuyOrder > 0 ? round2(cfBuyOrder) : 0,
    q: cfQty,
    yp: ypPrice > 0 ? round2(ypPrice) : 0,
    ypo: ypBuyOrder > 0 ? round2(ypBuyOrder) : 0,
    b: b163Price > 0 ? round2(b163Price) : 0,
    bo: b163Order > 0 ? round2(b163Order) : 0,
    v24: sp.v24,
    v7: sp.v7,
    v30: sp.v30,
    vm: sp.vm > 0 ? round2(sp.vm) : 0,
    mv
  };
}

// Prioritize items with REAL sales velocity + guarantee ALL Doppler/Gamma Doppler phases & high-tier knives stay bundled!
catalogItems.sort((a, b) => {
  const pa = snapshotPrices[a.n];
  const pb = snapshotPrices[b.n];
  const tierBoostA = a.ph ? 620 : a.c === 'Case' ? 500 : (a.c === 'Knives' || a.c === 'Gloves') && !a.st ? 420 : 0;
  const tierBoostB = b.ph ? 620 : b.c === 'Case' ? 500 : (b.c === 'Knives' || b.c === 'Gloves') && !b.st ? 420 : 0;
  const scoreA = (pa.v7 || 0) * 10 + (pa.mv || 0) * 1.5 + (pa.q || 0) * 0.5 + tierBoostA;
  const scoreB = (pb.v7 || 0) * 10 + (pb.mv || 0) * 1.5 + (pb.q || 0) * 0.5 + tierBoostB;
  return scoreB - scoreA;
});

const MAX_ITEMS = 6000;
const trimmedCatalog = catalogItems.slice(0, MAX_ITEMS);
console.log(`[OK] Expanded ${dopplerPhaseCount} exact Doppler / Gamma Doppler phase variants (Phase 1-4, Ruby, Sapphire, Emerald, Black Pearl).`);
const trimmedPrices = {};
for (const item of trimmedCatalog) {
  trimmedPrices[item.n] = snapshotPrices[item.n];
}

// V11.0 Pre-Enrich Top High-Spread / High-Ticket Leg 1 Contenders + Benchmark Skins with REAL Steam 7d/30d Sales History & Order Book!
function calcRealisticSteamSellSync({ lastSaleUsd = 0, avg7Usd = 0, avg30Usd = 0, sold7d = 0, lowestAskUsd = 0, buyOrderUsd = 0 }) {
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

function extractSteamPriceHistorySync(html, exactMhn) {
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

function parseSteamCntSync(htmlStr) {
  const m = String(htmlStr || '').match(/>([0-9,]+)</);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) || 0 : 0;
}

const mustIncludeBase = [
  '★ M9 Bayonet',
  '★ Karambit | Doppler (Factory New)',
  "AWP | Queen's Gambit (Factory New)",
  'Desert Eagle | Mecha Industries (Factory New)',
  'Desert Eagle | Conspiracy (Factory New)',
  'USP-S | Cyrex (Factory New)',
  'AK-47 | Asiimov (Minimal Wear)',
  '★ Talon Knife | Doppler (Factory New)',
  '★ Flip Knife | Gamma Doppler (Factory New)'
];
const contenderCandidates = trimmedCatalog
  .filter((it) => {
    const p = trimmedPrices[it.n];
    if (!p || it.st || it.sv || it.isGem) return false;
    const netS = (p.s || 0) / 1.15;
    const buy = p.cf > 0 ? p.cf : p.yp;
    const pct = buy > 0 ? ((netS / buy) - 1) * 100 : 0;
    return buy >= 25 && pct >= 18 && pct <= 64 && ((p.q || 0) >= 12 || (p.yp || 0) > 0);
  })
  .sort((a, b) => {
    const pa = trimmedPrices[a.n];
    const pb = trimmedPrices[b.n];
    const pctA = ((pa.s / 1.15) / Math.max(1, pa.cf || pa.yp) - 1) * 100;
    const pctB = ((pb.s / 1.15) / Math.max(1, pb.cf || pb.yp) - 1) * 100;
    return pctB - pctA;
  });

const uniqueBaseTargets = [];
const seenBases = new Set();
for (const name of mustIncludeBase) {
  if (!seenBases.has(name)) {
    seenBases.add(name);
    uniqueBaseTargets.push(name);
  }
}
for (const it of contenderCandidates) {
  const base = it.mhn || it.n;
  if (!seenBases.has(base)) {
    seenBases.add(base);
    uniqueBaseTargets.push(base);
  }
  if (uniqueBaseTargets.length >= 42) break;
}

console.log(`SPREAD V11 Sync: Fetching REAL Steam 7d/30d sales history & order-books for ${uniqueBaseTargets.length} top contenders...`);
let enrichedBaseCount = 0;
for (let i = 0; i < uniqueBaseTargets.length; i += 4) {
  const batch = uniqueBaseTargets.slice(i, i + 4);
  await Promise.allSettled(
    batch.map(async (baseMhn) => {
      const nid = Number(steamNameIds?.[baseMhn]) || 0;
      const enc = encodeURIComponent(baseMhn);
      const [htmlRes, histRes] = await Promise.allSettled([
        fetch(`https://steamcommunity.com/market/listings/730/${enc}`, {
          signal: AbortSignal.timeout(7000),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9'
          }
        }).then((r) => (r.ok ? r.text() : '')),
        nid > 0
          ? fetch(`https://steamcommunity.com/market/itemordershistogram?country=US&language=english&currency=1&item_nameid=${nid}&two_factor=0`, {
              signal: AbortSignal.timeout(6000),
              headers: { 'User-Agent': 'SpreadTerminal-Sync/11.0 (+https://spread.haking.tr)' }
            }).then((r) => (r.ok ? r.json() : null))
          : Promise.resolve(null)
      ]);

      const parsedHist =
        htmlRes.status === 'fulfilled' && htmlRes.value
          ? extractSteamPriceHistorySync(htmlRes.value, baseMhn)
          : null;
      const h = histRes.status === 'fulfilled' && histRes.value?.success === 1 ? histRes.value : null;
      const stBuyOrd = h && Number(h.highest_buy_order) > 0 ? round2(Number(h.highest_buy_order) / 100) : 0;
      const stSellOrd = h && Number(h.lowest_sell_order) > 0 ? round2(Number(h.lowest_sell_order) / 100) : 0;
      const stSellCnt = h ? parseSteamCntSync(h.sell_order_summary) : 0;
      const stBuyCnt = h ? parseSteamCntSync(h.buy_order_summary) : 0;

      if (!parsedHist && !h) return;
      enrichedBaseCount += 1;

      for (const it of trimmedCatalog) {
        if ((it.mhn || it.n) !== baseMhn) continue;
        const p = trimmedPrices[it.n];
        if (!p) continue;
        const lowestAsk = stSellOrd || p.s || 0;
        if (stBuyOrd > 0) p.stBuyOrd = stBuyOrd;
        if (stSellOrd > 0) p.stSellOrd = stSellOrd;
        if (stSellCnt > 0) p.stSellCnt = stSellCnt;
        if (stBuyCnt > 0) p.stBuyCnt = stBuyCnt;
        if (parsedHist) {
          p.stHist = 1;
          p.st24 = parsedHist.sold24h;
          p.st24Checked = 1;
          p.st7 = parsedHist.sold7d;
          p.st30 = parsedHist.sold30d;
          p.stLast = parsedHist.lastSaleUsd;
          p.stLastH = parsedHist.lastSaleAgeH;
          p.stAvg7 = parsedHist.avg7Usd;
          p.stAvg30 = parsedHist.avg30Usd;
          p.stSales = parsedHist.recentSales;
          const realSell = calcRealisticSteamSellSync({
            lastSaleUsd: parsedHist.lastSaleUsd,
            avg7Usd: parsedHist.avg7Usd,
            avg30Usd: parsedHist.avg30Usd,
            sold7d: parsedHist.sold7d,
            lowestAskUsd: lowestAsk,
            buyOrderUsd: stBuyOrd
          });
          if (realSell > 0) p.stReal = realSell;
          if (p.sEst && (stSellOrd > 0 || realSell > 0)) {
            p.s = round2(stSellOrd || realSell);
            p.s7 = round2(parsedHist.avg7Usd || realSell || p.s);
            p.s30 = round2(parsedHist.avg30Usd || p.s7);
            delete p.sEst;
          }
        }
      }
    })
  );
  if (i + 4 < uniqueBaseTargets.length) {
    await new Promise((r) => setTimeout(r, 320));
  }
}
console.log(`[OK] Hydrated REAL Steam 7d/30d sales & clearing prices on ${enrichedBaseCount}/${uniqueBaseTargets.length} top skins.`);

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
      schemaVersion: 3,
      source: 'ByMykel/CSGO-API',
      updatedAt: nowIso,
      imgPrefix: STEAM_IMG_PREFIX,
      count: trimmedCatalog.length,
      dopplerPhases: dopplerPhaseCount,
      items: trimmedCatalog
    }),
    'utf8'
  ),
  fs.writeFile(
    path.join(DATA_DIR, 'market-snapshot.json'),
    JSON.stringify({
      schemaVersion: 3,
      sources: {
        csfloat: 'csfloat.com/api/v1/listings/price-list + csgotrader (incl. Doppler phases)',
        steam: 'prices.csgotrader.app/latest/steam.json',
        youpin: 'prices.csgotrader.app/latest/youpin898.json (incl. Doppler phases)',
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
