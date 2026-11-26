/**
 * SPREAD (spread.haking.tr) — 3-Tier Live Market Data + Steam 24h Verification Service
 */

import { DEFAULT_FX_RATES } from '../core/config.js';

async function fetchJsonSafe(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function mergeCatalogAndPrices(catalogItems, priceMap, customItems = []) {
  const merged = [];
  const seen = new Set();

  for (const ci of customItems) {
    if (!ci || !ci.name || seen.has(ci.name)) continue;
    seen.add(ci.name);
    merged.push({
      n: ci.name,
      c: ci.category || 'Özel',
      wp: '',
      w: ci.wear || '',
      r: 'Kullanıcı',
      rc: '#f0b90b',
      st: 0,
      sv: 0,
      img: ci.img || '/assets/brand/logo-192.png',
      s: Number(ci.steamUsd) || 0,
      s7: Number(ci.steamUsd) || 0,
      s30: Number(ci.steamUsd) || 0,
      s90: Number(ci.steamUsd) || 0,
      cf: Number(ci.csfloatUsd) || 0,
      cfo: Number(ci.csfloatUsd) || 0,
      q: Number(ci.qty) || 99,
      yp: Number(ci.youpinUsd) || Number(ci.csfloatUsd) || 0,
      v24: 10,
      v7: 60,
      v30: 240,
      vm: Number(ci.csfloatUsd) || 0,
      mv: 200,
      isCustom: true,
      customId: ci.id
    });
  }

  for (const meta of catalogItems || []) {
    const p = priceMap?.[meta.n];
    if (!p || seen.has(meta.n)) continue;
    seen.add(meta.n);
    merged.push({
      ...meta,
      s: Number(p.s) || 0,
      s7: Number(p.s7) || Number(p.s) || 0,
      s30: Number(p.s30) || Number(p.s) || 0,
      s90: Number(p.s90) || Number(p.s) || 0,
      sEst: Boolean(p.sEst),
      cf: Number(p.cf) || 0,
      cfo: Number(p.cfo) || 0,
      q: Number(p.q) || 0,
      yp: Number(p.yp) || 0,
      b: Number(p.b) || 0,
      bo: Number(p.bo) || 0,
      v24: Number(p.v24) || 0,
      v7: Number(p.v7) || 0,
      v30: Number(p.v30) || 0,
      vm: Number(p.vm) || 0,
      mv: Number(p.mv) || 0,
      cf24: Number(p.cf24) || 0,
      cf7: Number(p.cf7) || 0,
      cf30: Number(p.cf30) || 0,
      cfAvg7: Number(p.cfAvg7) || 0,
      isCustom: false
    });
  }

  return merged;
}

export class MarketService {
  constructor() {
    this.catalogRaw = null;
    this.priceMap = {};
    this.fxRates = { ...DEFAULT_FX_RATES };
    this.sourceMode = 'loading';
    this.updatedAt = null;
    this.fxUpdatedAt = null;
    this.feeds = {};
    this.steamLiveCache = new Map();
  }

  async loadInitial(customItems = []) {
    const [catalog, snapshot] = await Promise.all([
      fetchJsonSafe('/data/catalog.json', 15000),
      fetchJsonSafe('/data/market-snapshot.json', 15000)
    ]);

    this.catalogRaw = catalog;
    this.priceMap = snapshot.prices || {};
    this.fxRates = { ...DEFAULT_FX_RATES, ...(snapshot.fx || {}) };
    this.sourceMode = 'snapshot';
    this.updatedAt = snapshot.updatedAt || new Date().toISOString();
    this.fxUpdatedAt = snapshot.updatedAt || new Date().toISOString();

    return mergeCatalogAndPrices(this.catalogRaw.items, this.priceMap, customItems);
  }

  async syncLive(customItems = [], forceRefresh = false) {
    const [marketRes, fxRes] = await Promise.allSettled([
      fetchJsonSafe(`/api/market${forceRefresh ? '?refresh=1' : ''}`, 18000),
      this.fetchLiveFx()
    ]);

    let marketUpdated = false;
    if (marketRes.status === 'fulfilled' && marketRes.value?.ok && marketRes.value?.prices) {
      const incoming = marketRes.value.prices;
      const mergedPrices = { ...this.priceMap };
      for (const [k, val] of Object.entries(incoming)) {
        const prev = mergedPrices[k] || {};
        mergedPrices[k] = {
          ...prev,
          ...val,
          b: val.b || prev.b || 0,
          bo: val.bo || prev.bo || 0,
          v24: val.v24 || prev.v24 || 0,
          v7: val.v7 || prev.v7 || 0,
          v30: val.v30 || prev.v30 || 0,
          vm: val.vm || prev.vm || 0,
          mv: val.mv || prev.mv || 0
        };
      }
      this.priceMap = mergedPrices;
      this.sourceMode = marketRes.value.mode || 'live-edge';
      this.updatedAt = marketRes.value.updatedAt || new Date().toISOString();
      this.feeds = marketRes.value.feeds || {};
      marketUpdated = true;
    }

    if (fxRes.status === 'fulfilled' && fxRes.value) {
      this.fxRates = { ...this.fxRates, ...fxRes.value.rates };
      this.fxUpdatedAt = fxRes.value.updatedAt;
    }

    return {
      marketUpdated,
      sourceMode: this.sourceMode,
      updatedAt: this.updatedAt,
      fxRates: { ...this.fxRates },
      items: mergeCatalogAndPrices(this.catalogRaw?.items || [], this.priceMap, customItems)
    };
  }

  /**
   * Fetches real-time CSFloat Sales History (24h/7d/30d) AND Steam Market 24h Volume & Median
   * for up to 6 active desk / basket / top strategy items.
   */
  async verifySteamLive(names = [], liveItemsRef = null) {
    const unique = Array.from(new Set(names.filter(Boolean))).slice(0, 6);
    const missing = unique.filter((n) => !this.steamLiveCache.has(n));
    if (missing.length > 0) {
      try {
        const q = missing.map((n) => `name=${encodeURIComponent(n)}`).join('&');
        const res = await fetchJsonSafe(`/api/steam-verify?${q}`, 8000);
        if (res?.ok && res.items) {
          for (const [k, v] of Object.entries(res.items)) {
            this.steamLiveCache.set(k, v);
          }
        }
      } catch {
        // Silent fallback — item still has Skinport + Market.CSGO baseline data
      }
    }
    const out = {};
    for (const n of unique) {
      const rec = this.steamLiveCache.get(n);
      if (rec) {
        out[n] = rec;
        // Hydrate live CSFloat sales directly onto the in-memory item & priceMap!
        if (rec.csfloat?.live) {
          if (this.priceMap[n]) {
            this.priceMap[n].cf24 = rec.csfloat.sold24h;
            this.priceMap[n].cf7 = rec.csfloat.sold7d;
            this.priceMap[n].cf30 = rec.csfloat.sold30d;
            this.priceMap[n].cfAvg7 = rec.csfloat.avg7Usd;
          }
          if (Array.isArray(liveItemsRef)) {
            const it = liveItemsRef.find((x) => x.n === n);
            if (it) {
              it.cf24 = rec.csfloat.sold24h;
              it.cf7 = rec.csfloat.sold7d;
              it.cf30 = rec.csfloat.sold30d;
              it.cfAvg7 = rec.csfloat.avg7Usd;
            }
          }
        }
      }
    }
    return out;
  }

  async fetchLiveFx() {
    try {
      const apiFx = await fetchJsonSafe('/api/fx', 8000);
      if (apiFx?.ok && apiFx.rates) {
        return { rates: apiFx.rates, updatedAt: apiFx.updatedAt };
      }
    } catch {
      // Fallback to direct CORS-enabled open.er-api.com
    }
    const direct = await fetchJsonSafe('https://open.er-api.com/v6/latest/USD', 8000);
    if (direct?.rates) {
      return {
        rates: {
          USD: 1,
          TRY: Number(direct.rates.TRY) || DEFAULT_FX_RATES.TRY,
          CNY: Number(direct.rates.CNY) || DEFAULT_FX_RATES.CNY,
          EUR: Number(direct.rates.EUR) || DEFAULT_FX_RATES.EUR
        },
        updatedAt: direct.time_last_update_utc || new Date().toISOString()
      };
    }
    return null;
  }

  async lookupLiveItems(query) {
    const q = String(query || '').trim();
    if (q.length < 2) return [];
    try {
      const res = await fetchJsonSafe(`/api/item-lookup?q=${encodeURIComponent(q)}`, 8000);
      if (res?.ok && Array.isArray(res.items)) return res.items;
    } catch {
      // Silent fallback
    }
    return [];
  }

  rebuildWithCustomItems(customItems) {
    return mergeCatalogAndPrices(this.catalogRaw?.items || [], this.priceMap, customItems);
  }
}
