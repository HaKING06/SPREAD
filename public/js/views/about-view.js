/**
 * SPREAD (spread.haking.tr) — About & Trust Live Telemetry View
 */

import { clearNode, el } from '../core/security.js';
import { isTr } from '../core/i18n.js';
import { fmtRelativeTime } from '../core/formatters.js';

export function initAboutView(app) {
  const host = document.getElementById('aboutLiveTelemetryGrid');

  function render() {
    if (!host) return;
    clearNode(host);
    const tr = isTr();
    const isLive = app.market.sourceMode === 'live-edge' || app.market.sourceMode === 'live-local';
    const feeds = app.market.feeds || {};
    const velCount = app.items.filter((i) => (i.v7 || 0) > 0 || (i.mv || 0) > 0).length;

    const nodes = [
      {
        title: tr ? 'CSFloat Canlı + Gerçek Satış Grafiği' : 'CSFloat Live + Real Sales Graph',
        status: isLive ? (feeds.csfloatLive !== false ? 'OK' : 'FALLBACK') : 'SNAPSHOT',
        sub: tr
          ? 'Anlık taban fiyat, buy-order, ilan derinliği + canlı 24s/7g/30g CSFloat satış geçmişi'
          : 'Live min ask, buy orders, depth + real live 24h/7d/30d CSFloat sales history'
      },
      {
        title: tr ? 'Steam Pazarı Canlı Satış Geçmişi + Emir Defteri' : 'Steam Market Live Sales History + Order Book',
        status: isLive ? (feeds.steam !== false ? 'OK' : 'FALLBACK') : 'SNAPSHOT',
        sub: tr
          ? '1. Adım için gerçek Steam 24s/7g/30g satış geçmişi, son gerçekleşen satış fiyatı, gerçekçi satış hesabı ve anında Steam Buy-Order histogramı'
          : 'Step 1 real Steam 24h/7d/30d sales history, last actual sale price, realistic clearing-price engine & instant Steam Buy-Order histogram'
      },
      {
        title: tr ? 'Buff163 Küresel Nakit Referansı' : 'Buff163 Global Cash Anchor',
        status: isLive ? (feeds.buff163 !== false ? 'OK' : 'FALLBACK') : 'SNAPSHOT',
        sub: tr ? 'Küresel nakit referans fiyatı & ortalama dönüş (drift) sinyali' : 'Global cash benchmark & mean-reversion drift signal'
      },
      {
        title: tr ? 'Global 20.000+ Canlı Skin Arama' : 'Global 20,000+ Live Skin Lookup',
        status: 'OK',
        sub: tr
          ? `${app.items.length.toLocaleString('tr-TR')} paketli eşya + nadir bıçak/Doppler için anlık canlı sorgu`
          : `${app.items.length.toLocaleString('en-US')} bundled skins + on-demand live lookup for rare knives & Dopplers`
      },
      {
        title: tr ? 'SPREAD Agent V11 • Gerçek Satış & Doppler Fazları' : 'SPREAD Agent V11 • Clearing-Price & Doppler Phases',
        status: 'OK',
        sub: tr
          ? 'Gerçek Steam son satışa dayalı fiyatlama (hayali ilan koruması), 354+ canlı Doppler/Gamma Doppler fazı, Tekli vs. Sepet Meta-Hakem ve 500 sim. Monte Carlo CVaR'
          : 'Real Steam recent-sales clearing engine (phantom ask guard), 354+ live Doppler/Gamma Doppler phases, Single vs. Basket Meta-Arbitrator & 500-sim Monte Carlo CVaR'
      },
      {
        title: tr ? 'Youpin898 Canlı Emir Defteri + Direkt ID' : 'Youpin898 Live Order Book + Direct IDs',
        status: isLive ? (feeds.youpin !== false ? 'OK' : 'FALLBACK') : 'SNAPSHOT',
        sub: tr
          ? `Canlı Youpin898 Ask + Alım Emri (Buy-Order), direkt skin linkleri (templateId) • 1 USD = ₺${app.market.fxRates.TRY.toFixed(2)} | ¥${app.market.fxRates.CNY.toFixed(2)}`
          : `Live Youpin898 Ask + Highest Buy-Order, direct skin deep-links (templateId) • 1 USD = ₺${app.market.fxRates.TRY.toFixed(2)} | ¥${app.market.fxRates.CNY.toFixed(2)}`
      },
      {
        title: tr ? 'Skinport + Market.CSGO + ByMykel' : 'Skinport + Market.CSGO + ByMykel',
        status: 'OK',
        sub: tr
          ? `${velCount.toLocaleString('tr-TR')} eşya hacim doğrulamalı • Son senkronizasyon: ${fmtRelativeTime(app.market.updatedAt)}`
          : `${velCount.toLocaleString('en-US')} items volume-verified • Last sync: ${fmtRelativeTime(app.market.updatedAt)}`
      }
    ];

    for (const n of nodes) {
      const ok = n.status === 'OK' || n.status === 'LIVE';
      host.appendChild(
        el(
          'div',
          { className: 'telemetry-node' },
          el(
            'div',
            { className: 'telemetry-node-top' },
            el('strong', null, n.title),
            el('span', { className: `pill ${ok ? 'pill-mint' : 'pill-amber'}` }, n.status)
          ),
          el('div', { className: 'txt-muted', style: { fontSize: '11.5px', marginTop: '4px' } }, n.sub)
        )
      );
    }
  }

  return { render };
}
