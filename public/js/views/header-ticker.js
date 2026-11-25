/**
 * SPREAD (spread.haking.tr) — Live Spread Ticker Tape & Advanced Command Search Palette
 *
 * Command Palette now supports:
 *  - Name/multi-token fuzzy search
 *  - Exact Min & Max Price Range filtering (e.g. Min $50 -> best spreads >= $50)
 *  - Quick Price Range Chips ($0-5, $5-25, $25-100, $50+, $100+, $250+)
 *  - Smart Sort: 1. Yön En Kârlı / 2. Yön En Az Kayıp / En Likit
 *  - Category Filter
 */

import { buildImageUrl } from '../core/config.js';
import { clearNode, el } from '../core/security.js';
import { evaluateItemMetrics } from '../core/math-engine.js';
import { fmtMoneyFromUsd, fmtPct, fmtRelativeTime, fromUsd, toUsd } from '../core/formatters.js';
import { isTr, t } from '../core/i18n.js';

export function renderLiveTicker(app) {
  const track = document.getElementById('tickerTrack');
  const dot = document.getElementById('liveStatusDot');
  const statusText = document.getElementById('liveStatusText');
  const fxSummary = document.getElementById('tickerFxSummary');
  if (!track) return;

  const isLive = app.market.sourceMode === 'live-edge' || app.market.sourceMode === 'live-local';
  const loc = isTr() ? 'tr-TR' : 'en-US';
  if (dot) dot.className = `live-dot${isLive ? '' : ' is-snapshot'}`;
  if (statusText) {
    const modeLabel = isLive ? t('hdr.live') : t('hdr.cache');
    statusText.textContent = `${modeLabel} • ${app.items.length.toLocaleString(loc)} ${t('hdr.items')} • ${fmtRelativeTime(app.market.updatedAt)}`;
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

  const leg1Top = [];
  const leg2Top = [];
  for (const item of app.items) {
    if (item.st || item.sv) continue;
    if (item.c === 'Capsule' && (item.v7 || 0) < 35) continue;
    if (s.marketplace === 'CSFLOAT' && item.q < 30) continue;
    const m = evaluateItemMetrics(item, evalOpts);
    if (!m.hasValidMarket || m.isSpiky || m.isAnomalySpread) continue;
    const vel = m.velocity;
    if (vel.tier !== 'A' && vel.tier !== 'B') continue;
    if (m.effBuy >= 0.3 && m.leg1ProfitPct >= 8 && m.leg1ProfitPct <= 62) {
      leg1Top.push({ item, m });
    }
    const l2Valid = m.leg2LossPct >= 3.0 || (vel.tier === 'A' && vel.mktVol >= 150 && m.leg2LossPct >= 0.5);
    if (l2Valid && !vel.isKnifeOrGlove && m.steamUsd >= 5 && m.steamUsd <= 250 && m.leg2LossPct <= 11.5) {
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
    track.appendChild(
      el('span', { className: 'txt-muted' }, isTr() ? 'Canlı piyasa verileri hazırlanıyor...' : 'Loading live market spreads...')
    );
    return;
  }

  const buildChips = () =>
    combined.map(({ item, m, leg }) => {
      const metricText =
        leg === 1 ? fmtPct(m.leg1ProfitPct, true) : `${fmtPct(m.leg2LossPct, false)} ${t('leg.lossWord').toLowerCase()}`;
      const metricCls = leg === 1 ? 'txt-mint num' : 'txt-gold num';
      return el(
        'button',
        {
          type: 'button',
          className: 'ticker-item',
          title: isTr() ? `${item.n} — ${leg}. Yöne aktar` : `${item.n} — Load to Leg ${leg}`,
          onClick: () => app.applyItemToLeg(item, leg)
        },
        el('span', { className: 'ticker-item-leg' }, leg === 1 ? 'L1' : 'L2'),
        el('span', { className: 'ticker-item-name' }, item.n),
        el('span', { className: metricCls }, metricText)
      );
    });

  for (const node of [...buildChips(), ...buildChips()]) {
    track.appendChild(node);
  }
}

export function initCommandPalette(app) {
  const modal = document.getElementById('cmdPaletteModal');
  const input = document.getElementById('cmdSearchInput');
  const minInp = document.getElementById('cmdMinPriceInput');
  const maxInp = document.getElementById('cmdMaxPriceInput');
  const catSel = document.getElementById('cmdCategorySelect');
  const sortSel = document.getElementById('cmdSortSelect');
  const metaCountEl = document.getElementById('cmdMatchCount');
  const list = document.getElementById('cmdResultsList');
  const closeBtn = document.getElementById('cmdCloseBtn');
  const openBtn = document.getElementById('openCmdSearchBtn');

  let targetLegHint = null;

  function renderResults() {
    clearNode(list);
    const s = app.settings;
    const fx = app.market.fxRates;
    const cur = s.currency;

    const query = (input?.value || '').trim().toLowerCase();
    const tokens = query.split(/\s+/).filter(Boolean);
    const minDisp = parseFloat(minInp?.value);
    const maxDisp = parseFloat(maxInp?.value);
    const minUsd = Number.isFinite(minDisp) && minDisp > 0 ? toUsd(minDisp, cur, fx) : 0;
    const maxUsd = Number.isFinite(maxDisp) && maxDisp > 0 ? toUsd(maxDisp, cur, fx) : 0;
    const category = catSel?.value || 'ALL';
    const sortBy = sortSel?.value || 'LEG1_DESC';

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

    const matches = [];
    for (const item of app.items) {
      if (category !== 'ALL' && item.c !== category) continue;
      if (tokens.length > 0) {
        const hay = `${item.n} ${item.c} ${item.w} ${item.r}`.toLowerCase();
        if (!tokens.every((tok) => hay.includes(tok))) continue;
      }

      const m = evaluateItemMetrics(item, evalOpts);
      if (!m.hasValidMarket) continue;

      // Filter by active reference price (Leg 1 buy price for L1 sort, Steam buy price for L2 sort)
      const refPrice = sortBy === 'LEG2_ASC' ? m.steamUsd : m.marketBuyUsd;
      if (minUsd > 0 && refPrice < minUsd) continue;
      if (maxUsd > 0 && refPrice > maxUsd) continue;

      // Skip extreme illiquid/manipulated outliers when sorting by profit/loss without text query
      if (tokens.length === 0) {
        if (s.marketplace === 'CSFLOAT' && item.q < 12) continue;
        if (m.isSpiky) continue;
        if (sortBy === 'LEG1_DESC' && m.leg1ProfitPct > 70) continue;
        if (sortBy === 'LEG2_ASC' && m.leg2LossPct < -6) continue;
      }

      matches.push({ item, m });
    }

    matches.sort((a, b) => {
      if (sortBy === 'LEG2_ASC') return a.m.leg2LossPct - b.m.leg2LossPct;
      if (sortBy === 'QTY_DESC') return (b.item.q || 0) - (a.item.q || 0);
      if (sortBy === 'PRICE_ASC') return a.m.marketBuyUsd - b.m.marketBuyUsd;
      if (sortBy === 'PRICE_DESC') return b.m.marketBuyUsd - a.m.marketBuyUsd;
      return b.m.leg1ProfitPct - a.m.leg1ProfitPct;
    });

    const tr = isTr();
    if (metaCountEl) {
      metaCountEl.textContent = `${matches.length.toLocaleString(tr ? 'tr-TR' : 'en-US')} ${tr ? 'sonuç' : 'results'}`;
    }

    const slice = matches.slice(0, 40);
    if (slice.length === 0) {
      list.appendChild(
        el(
          'div',
          { className: 'panel-pad ta-center txt-muted', style: { fontSize: '12.5px' } },
          tr
            ? 'Bu fiyat aralığında veya aramada eşya bulunamadı. Min/Maks aralığını genişletin.'
            : 'No CS2 items match this search or price range. Try widening Min/Max.'
        )
      );
      return;
    }

    const mktShort = s.marketplace === 'YOUPIN' ? 'YP' : 'CF';
    for (const { item, m } of slice) {
      const l1Cls = m.leg1ProfitPct > 0 ? 'txt-mint' : 'txt-crimson';
      const l2Cls = m.leg2LossPct <= 10 ? 'txt-mint' : m.leg2LossPct <= 15 ? 'txt-amber' : 'txt-crimson';

      const row = el(
        'div',
        { className: 'cmd-row' },
        el(
          'div',
          { className: 'item-cell', style: { minWidth: '0', flex: '1' } },
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
              el('span', null, `${mktShort}: ${fmtMoneyFromUsd(m.marketBuyUsd, cur, fx)}`),
              el('span', null, '→'),
              el('span', null, `Steam: ${fmtMoneyFromUsd(m.steamUsd, cur, fx)}`),
              item.q > 0 ? el('span', { className: 'txt-muted' }, `• ${item.q} ${tr ? 'ilan' : 'listed'}`) : null,
              el('span', { className: 'txt-muted' }, `• ${m.velocity.shortLabel}`)
            )
          )
        ),
        el(
          'div',
          { className: 'cmd-metrics-col num' },
          el('span', { className: l1Cls, title: tr ? '1. Yön Bakiye Kârı' : 'Leg 1 Steam Boost' }, `L1 ${fmtPct(m.leg1ProfitPct, true)}`),
          el('span', { className: l2Cls, title: tr ? '2. Yön Nakit Kaybı' : 'Leg 2 Cashout Loss' }, `L2 ${fmtPct(m.leg2LossPct, false)}`)
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
            tr ? '1. Yön' : 'Leg 1'
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
            tr ? '2. Yön' : 'Leg 2'
          )
        )
      );
      list.appendChild(row);
    }
  }

  function open(legHint = null, presetMinUsd = null) {
    targetLegHint = legHint;
    if (sortSel) {
      sortSel.value = legHint === 2 ? 'LEG2_ASC' : 'LEG1_DESC';
    }
    if (presetMinUsd !== null && minInp) {
      minInp.value = presetMinUsd > 0 ? fromUsd(presetMinUsd, app.settings.currency, app.market.fxRates).toFixed(0) : '';
      if (maxInp) maxInp.value = '';
    }
    modal.classList.remove('hidden');
    renderResults();
    setTimeout(() => input?.focus(), 20);
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

  [input, minInp, maxInp].forEach((elNode) => {
    elNode?.addEventListener('input', renderResults);
  });
  [catSel, sortSel].forEach((elNode) => {
    elNode?.addEventListener('change', renderResults);
  });

  // Quick Price Range Chips inside Command Palette
  document.querySelectorAll('[data-cmd-range]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [lo, hi] = btn.dataset.cmdRange.split(':').map(Number);
      const cur = app.settings.currency;
      const fx = app.market.fxRates;
      if (minInp) minInp.value = lo > 0 ? fromUsd(lo, cur, fx).toFixed(0) : '';
      if (maxInp) maxInp.value = hi > 0 ? fromUsd(hi, cur, fx).toFixed(0) : '';
      document.querySelectorAll('[data-cmd-range]').forEach((b) => {
        b.classList.toggle('is-active', b === btn);
      });
      renderResults();
    });
  });

  document.getElementById('cmdClearFiltersBtn')?.addEventListener('click', () => {
    if (input) input.value = '';
    if (minInp) minInp.value = '';
    if (maxInp) maxInp.value = '';
    if (catSel) catSel.value = 'ALL';
    document.querySelectorAll('[data-cmd-range]').forEach((b) => b.classList.remove('is-active'));
    renderResults();
  });

  return { open, close };
}
