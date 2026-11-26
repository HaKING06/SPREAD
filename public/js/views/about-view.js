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
        title: 'CSFloat Live + Real Sales Graph',
        status: isLive ? (feeds.csfloatLive !== false ? 'OK' : 'FALLBACK') : 'SNAPSHOT',
        sub: tr
          ? 'Anlık taban fiyat, buy-order, ilan derinliği + canlı 24s/7g/30g CSFloat satış geçmişi'
          : 'Live min ask, buy orders, depth + real live 24h/7d/30d CSFloat sales history'
      },
      {
        title: 'Steam Market (24h/7d/30d/90d)',
        status: isLive ? (feeds.steam !== false ? 'OK' : 'FALLBACK') : 'SNAPSHOT',
        sub: tr ? 'Tarihsel fiyat + canlı 24s hacim & medyan doğrulama' : 'Historical averages + live 24h sold volume & median'
      },
      {
        title: 'Buff163 Global Cash Anchor',
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
        title: 'SPREAD Agent V7 • Monte Carlo & CVaR',
        status: 'OK',
        sub: tr
          ? '500 senaryolu kalın-kuyruklu risk simülasyonu, Kâr İhtimali (PoP %) ve paralel sepet oto-dengeleme'
          : '500-scenario fat-tail risk simulation, Profit Probability (PoP %) & parallel basket auto-rebalancing'
      },
      {
        title: 'Youpin898 + Open ER-API FX',
        status: isLive ? (feeds.youpin !== false ? 'OK' : 'FALLBACK') : 'SNAPSHOT',
        sub: `1 USD = ₺${app.market.fxRates.TRY.toFixed(2)} | ¥${app.market.fxRates.CNY.toFixed(2)} | €${app.market.fxRates.EUR.toFixed(2)}`
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
