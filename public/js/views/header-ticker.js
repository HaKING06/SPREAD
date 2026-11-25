/**
 * SPREAD (spread.haking.tr) — Live Spread Ticker Tape & Global Command Palette (Ctrl+K)
 */

import { buildImageUrl } from '../core/config.js';
import { clearNode, el } from '../core/security.js';
import { evaluateItemMetrics } from '../core/math-engine.js';
import { fmtMoneyFromUsd, fmtPct, fmtRelativeTime } from '../core/formatters.js';

export function renderLiveTicker(app) {
  const track = document.getElementById('tickerTrack');
  const dot = document.getElementById('liveStatusDot');
  const statusText = document.getElementById('liveStatusText');
  const fxSummary = document.getElementById('tickerFxSummary');
  if (!track) return;

  const isLive = app.market.sourceMode === 'live-edge' || app.market.sourceMode === 'live-local';
  if (dot) {
    dot.className = `live-dot${isLive ? '' : ' is-snapshot'}`;
  }
  if (statusText) {
    const modeLabel = isLive ? 'CANLI' : 'ÖNBELLEK';
    statusText.textContent = `${modeLabel} • ${app.items.length.toLocaleString('tr-TR')} eşya • ${fmtRelativeTime(app.market.updatedAt)}`;
  }
  if (fxSummary) {
    const fx = app.market.fxRates;
    fxSummary.textContent = `1 USD = ₺${fx.TRY.toFixed(2)} | ¥${fx.CNY.toFixed(2)} | €${fx.EUR.toFixed(2)}`;
  }

  const s = app.settings;
  const evalOpts = {
    marketplace: s.marketplace,
    buyFeePct: s.buyFeePct,
    sellFeePct: s.sellFeePct,
    withdrawFeePct: s.withdrawFeePct,
    steamFeeMode: s.steamFeeMode,
    steamCustomFeePct: s.steamCustomFeePct,
    useBuyOrderForLeg2: s.useBuyOrderForLeg2,
    conservativeSteamPrice: s.conservativeSteamPrice
  };

  // Pick top liquid Leg 1 and Leg 2 highlights for scrolling ticker
  const leg1Top = [];
  const leg2Top = [];
  for (const item of app.items) {
    if (s.marketplace === 'CSFLOAT' && item.q < 30) continue;
    const m = evaluateItemMetrics(item, evalOpts);
    if (!m.hasValidMarket || m.isSpiky) continue;
    if (m.effBuy >= 0.15 && m.leg1ProfitPct >= 8 && m.leg1ProfitPct <= 60) {
      leg1Top.push({ item, m });
    }
    if (m.steamUsd >= 5 && m.steamUsd <= 250 && m.leg2LossPct >= -2 && m.leg2LossPct <= 11) {
      leg2Top.push({ item, m });
    }
  }
  leg1Top.sort((a, b) => b.m.leg1ProfitPct - a.m.leg1ProfitPct);
  leg2Top.sort((a, b) => a.m.leg2LossPct - b.m.leg2LossPct);

  const combined = [
    ...leg1Top.slice(0, 7).map((x) => ({ ...x, leg: 1 })),
    ...leg2Top.slice(0, 5).map((x) => ({ ...x, leg: 2 }))
  ];

  clearNode(track);
  if (combined.length === 0) {
    track.appendChild(el('span', { className: 'txt-muted' }, 'Canlı piyasa akışı hazırlanıyor...'));
    return;
  }

  const buildChips = () =>
    combined.map(({ item, m, leg }) => {
      const metricText = leg === 1 ? fmtPct(m.leg1ProfitPct, true) : `${fmtPct(m.leg2LossPct, false)} kayıp`;
      const metricCls = leg === 1 ? 'txt-mint num' : 'txt-gold num';
      return el(
        'button',
        {
          type: 'button',
          className: 'ticker-item',
          title: `${item.n} — ${leg}. Yöne aktar`,
          onClick: () => app.applyItemToLeg(item, leg)
        },
        el('span', { className: 'ticker-item-leg' }, leg === 1 ? 'L1' : 'L2'),
        el('span', { className: 'ticker-item-name' }, item.n),
        el('span', { className: metricCls }, metricText)
      );
    });

  // Duplicate list for seamless infinite CSS scroll loop
  for (const node of [...buildChips(), ...buildChips()]) {
    track.appendChild(node);
  }
}

