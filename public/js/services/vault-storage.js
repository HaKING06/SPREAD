/**
 * SPREAD (spread.haking.tr) — Local Vault Persistence, JSON Backup/Restore & CSV Export
 *
 * All user data stays 100% locally in the browser with schema validation,
 * SHA-256 integrity checks on JSON backups, and formula-safe CSV exports.
 */

import { BRAND, DEFAULT_SETTINGS, STORAGE_KEYS } from '../core/config.js';
import {
  clampNumber,
  cleanText,
  safeCsvCell,
  sanitizeJsonValue,
  sha256Hex
} from '../core/security.js';

const VAULT_SCHEMA_VERSION = 1;

function safeReadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return sanitizeJsonValue(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

function safeWriteJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function validateBasketArray(arr, isLeg1) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const out = [];
  for (const row of arr.slice(0, 8)) {
    if (!row || typeof row !== 'object') continue;
    const name = cleanText(row.name || '', 120);
    if (!name) continue;
    const qty = Math.max(0, Math.floor(clampNumber(row.qty, 0, 10000, 1)));
    const marketUsd = clampNumber(row.marketUsd, 0, 100000, 0);
    const steamUsd = clampNumber(row.steamUsd, 0, 100000, 0);
    if (isLeg1 && (marketUsd <= 0 || steamUsd <= 0)) continue;
    if (!isLeg1 && (steamUsd <= 0 || marketUsd <= 0)) continue;
    out.push({ name, qty, marketUsd, steamUsd });
  }
  return out;
}

function validateCycleBasketItems(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const out = [];
  for (const row of arr.slice(0, 8)) {
    if (!row || typeof row !== 'object') continue;
    const name = cleanText(row.name || '', 120);
    if (!name) continue;
    out.push({
      name,
      qty: Math.max(0, Math.floor(clampNumber(row.qty, 0, 100000, 1))),
      img: cleanText(row.img || '', 260)
    });
  }
  return out.length > 0 ? out : null;
}

export function validateSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const marketplace = s.marketplace === 'YOUPIN' ? 'YOUPIN' : 'CSFLOAT';
  const currency = ['USD', 'TRY', 'CNY', 'EUR'].includes(s.currency) ? s.currency : 'USD';
  const steamFeeMode = ['EXACT_VALVE', 'DIV_115', 'CUSTOM'].includes(s.steamFeeMode)
    ? s.steamFeeMode
    : 'EXACT_VALVE';
  const compoundMode = s.compoundMode === 'PROPORTIONAL' ? 'PROPORTIONAL' : 'REALISTIC';

  let activeBasket = null;
  if (s.activeBasket && typeof s.activeBasket === 'object') {
    const bL1 = validateBasketArray(s.activeBasket.leg1, true);
    const bL2 = validateBasketArray(s.activeBasket.leg2, false);
    if (bL1.length > 0 && bL2.length > 0) {
      activeBasket = { leg1: bL1, leg2: bL2 };
    }
  }

  return {
    ...DEFAULT_SETTINGS,
    marketplace,
    currency,
    buyFeePct: clampNumber(s.buyFeePct, 0, 50, DEFAULT_SETTINGS.buyFeePct),
    sellFeePct: clampNumber(s.sellFeePct, 0, 50, marketplace === 'YOUPIN' ? 1.0 : 2.0),
    withdrawFeePct: clampNumber(s.withdrawFeePct, 0, 30, 0),
    steamFeeMode,
    steamCustomFeePct: clampNumber(s.steamCustomFeePct, 0, 50, 13.04),
    useBuyOrderForLeg2: Boolean(s.useBuyOrderForLeg2),
    conservativeSteamPrice: s.conservativeSteamPrice !== false,
    capitalUsd: clampNumber(s.capitalUsd, 1, 1000000, DEFAULT_SETTINGS.capitalUsd),
    compoundMode,
    splitMode: Boolean(s.splitMode),
    splitBuyCount: Math.floor(clampNumber(s.splitBuyCount, 0, 3, 0)),
    splitSellCount: Math.floor(clampNumber(s.splitSellCount, 0, 4, 0)),
    activeBasket,
    leg1: {
      name: cleanText(s.leg1?.name || DEFAULT_SETTINGS.leg1.name, 120),
      marketUsd: clampNumber(s.leg1?.marketUsd, 0, 100000, 0),
      steamUsd: clampNumber(s.leg1?.steamUsd, 0, 100000, 0)
    },
    leg2: {
      name: cleanText(s.leg2?.name || DEFAULT_SETTINGS.leg2.name, 120),
      steamUsd: clampNumber(s.leg2?.steamUsd, 0, 100000, 0),
      marketUsd: clampNumber(s.leg2?.marketUsd, 0, 100000, 0)
    }
  };
}

