/**
 * SPREAD (spread.haking.tr) — Clean URL History Router & Shareable Deep-Link Engine
 */

import { BRAND, MARKETPLACES, PATH_TO_TAB, ROUTES } from './config.js';
import { clampNumber, cleanText } from './security.js';
import { fmtMoneyFromUsd, fmtPct } from './formatters.js';

export function resolveTabFromPathname(pathname) {
  const clean = String(pathname || '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
  return PATH_TO_TAB[clean] || 'calculator';
}

export function syncUrlForTab(tabName, replace = false) {
  const route = ROUTES[tabName] || ROUTES.calculator;
  document.title = route.title;

  try {
    const currentPath = window.location.pathname;
    if (currentPath !== route.path || (tabName !== 'calculator' && window.location.search)) {
      const nextUrl = tabName === 'calculator' && window.location.search && replace
        ? `${route.path}${window.location.search}`
        : route.path;
      if (replace) {
        window.history.replaceState({ tab: tabName }, '', nextUrl);
      } else {
        window.history.pushState({ tab: tabName }, '', route.path);
      }
    }
  } catch {
    // Ignore history API errors in restricted contexts
  }
}

/**
 * Encodes the current calculator trade setup into a compact, public shareable URL.
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

  return `${origin}/?${params.toString()}`;
}

/**
 * Parses and strictly validates an incoming shared URL query string.
 */
export function parseSharedSetupFromUrl(searchStr) {
  if (!searchStr || !searchStr.includes('l1=')) return null;
  const params = new URLSearchParams(searchStr);

  const l1 = cleanText(params.get('l1') || '', 120);
  const l2 = cleanText(params.get('l2') || '', 120);
  const p1m = clampNumber(params.get('p1m'), 0.01, 100000, 0);
  const p1s = clampNumber(params.get('p1s'), 0.03, 100000, 0);
  const p2s = clampNumber(params.get('p2s'), 0.03, 100000, 0);
  const p2m = clampNumber(params.get('p2m'), 0.01, 100000, 0);

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
    leg1: { name: l1, marketUsd: p1m, steamUsd: p1s },
    leg2: { name: l2, steamUsd: p2s, marketUsd: p2m }
  };
}

/**
 * Formats a clean social/Discord summary card text for sharing.
 */
export function buildShareSummaryText(settings, metrics, fxRates, shareUrl) {
  const mkt = MARKETPLACES[settings.marketplace]?.name || 'CSFloat';
  const cur = settings.currency;
  const money = (u, sign = false) => fmtMoneyFromUsd(u, cur, fxRates, { withSign: sign });
  const c1 = metrics.firstCycle;

  return [
    `SPREAD — CS2 Arbitraj Döngüsü (${mkt} ↔ Steam)`,
    `Sermaye: ${money(metrics.capitalUsd)}`,
    `1. Yön: ${c1.q1}x ${settings.leg1.name} (${fmtPct(metrics.leg1ProfitPct, true)})`,
    `2. Yön: ${c1.q2}x ${settings.leg2.name} (${fmtPct(metrics.conversionLossPct, false)} kayıp)`,
    `14 Günlük Tahmini Net Kâr: ${money(c1.netProfit, true)} (${fmtPct(c1.netRoiPct, true)} ROI)`,
    `Canlı incele: ${shareUrl}`
  ].join('\n');
}
