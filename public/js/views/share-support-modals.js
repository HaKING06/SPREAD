/**
 * SPREAD (spread.haking.tr) — Share Cycle Modal & Developer Support Modal
 */

import { BRAND, MARKETPLACES } from '../core/config.js';
import { buildShareSummaryText, buildShareUrl } from '../core/router-share.js';
import { fmtMoneyFromUsd, fmtPct } from '../core/formatters.js';

async function copyTextSafe(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}

export function initShareAndSupportModals(app) {
  // ---------------- SHARE CYCLE MODAL ----------------
  const shareModal = document.getElementById('shareModal');
  const shareUrlInput = document.getElementById('shareUrlInput');
  const sharePreviewCard = document.getElementById('sharePreviewSummary');
  const copyLinkBtn = document.getElementById('copyShareUrlBtn');
  const copySummaryBtn = document.getElementById('copyShareSummaryBtn');
  const waLink = document.getElementById('shareWhatsappLink');
  const xLink = document.getElementById('shareXLink');
  const tgLink = document.getElementById('shareTelegramLink');

  let lastShareUrl = '';
  let lastShareSummary = '';

  function openShare() {
    const metrics = app.latestMetrics;
    if (!metrics) return;

    const s = app.settings;
    const fx = app.market.fxRates;
    const mkt = MARKETPLACES[s.marketplace]?.name || 'CSFloat';
    const money = (u, sign = false) => fmtMoneyFromUsd(u, s.currency, fx, { withSign: sign });

    lastShareUrl = buildShareUrl(s);
    lastShareSummary = buildShareSummaryText(s, metrics, fx, lastShareUrl);

    if (shareUrlInput) shareUrlInput.value = lastShareUrl;
    if (sharePreviewCard) {
      sharePreviewCard.textContent = `${mkt} ↔ Steam • ${s.leg1.name} → ${s.leg2.name} | Sermaye: ${money(metrics.capitalUsd)} | 1. Döngü: ${money(metrics.firstCycle.netProfit, true)} (${fmtPct(metrics.firstCycle.netRoiPct, true)})`;
    }

    const encodedSummary = encodeURIComponent(lastShareSummary);
    const encodedUrl = encodeURIComponent(lastShareUrl);
    const shortTweet = encodeURIComponent(
      `SPREAD CS2 Arbitraj kurulumum: ${s.leg1.name} → ${s.leg2.name} | 14 Günlük Tahmini ROI: ${fmtPct(metrics.firstCycle.netRoiPct, true)}`
    );

    if (waLink) waLink.setAttribute('href', `https://api.whatsapp.com/send?text=${encodedSummary}`);
    if (xLink) xLink.setAttribute('href', `https://x.com/intent/tweet?text=${shortTweet}&url=${encodedUrl}`);
    if (tgLink) tgLink.setAttribute('href', `https://t.me/share/url?url=${encodedUrl}&text=${shortTweet}`);

    shareModal?.classList.remove('hidden');
  }

  function closeShare() {
    shareModal?.classList.add('hidden');
  }

  document.getElementById('openShareModalBtn')?.addEventListener('click', openShare);
  document.getElementById('closeShareModalBtn')?.addEventListener('click', closeShare);
  shareModal?.addEventListener('click', (e) => {
    if (e.target === shareModal) closeShare();
  });

  copyLinkBtn?.addEventListener('click', async () => {
    try {
      await copyTextSafe(lastShareUrl);
      app.toast('Paylaşım linki panoya kopyalandı!');
    } catch {
      app.toast('Kopyalama başarısız — linki kutudan manuel seçebilirsiniz.', 'warn');
    }
  });

  copySummaryBtn?.addEventListener('click', async () => {
    try {
      await copyTextSafe(lastShareSummary);
      app.toast('Discord / sohbet özet kartı panoya kopyalandı!');
    } catch {
      app.toast('Özet kopyalanamadı.', 'warn');
    }
  });

  // ---------------- SUPPORT / DONATE MODAL ----------------
  const supportModal = document.getElementById('supportModal');

  function openSupport() {
    supportModal?.classList.remove('hidden');
  }

  function closeSupport() {
    supportModal?.classList.add('hidden');
  }

  document.getElementById('openSupportBtn')?.addEventListener('click', openSupport);
  document.getElementById('footerSupportBtn')?.addEventListener('click', openSupport);
  document.getElementById('closeSupportModalBtn')?.addEventListener('click', closeSupport);
  supportModal?.addEventListener('click', (e) => {
    if (e.target === supportModal) closeSupport();
  });

  document.getElementById('copySupportEmailBtn')?.addEventListener('click', async () => {
    try {
      await copyTextSafe(BRAND.supportEmail);
      app.toast(`${BRAND.supportEmail} panoya kopyalandı!`);
    } catch {
      app.toast(BRAND.supportEmail);
    }
  });

  return { openShare, closeShare, openSupport, closeSupport };
}