export function initCommandPalette(app) {
  const modal = document.getElementById('cmdPaletteModal');
  const input = document.getElementById('cmdSearchInput');
  const list = document.getElementById('cmdResultsList');
  const closeBtn = document.getElementById('cmdCloseBtn');
  const openBtn = document.getElementById('openCmdSearchBtn');

  let targetLegHint = null;

  function renderResults(query) {
    clearNode(list);
    const tokens = query
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    const s = app.settings;
    const fx = app.market.fxRates;
    const matches = [];

    for (const item of app.items) {
      if (tokens.length > 0) {
        const hay = `${item.n} ${item.c} ${item.w}`.toLowerCase();
        if (!tokens.every((t) => hay.includes(t))) continue;
      }
      matches.push(item);
      if (matches.length >= 25) break;
    }

    if (matches.length === 0) {
      list.appendChild(
        el('div', { className: 'panel-pad ta-center txt-muted', style: { fontSize: '12.5px' } }, 'Eşleşen CS2 eşyası bulunamadı.')
      );
      return;
    }

    const evalOpts = {
      marketplace: s.marketplace,
      buyFeePct: s.buyFeePct,
      sellFeePct: s.sellFeePct,
      withdrawFeePct: s.withdrawFeePct,
      steamFeeMode: s.steamFeeMode,
      steamCustomFeePct: s.steamCustomFeePct,
      useBuyOrderForLeg2: s.useBuyOrderForLeg2,
      conservativeSteamPrice: s.conservativeSteamPrice
    };

    for (const item of matches) {
      const m = evaluateItemMetrics(item, evalOpts);
      const row = el(
        'div',
        { className: 'cmd-row' },
        el(
          'div',
          { className: 'item-cell', style: { minWidth: '0' } },
          el(
            'div',
            { className: 'skin-thumb', style: { '--rarity-color': item.rc || '#b0c3d9' } },
            el('img', { src: buildImageUrl(item.img), alt: item.n, loading: 'lazy' })
          ),
          el(
            'div',
            { className: 'item-cell-info' },
            el('div', { className: 'item-cell-name' }, item.n),
            el(
              'div',
              { className: 'item-cell-sub num' },
              item.w ? el('span', { className: `wear-tag wear-${item.w}` }, item.w) : null,
              el('span', null, `${s.marketplace === 'YOUPIN' ? 'YP' : 'CF'}: ${fmtMoneyFromUsd(m.marketBuyUsd, s.currency, fx)}`),
              el('span', null, '•'),
              el('span', null, `Steam: ${fmtMoneyFromUsd(m.steamUsd, s.currency, fx)}`),
              el('span', { className: m.leg1ProfitPct > 0 ? 'txt-mint' : 'txt-muted' }, `L1 ${fmtPct(m.leg1ProfitPct, true)}`)
            )
          )
        ),
        el(
          'div',
          { style: { display: 'flex', gap: '6px', flexShrink: '0' } },
          el(
            'button',
            {
              type: 'button',
              className: `btn btn-sm ${targetLegHint === 1 ? 'btn-primary' : ''}`,
              onClick: () => {
                app.applyItemToLeg(item, 1);
                close();
              }
            },
            '1. Yön'
          ),
          el(
            'button',
            {
              type: 'button',
              className: `btn btn-sm ${targetLegHint === 2 ? 'btn-primary' : ''}`,
              onClick: () => {
                app.applyItemToLeg(item, 2);
                close();
              }
            },
            '2. Yön'
          )
        )
      );
      list.appendChild(row);
    }
  }

  function open(legHint = null) {
    targetLegHint = legHint;
    modal.classList.remove('hidden');
    input.value = '';
    renderResults('');
    setTimeout(() => input.focus(), 20);
  }

  function close() {
    modal.classList.add('hidden');
    targetLegHint = null;
  }

  openBtn?.addEventListener('click', () => open(null));
  closeBtn?.addEventListener('click', close);
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
  input?.addEventListener('input', (e) => renderResults(e.target.value));

  return { open, close };
}
