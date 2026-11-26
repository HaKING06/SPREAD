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
        title: 'Steam Market Live Order Book + 24h',
        status: isLive ? (feeds.steam !== false ? 'OK' : 'FALLBACK') : 'SNAPSHOT',
        sub: tr
          ? '1. Adım için canlı Steam 24s satış adedi, aktif Steam ilan duvarı ve anında Steam Buy-Order (itemordershistogram)'
          : 'Step 1 live Steam 24h sold count, active Steam sell wall & instant Steam Buy-Order histogram'
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
        title: 'SPREAD Agent V8 • Directional Quant',
        status: 'OK',
        sub: tr
          ? 'Yönlü likidite (1. Adım Steam / 2. Adım Nakit Pazar), 500 senaryolu Monte Carlo CVaR ve paralel sepet oto-dengeleme'
          : 'Directional liquidity (Step 1 Steam / Step 2 Cash Market), 500-trial Monte Carlo CVaR & parallel basket auto-rebalancer'
      },
      {
        title: 'Youpin898 Live Order Book + Direct IDs',
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