export function validateCycleRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = cleanText(raw.id || `cyc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, 64);
  const phase = [1, 2, 3].includes(Number(raw.phase)) ? Number(raw.phase) : 1;
  const startedTs = Date.parse(raw.cycleStartedAt);
  const phaseTs = Date.parse(raw.phaseStartedAt);
  const nowIso = new Date().toISOString();

  return {
    id,
    marketplace: raw.marketplace === 'YOUPIN' ? 'YOUPIN' : 'CSFLOAT',
    capitalUsd: clampNumber(raw.capitalUsd, 0.01, 1000000, 100),
    item1Name: cleanText(raw.item1Name || '1. Yön Eşyası', 260),
    item1Img: cleanText(raw.item1Img || '', 260),
    qty1: Math.floor(clampNumber(raw.qty1, 0, 100000, 0)),
    item2Name: cleanText(raw.item2Name || '2. Yön Eşyası', 260),
    item2Img: cleanText(raw.item2Img || '', 260),
    qty2: Math.floor(clampNumber(raw.qty2, 0, 100000, 0)),
    basketLeg1: validateCycleBasketItems(raw.basketLeg1),
    basketLeg2: validateCycleBasketItems(raw.basketLeg2),
    expectedEndUsd: clampNumber(raw.expectedEndUsd, 0, 10000000, 0),
    expectedProfitUsd: clampNumber(raw.expectedProfitUsd, -1000000, 10000000, 0),
    expectedRoiPct: clampNumber(raw.expectedRoiPct, -100, 10000, 0),
    actualEndUsd: raw.actualEndUsd !== null && raw.actualEndUsd !== undefined
      ? clampNumber(raw.actualEndUsd, 0, 10000000, 0)
      : null,
    actualProfitUsd: raw.actualProfitUsd !== null && raw.actualProfitUsd !== undefined
      ? clampNumber(raw.actualProfitUsd, -1000000, 10000000, 0)
      : null,
    note: cleanText(raw.note || '', 240),
    phase,
    phaseStartedAt: Number.isFinite(phaseTs) ? new Date(phaseTs).toISOString() : nowIso,
    cycleStartedAt: Number.isFinite(startedTs) ? new Date(startedTs).toISOString() : nowIso,
    completedAt: raw.completedAt && Number.isFinite(Date.parse(raw.completedAt))
      ? new Date(raw.completedAt).toISOString()
      : null
  };
}

export function validateCustomItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = cleanText(raw.name, 120);
  const steamUsd = clampNumber(raw.steamUsd, 0.03, 100000, 0);
  const csfloatUsd = clampNumber(raw.csfloatUsd, 0.01, 100000, 0);
  const youpinUsd = clampNumber(raw.youpinUsd, 0, 100000, csfloatUsd);
  if (!name || steamUsd <= 0 || (csfloatUsd <= 0 && youpinUsd <= 0)) return null;
  return {
    id: cleanText(raw.id || `usr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, 64),
    name,
    category: cleanText(raw.category || 'Özel', 32),
    wear: ['FN', 'MW', 'FT', 'WW', 'BS', ''].includes(raw.wear) ? raw.wear : '',
    steamUsd,
    csfloatUsd,
    youpinUsd,
    qty: Math.floor(clampNumber(raw.qty, 1, 100000, 50))
  };
}

