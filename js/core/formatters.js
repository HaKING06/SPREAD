/**
 * SPREAD (spread.haking.tr) — Currency, Numeric & Time Formatters
 */

import { CURRENCIES } from './config.js';

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
  const formatted = Math.abs(val).toLocaleString('tr-TR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  return `${sign}${meta.symbol}${formatted}`;
}

export function fmtPct(pct, withSign = false, decimals = 2) {
  const val = Number.isFinite(pct) ? pct : 0;
  const sign = val < 0 ? '-' : withSign && val > 0 ? '+' : '';
  return `${sign}%${Math.abs(val).toLocaleString('tr-TR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })}`;
}

export function fmtMult(mult) {
  const val = Number.isFinite(mult) ? mult : 0;
  return `${val.toFixed(4)}x`;
}

export function fmtCountdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '00g 00s 00d 00sn';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${days}g ${pad(hours)}s ${pad(mins)}d ${pad(secs)}sn`;
}

export function fmtRelativeTime(isoStr) {
  if (!isoStr) return 'Bilinmiyor';
  const ts = new Date(isoStr).getTime();
  if (!Number.isFinite(ts)) return 'Bilinmiyor';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 45) return 'Az önce';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} dk önce`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} sa önce`;
  return `${Math.floor(diffSec / 86400)} gün önce`;
}

export function fmtShortDate(isoStr) {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}
