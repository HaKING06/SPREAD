/**
 * SPREAD (spread.haking.tr) — Clean URL History Router & Shareable Deep-Link Engine
 */

import { BRAND, MARKETPLACES, PATH_TO_TAB, ROUTES } from './config.js';
import { clampNumber, cleanText } from './security.js';
import { fmtMoneyFromUsd, fmtPct } from './formatters.js';
import { getLang, isTr, t } from './i18n.js';

export function resolveTabFromPathname(pathname) {
  const clean = String(pathname || '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
  return PATH_TO_TAB[clean] || 'calculator';
}

export function syncUrlForTab(tabName, replace = false) {
  const route = ROUTES[tabName] || ROUTES.calculator;
  const targetPath = isTr() ? route.trPath : route.path;
  document.title = t(`route.${tabName}.title`, 'SPREAD — CS2 Arbitrage Terminal');

  try {
    const currentPath = window.location.pathname;
    if (currentPath !== targetPath || (tabName !== 'calculator' && window.location.search)) {
      const nextUrl =
        tabName === 'calculator' && window.location.search && replace
          ? `${targetPath}${window.location.search}`
          : targetPath;
      if (replace) {
        window.history.replaceState({ tab: tabName }, '', nextUrl);
      } else {
        window.history.pushState({ tab: tabName }, '', targetPath);
      }
    }
  } catch {
    // Ignore
  }
}

function encodeBasketLines(lines, isLeg1) {
  return lines
    .slice(0, 6)
    .map((l) => {
      const safeName = String(l.name || '').replace(/[~|]/g, ' ').trim();
      const q = Math.max(0, Math.floor(Number(l.qty) || 0));
      const p1 = Math.round((isLeg1 ? l.marketUsd : l.steamUsd) * 100) / 100;
      const p2 = Math.round((isLeg1 ? l.steamUsd : l.marketUsd) * 100) / 100;
      return `${safeName}~${q}~${p1}~${p2}`;
    })
    .join('|');
}

function decodeBasketLines(raw, isLeg1) {
  if (!raw || typeof raw !== 'string') return [];
  const out = [];
  for (const seg of raw.split('|').slice(0, 6)) {
    const parts = seg.split('~');
    if (parts.length !== 4) continue;
    const name = cleanText(parts[0], 120);
    const qty = Math.floor(clampNumber(parts[1], 0, 10000, 1));
    const p1 = clampNumber(parts[2], 0.01, 100000, 0);
    const p2 = clampNumber(parts[3], 0.01, 100000, 0);
    if (!name || p1 <= 0 || p2 <= 0) continue;
    out.push(isLeg1 ? { name, qty, marketUsd: p1, steamUsd: p2 } : { name, qty, steamUsd: p1, marketUsd: p2 });
  }
  return out;
}

/**
 * Encodes the current calculator trade setup (single pair OR full multi-item basket) into a compact shareable URL.
 */
export function buildShareUrl(settings) {
  const origin =
    window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
      ? BRAND.url
      : window.location.origin;

  const params = new URLSearchParams();
  params.set('m', settings.marketplace === 'YOUPIN' ? 'yp' : 'cf');
  params.set('cur', settings.currency || 'USD');
  params.set('cap', String(Math.round(settings.capitalUsd * 100) / 100));

  if (settings.activeBasket?.leg1?.length && settings.activeBasket?.leg2?.length) {
    params.set('b1', encodeBasketLines(settings.activeBasket.leg1, true));
    params.set('b2', encodeBasketLines(settings.activeBasket.leg2, false));
  }

  params.set('l1', settings.leg1.name);
  params.set('p1m', String(Math.round(settings.leg1.marketUsd * 100) / 100));
  params.set('p1s', String(Math.round(settings.leg1.steamUsd * 100) / 100));
  params.set('l2', settings.leg2.name);
  params.set('p2s', String(Math.round(settings.leg2.steamUsd * 100) / 100));
  params.set('p2m', String(Math.round(settings.leg2.marketUsd * 100) / 100));

  if (settings.buyFeePct > 0) params.set('bf', String(settings.buyFeePct));
  if (settings.withdrawFeePct > 0) params.set('wf', String(settings.withdrawFeePct));

  const defaultSell = settings.marketplace === 'YOUPIN' ? 1 : 2;
  if (settings.sellFeePct !== defaultSell) params.set('sf', String(settings.sellFeePct));
  if (settings.steamFeeMode !== 'EXACT_VALVE') params.set('sm', settings.steamFeeMode);
  params.set('lang', getLang());

  return `${origin}/?${params.toString()}`;
}

/**
 * Parses and strictly validates an incoming shared URL query string (supports single pair & multi-item basket).
 */
export function parseSharedSetupFromUrl(searchStr) {
  if (!searchStr || (!searchStr.includes('l1=') && !searchStr.includes('b1='))) return null;
  const params = new URLSearchParams(searchStr);

  const b1 = decodeBasketLines(params.get('b1'), true);
  const b2 = decodeBasketLines(params.get('b2'), false);
  const hasBasket = b1.length > 0 && b2.length > 0;

  const l1 = cleanText(params.get('l1') || b1[0]?.name || '', 120);
  const l2 = cleanText(params.get('l2') || b2[0]?.name || '', 120);
  const p1m = clampNumber(params.get('p1m'), 0.01, 100000, b1[0]?.marketUsd || 0);
  const p1s = clampNumber(params.get('p1s'), 0.03, 100000, b1[0]?.steamUsd || 0);
  const p2s = clampNumber(params.get('p2s'), 0.03, 100000, b2[0]?.steamUsd || 0);
  const p2m = clampNumber(params.get('p2m'), 0.01, 100000, b2[0]?.marketUsd || 0);

  if (!l1 || !l2 || p1m <= 0 || p1s <= 0 || p2s <= 0 || p2m <= 0) {
    return null;
  }

  const mRaw = params.get('m');
  const marketplace = mRaw === 'yp' ? 'YOUPIN' : 'CSFLOAT';
  const curRaw = (params.get('cur') || 'USD').toUpperCase();
  const currency = ['USD', 'TRY', 'CNY', 'EUR'].includes(curRaw) ? curRaw : 'USD';
  const capitalUsd = clampNumber(params.get('cap'), 1, 1000000, 200);

  const defaultSell = marketplace === 'YOUPIN' ? 1.0 : 2.0;
  const buyFeePct = params.has('bf') ? clampNumber(params.get('bf'), 0, 50, 0) : 0;
  const sellFeePct = params.has('sf') ? clampNumber(params.get('sf'), 0, 50, defaultSell) : defaultSell;
  const withdrawFeePct = params.has('wf') ? clampNumber(params.get('wf'), 0, 30, 0) : 0;
  const smRaw = params.get('sm');
  const steamFeeMode = ['EXACT_VALVE', 'DIV_115', 'CUSTOM'].includes(smRaw) ? smRaw : 'EXACT_VALVE';

  return {
    marketplace,
    currency,
    capitalUsd,
    buyFeePct,
    sellFeePct,
    withdrawFeePct,
    steamFeeMode,
    splitMode: hasBasket,
    activeBasket: hasBasket ? { leg1: b1, leg2: b2 } : null,
    leg1: { name: l1, marketUsd: p1m, steamUsd: p1s },
    leg2: { name: l2, steamUsd: p2s, marketUsd: p2m }
  };
}

/**
 * Formats a clean social/Discord summary card text for sharing (supports single pair & multi-item basket).
 */
export function buildShareSummaryText(settings, metrics, fxRates, shareUrl) {
  const mkt = MARKETPLACES[settings.marketplace]?.name || 'CSFloat';
  const cur = settings.currency;
  const money = (u, sign = false) => fmtMoneyFromUsd(u, cur, fxRates, { withSign: sign });
  const c1 = metrics.firstCycle;

  const basket = settings.activeBasket;
  const l1Text = basket?.leg1?.length
    ? basket.leg1.map((l) => `${l.qty}x ${l.name}`).join(' + ')
    : `${c1.q1}x ${settings.leg1.name}`;
  const l2Text = basket?.leg2?.length
    ? basket.leg2.map((l) => `${l.qty}x ${l.name}`).join(' + ')
    : `${c1.q2}x ${settings.leg2.name}`;

  if (isTr()) {
    return [
      `SPREAD — CS2 Arbitraj ${basket ? 'Sepeti' : 'Döngüsü'} (${mkt} ↔ Steam)`,
      `Sermaye: ${money(metrics.capitalUsd)}`,
      `1. Yön: ${l1Text} (${fmtPct(metrics.leg1ProfitPct, true)})`,
      `2. Yön: ${l2Text} (${fmtPct(metrics.conversionLossPct, false)} kayıp)`,
      `14 Günlük Tahmini Net Kâr: ${money(c1.netProfit, true)} (${fmtPct(c1.netRoiPct, true)} ROI)`,
      `Canlı incele: ${shareUrl}`
    ].join('\n');
  }

  return [
    `SPREAD — CS2 Arbitrage ${basket ? 'Basket' : 'Loop'} (${mkt} ↔ Steam)`,
    `Capital: ${money(metrics.capitalUsd)}`,
    `Leg 1: ${l1Text} (${fmtPct(metrics.leg1ProfitPct, true)})`,
    `Leg 2: ${l2Text} (${fmtPct(metrics.conversionLossPct, false)} loss)`,
    `Est. 14-Day Net Profit: ${money(c1.netProfit, true)} (${fmtPct(c1.netRoiPct, true)} ROI)`,
    `Inspect live: ${shareUrl}`
  ].join('\n');
}