export const Vault = {
  loadTheme() {
    try {
      return localStorage.getItem(STORAGE_KEYS.THEME) === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  },

  saveTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEYS.THEME, theme === 'light' ? 'light' : 'dark');
    } catch {
      // ignore storage quota errors
    }
  },

  loadSettings() {
    return validateSettings(safeReadJson(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS));
  },

  saveSettings(settings) {
    return safeWriteJson(STORAGE_KEYS.SETTINGS, validateSettings(settings));
  },

  loadCycles() {
    const arr = safeReadJson(STORAGE_KEYS.CYCLES, []);
    if (!Array.isArray(arr)) return [];
    return arr.map(validateCycleRecord).filter(Boolean);
  },

  saveCycles(cycles) {
    const clean = (cycles || []).map(validateCycleRecord).filter(Boolean);
    return safeWriteJson(STORAGE_KEYS.CYCLES, clean);
  },

  loadCustomItems() {
    const arr = safeReadJson(STORAGE_KEYS.CUSTOM_ITEMS, []);
    if (!Array.isArray(arr)) return [];
    return arr.map(validateCustomItem).filter(Boolean);
  },

  saveCustomItems(items) {
    const clean = (items || []).map(validateCustomItem).filter(Boolean);
    return safeWriteJson(STORAGE_KEYS.CUSTOM_ITEMS, clean);
  },

  loadWatchlist() {
    const arr = safeReadJson(STORAGE_KEYS.WATCHLIST, []);
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => cleanText(x, 120)).filter(Boolean);
  },

  saveWatchlist(list) {
    return safeWriteJson(STORAGE_KEYS.WATCHLIST, Array.from(new Set(list)).slice(0, 300));
  },

  getUsageStats() {
    let totalBytes = 0;
    for (const key of Object.values(STORAGE_KEYS)) {
      try {
        const val = localStorage.getItem(key);
        if (val) totalBytes += val.length * 2;
      } catch {
        // ignore
      }
    }
    return {
      bytes: totalBytes,
      kb: (totalBytes / 1024).toFixed(2)
    };
  },

  async createBackupEnvelope() {
    const data = {
      theme: this.loadTheme(),
      settings: this.loadSettings(),
      cycles: this.loadCycles(),
      customItems: this.loadCustomItems(),
      watchlist: this.loadWatchlist()
    };
    const canonical = JSON.stringify(data);
    const checksum = await sha256Hex(canonical);

    return {
      app: BRAND.domain,
      schemaVersion: VAULT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      checksum,
      data
    };
  },

  async parseAndVerifyBackup(rawText) {
    if (typeof rawText !== 'string' || rawText.length > 5 * 1024 * 1024) {
      throw new Error('Dosya geçersiz veya 5 MB limitini aşıyor.');
    }
    let parsed;
    try {
      parsed = sanitizeJsonValue(JSON.parse(rawText));
    } catch {
      throw new Error('JSON sözdizimi okunamadı.');
    }

    if (!parsed || typeof parsed !== 'object' || !parsed.data) {
      throw new Error('Bu dosya geçerli bir SPREAD yedek formatında değil.');
    }

    const expectedHash = typeof parsed.checksum === 'string' ? parsed.checksum : null;
    const computedHash = await sha256Hex(JSON.stringify(parsed.data));
    const checksumValid = expectedHash ? expectedHash === computedHash : false;

    const cleanData = {
      theme: parsed.data.theme === 'light' ? 'light' : 'dark',
      settings: validateSettings(parsed.data.settings),
      cycles: Array.isArray(parsed.data.cycles)
        ? parsed.data.cycles.map(validateCycleRecord).filter(Boolean)
        : [],
      customItems: Array.isArray(parsed.data.customItems)
        ? parsed.data.customItems.map(validateCustomItem).filter(Boolean)
        : [],
      watchlist: Array.isArray(parsed.data.watchlist)
        ? parsed.data.watchlist.map((x) => cleanText(x, 120)).filter(Boolean)
        : []
    };

    return {
      app: cleanText(parsed.app || 'unknown', 64),
      exportedAt: cleanText(parsed.exportedAt || '', 64),
      checksumValid,
      data: cleanData
    };
  },

  applyBackup(cleanData, mode = 'replace') {
    if (mode === 'merge') {
      const existingCycles = this.loadCycles();
      const existingIds = new Set(existingCycles.map((c) => c.id));
      const mergedCycles = [
        ...cleanData.cycles.filter((c) => !existingIds.has(c.id)),
        ...existingCycles
      ];
      this.saveCycles(mergedCycles);

      const existingItems = this.loadCustomItems();
      const existingNames = new Set(existingItems.map((i) => i.name.toLowerCase()));
      const mergedItems = [
        ...cleanData.customItems.filter((i) => !existingNames.has(i.name.toLowerCase())),
        ...existingItems
      ];
      this.saveCustomItems(mergedItems);

      const mergedWatch = Array.from(new Set([...this.loadWatchlist(), ...cleanData.watchlist]));
      this.saveWatchlist(mergedWatch);
    } else {
      this.saveTheme(cleanData.theme);
      this.saveSettings(cleanData.settings);
      this.saveCycles(cleanData.cycles);
      this.saveCustomItems(cleanData.customItems);
      this.saveWatchlist(cleanData.watchlist);
    }
  },

  buildCyclesCsv(cycles) {
    const header = [
      'ID',
      'Pazar',
      'Durum',
      'Başlangıç (UTC)',
      '1. Yön Eşyası',
      '1. Yön Adet',
      '2. Yön Eşyası',
      '2. Yön Adet',
      'Başlangıç Sermayesi (USD)',
      'Beklenen Son (USD)',
      'Beklenen Kâr (USD)',
      'Beklenen ROI (%)',
      'Gerçekleşen Son (USD)',
      'Gerçekleşen Kâr (USD)',
      'Not'
    ];

    const phaseLabel = (p) => (p === 1 ? 'Faz 1 (0-7G)' : p === 2 ? 'Faz 2 (7-14G)' : 'Tamamlandı');

    const rows = (cycles || []).map((c) => [
      c.id,
      c.marketplace,
      phaseLabel(c.phase),
      c.cycleStartedAt,
      c.item1Name,
      c.qty1,
      c.item2Name,
      c.qty2,
      c.capitalUsd.toFixed(2),
      c.expectedEndUsd.toFixed(2),
      c.expectedProfitUsd.toFixed(2),
      c.expectedRoiPct.toFixed(2),
      c.actualEndUsd !== null ? c.actualEndUsd.toFixed(2) : '',
      c.actualProfitUsd !== null ? c.actualProfitUsd.toFixed(2) : '',
      c.note || ''
    ]);

    const lines = [header, ...rows].map((row) => row.map(safeCsvCell).join(','));
    return '\uFEFF' + lines.join('\r\n');
  },

  clearAll() {
    for (const key of Object.values(STORAGE_KEYS)) {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
  }
};
