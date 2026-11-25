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
        title: 'CSFloat Live + Buy Orders',
        status: isLive ? (feeds.csfloatLive !== false ? 'OK' : 'FALLBACK') : 'SNAPSHOT',
        sub: tr ? 'Anlık taban fiyat, ilan derinliği & Bid/Ask' : 'Live min ask, listing depth & Bid/Ask'
      },
      {
        title: 'Steam Market (24h/7d/30d/90d)',
        status: isLive ? (feeds.steam !== false ? 'OK' : 'FALLBACK') : 'SNAPSHOT',
        sub: tr ? 'Tarihsel fiyat + canlı /api/steam-verify 24s hacim' : 'Historical averages + live /api/steam-verify 24h volume'
      },
      {
        title: 'Buff163 Global Cash Anchor',
        status: isLive ? (feeds.buff163 !== false ? 'OK' : 'FALLBACK') : 'SNAPSHOT',
        sub: tr ? 'Küresel nakit referans fiyatı & iskontolu giriş sinyali' : 'Global cash benchmark & undervalued entry signal'
      },
      {
        title: 'Youpin898 + Open ER-API FX',
        status: isLive ? (feeds.youpin !== false ? 'OK' : 'FALLBACK') : 'SNAPSHOT',
        sub: `1 USD = ₺${app.market.fxRates.TRY.toFixed(2)} | ¥${app.market.fxRates.CNY.toFixed(2)} | €${app.market.fxRates.EUR.toFixed(2)}`
      },
      {
        title: tr ? 'Gerçek Satış Hızı (Skinport + M.CSGO)' : 'Real Sales Velocity (Skinport + M.CSGO)',
        status: 'OK',
        sub: tr
          ? `${velCount.toLocaleString('tr-TR')} / ${app.items.length.toLocaleString('tr-TR')} eşya hacim doğrulamalı`
          : `${velCount.toLocaleString('en-US')} / ${app.items.length.toLocaleString('en-US')} items volume-verified`
      },
      {
        title: 'ByMykel / CSGO-API',
        status: 'OK',
        sub: tr ? 'Resmi CS2 skin görselleri, nadirlik ve aşınma kataloğu' : 'Official CS2 skin imagery, rarities & wear metadata'
      },
      {
        title: tr ? 'Son Senkronizasyon' : 'Last Sync',
        status: isLive ? 'LIVE' : 'CACHE',
        sub: fmtRelativeTime(app.market.updatedAt)
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
