/**
 * SPREAD (spread.haking.tr) — Core Application Configuration & Constants
 */

export const BRAND = {
  name: 'SPREAD',
  domain: 'spread.haking.tr',
  url: 'https://spread.haking.tr',
  parentDomain: 'haking.tr',
  supportEmail: 'spread@haking.tr',
  buyMeACoffeeUrl: 'https://buymeacoffee.com/haking',
  steamTradeDonateUrl: 'https://steamcommunity.com/tradeoffer/new/?partner=1800489426&token=jIoKxNd7',
  version: '11.2.0'
};

export const ROUTES = {
  calculator: { path: '/', trPath: '/' },
  scanner: { path: '/scanner', trPath: '/tarayici' },
  tracker: { path: '/tracker', trPath: '/takip' },
  academy: { path: '/academy', trPath: '/akademi' },
  about: { path: '/about', trPath: '/hakkinda' }
};

export const PATH_TO_TAB = {
  '': 'calculator',
  'masa': 'calculator',
  'hesaplayici': 'calculator',
  'calculator': 'calculator',
  'tarayici': 'scanner',
  'scanner': 'scanner',
  'takip': 'tracker',
  'tracker': 'tracker',
  'akademi': 'academy',
  'academy': 'academy',
  'hakkinda': 'about',
  'about': 'about'
};

export const STEAM_IMG_PREFIX = 'https://community.akamai.steamstatic.com/economy/image/';

export const STORAGE_KEYS = {
  THEME: 'spread_haking_tr_v1_theme',
  SETTINGS: 'spread_haking_tr_v1_settings',
  CYCLES: 'spread_haking_tr_v1_cycles',
  CUSTOM_ITEMS: 'spread_haking_tr_v1_custom_items',
  WATCHLIST: 'spread_haking_tr_v1_watchlist',
  ONBOARDING_HIDDEN: 'spread_haking_tr_v1_onboarding_hidden',
  TOUR_DONE: 'spread_haking_tr_v1_tour_done'
};

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const DOPPLER_PHASE_SUFFIX_RE = /\s+-\s+(Phase [1-4]|Ruby|Sapphire|Black Pearl|Emerald)$/i;

const WEAR_FLOAT_RANGES = {
  FN: [0, 0.07],
  MW: [0.07, 0.15],
  FT: [0.15, 0.38],
  WW: [0.38, 0.45],
  BS: [0.45, 1]
};

export const DOPPLER_PHASE_META = {
  'Phase 1': { short: 'P1', cls: 'phase-p1' },
  'Phase 2': { short: 'P2', cls: 'phase-p2' },
  'Phase 3': { short: 'P3', cls: 'phase-p3' },
  'Phase 4': { short: 'P4', cls: 'phase-p4' },
  Ruby: { short: 'Ruby', cls: 'phase-ruby' },
  Sapphire: { short: 'Sapphire', cls: 'phase-sapphire' },
  Emerald: { short: 'Emerald', cls: 'phase-emerald' },
  'Black Pearl': { short: 'Black Pearl', cls: 'phase-bp' }
};

export function stripDopplerPhase(name) {
  return String(name || '').replace(DOPPLER_PHASE_SUFFIX_RE, '').trim();
}

