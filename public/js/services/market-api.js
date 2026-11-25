/**
 * SPREAD (spread.haking.tr) — 3-Tier Live Market Data Service
 *
 * Boot Strategy:
 *  1. Immediately loads bundled ByMykel/CSGO-API catalog + verified snapshot (< 200ms boot)
 *  2. Fetches real-time prices from /api/market (Cloudflare Pages Function or local server.mjs)
 *  3. Fetches live USD/TRY/CNY/EUR FX rates from /api/fx (or direct open.er-api.com CORS fallback)
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

  // Prepend user custom items
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
      cf: Number(p.cf) || 0,
      cfo: Number(p.cfo) || 0,
      q: Number(p.q) || 0,
      yp: Number(p.yp) || 0,
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
    this.sourceMode = 'loading'; // 'live-edge' | 'live-local' | 'snapshot'
    this.updatedAt = null;
    this.fxUpdatedAt = null;
    this.feeds = {};
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
      this.priceMap = { ...this.priceMap, ...marketRes.value.prices };
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

  rebuildWithCustomItems(customItems) {
    return mergeCatalogAndPrices(this.catalogRaw?.items || [], this.priceMap, customItems);
  }
}
