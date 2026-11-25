/**
 * SPREAD (spread.haking.tr) — Bilingual (EN/TR) Currency, Numeric & Time Formatters
 */

import { CURRENCIES } from './config.js';
import { isTr } from './i18n.js';

export function getCurrencyMeta(code) {
  return CURRENCIES[code] || CURRENCIES.USD;
}

export function fromUsd(usdAmount, currencyCode, fxRates) {
  const rate = Number(fxRates?.[currencyCode]) || 1;
  return (Number(usdAmount) || 0) * rate;
}

export function toUsd(displayAmount, currencyCode, fxRates) {
  const rate = Number(fxRates?.[currencyCode]) || 1;
  return rate > 0 ? (Number(displayAmount) || 0) / rate : 0;
}

export function fmtMoneyFromUsd(usdAmount, currencyCode, fxRates, opts = {}) {
  const { withSign = false, decimals = 2 } = opts;
  const converted = fromUsd(usdAmount, currencyCode, fxRates);
  return fmtRawMoney(converted, currencyCode, { withSign, decimals });
}

export function fmtRawMoney(amount, currencyCode = 'USD', opts = {}) {
  const { withSign = false, decimals = 2 } = opts;
  const meta = getCurrencyMeta(currencyCode);
  const val = Number.isFinite(amount) ? amount : 0;
  const sign = val < 0 ? '-' : withSign && val > 0 ? '+' : '';
  const loc = isTr() ? 'tr-TR' : 'en-US';
  const formatted = Math.abs(val).toLocaleString(loc, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  return `${sign}${meta.symbol}${formatted}`;
}

export function fmtPct(pct, withSign = false, decimals = 2) {
  const val = Number.isFinite(pct) ? pct : 0;
  const sign = val < 0 ? '-' : withSign && val > 0 ? '+' : '';
  const tr = isTr();
  const formatted = Math.abs(val).toLocaleString(tr ? 'tr-TR' : 'en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  return tr ? `${sign}%${formatted}` : `${sign}${formatted}%`;
}

export function fmtMult(mult) {
  const val = Number.isFinite(mult) ? mult : 0;
  return `${val.toFixed(4)}x`;
}

export function fmtCountdown(ms) {
  const tr = isTr();
  if (!Number.isFinite(ms) || ms <= 0) return tr ? '00g 00s 00d 00sn' : '00d 00h 00m 00s';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return tr
    ? `${days}g ${pad(hours)}s ${pad(mins)}d ${pad(secs)}sn`
    : `${days}d ${pad(hours)}h ${pad(mins)}m ${pad(secs)}s`;
}

export function fmtRelativeTime(isoStr) {
  const tr = isTr();
  if (!isoStr) return tr ? 'Bilinmiyor' : 'Unknown';
  const ts = new Date(isoStr).getTime();
  if (!Number.isFinite(ts)) return tr ? 'Bilinmiyor' : 'Unknown';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 45) return tr ? 'Az önce' : 'Just now';
  if (diffSec < 3600) return tr ? `${Math.floor(diffSec / 60)} dk önce` : `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return tr ? `${Math.floor(diffSec / 3600)} sa önce` : `${Math.floor(diffSec / 3600)}h ago`;
  return tr ? `${Math.floor(diffSec / 86400)} gün önce` : `${Math.floor(diffSec / 86400)}d ago`;
}

export function fmtShortDate(isoStr) {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(isTr() ? 'tr-TR' : 'en-US', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}