export const MARKETPLACES = {
  CSFLOAT: {
    id: 'CSFLOAT',
    name: 'CSFloat',
    shortName: 'CSFloat',
    defaultBuyFee: 0.0,
    defaultSellFee: 2.0,
    defaultWithdrawFee: 0.0,
    tagline: 'P2P • %2 Satış Komisyonu • Küresel Nakit',
    searchUrl: (mhn, item) => {
      if (item?.def && item?.pi) {
        const params = new URLSearchParams({
          def_index: String(item.def),
          paint_index: String(item.pi),
          category: item.st ? '2' : '1'
        });
        const rng = item.w ? WEAR_FLOAT_RANGES[item.w] : null;
        if (rng) {
          params.set('min_float', String(rng[0]));
          params.set('max_float', String(rng[1]));
        }
        return `https://csfloat.com/search?${params.toString()}`;
      }
      const cleanName = item?.mhn || stripDopplerPhase(mhn);
      return `https://csfloat.com/search?market_hash_name=${encodeURIComponent(cleanName)}`;
    }
  },
  YOUPIN: {
    id: 'YOUPIN',
    name: 'Youpin898',
    shortName: 'Youpin',
    defaultBuyFee: 0.0,
    defaultSellFee: 1.0,
    defaultWithdrawFee: 0.0,
    tagline: 'CN P2P • %1 Satış Komisyonu • Yüksek Kasa Hacmi',
    searchUrl: (mhn, item) =>
      item?.ypId
        ? `https://www.youpin898.com/market/goods-list?listType=10&templateId=${item.ypId}`
        : `https://www.youpin898.com/?search=${encodeURIComponent(item?.mhn || stripDopplerPhase(mhn))}`
  }
};

export const CURRENCIES = {
  USD: { code: 'USD', symbol: '$', label: '$ USD', locale: 'en-US' },
  TRY: { code: 'TRY', symbol: '₺', label: '₺ TRY', locale: 'tr-TR' },
  CNY: { code: 'CNY', symbol: '¥', label: '¥ CNY', locale: 'zh-CN' },
  EUR: { code: 'EUR', symbol: '€', label: '€ EUR', locale: 'de-DE' }
};

export const DEFAULT_FX_RATES = {
  USD: 1,
  TRY: 50.67,
  CNY: 6.68,
  EUR: 0.91
};

export const DEFAULT_SETTINGS = {
  marketplace: 'CSFLOAT',       // 'CSFLOAT' | 'YOUPIN'
  currency: 'USD',              // 'USD' | 'TRY' | 'CNY' | 'EUR'
  buyFeePct: 0.0,               // Marketplace buy fee %
  sellFeePct: 2.0,              // Marketplace sell fee % (CSFloat 2%, Youpin 1%)
  withdrawFeePct: 0.0,          // Optional cashout/payout fee % (0..5)
  steamFeeMode: 'EXACT_VALVE',  // 'EXACT_VALVE' | 'DIV_115' | 'CUSTOM'
  steamCustomFeePct: 13.04,
  useBuyOrderForLeg2: false,    // CSFloat highest_order instant cashout mode
  conservativeSteamPrice: true, // Use min(24h, 7d) to guard against manipulated spikes
  capitalUsd: 200,
  compoundMode: 'REALISTIC',    // 'REALISTIC' | 'PROPORTIONAL'
  splitMode: false,             // V6 Multi-Item Split / Basket Mode toggle
  splitBuyCount: 0,             // 0 = Auto (Agent), 1 | 2 | 3
  splitSellCount: 0,            // 0 = Auto (Agent), 1 | 2 | 3 | 4
  activeBasket: null,           // V6.1 Full Multi-Item Basket loaded on Trade Desk ({ leg1: [...], leg2: [...] })
  leg1: {
    name: 'Revolution Case',
    marketUsd: 0,
    steamUsd: 0
  },
  leg2: {
    name: 'AK-47 | Redline (Field-Tested)',
    steamUsd: 0,
    marketUsd: 0
  }
};

export function steamMarketUrl(marketHashName, item = null) {
  const base = item?.mhn || stripDopplerPhase(marketHashName);
  return `https://steamcommunity.com/market/listings/730/${encodeURIComponent(base)}`;
}

export function buildImageUrl(imgField) {
  if (!imgField || typeof imgField !== 'string') return '/assets/brand/logo-192.png';
  if (imgField.startsWith('https://')) return imgField;
  if (imgField.startsWith('/assets/')) return imgField;
  return STEAM_IMG_PREFIX + imgField;
}
