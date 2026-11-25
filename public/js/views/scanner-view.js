/**
 * SPREAD (spread.haking.tr) — Live 4,500-Item CS2 Market Scanner & Auto-Pair Finder
 */

import { MARKETPLACES, buildImageUrl, steamMarketUrl } from '../core/config.js';
import { clampNumber, cleanText, clearNode, el } from '../core/security.js';
import { evaluateItemMetrics, findOptimalPairs } from '../core/math-engine.js';
import { fmtMoneyFromUsd, fmtMult, fmtPct, toUsd } from '../core/formatters.js';
import { drawSparkline } from '../charts/canvas-charts.js';

const PAGE_SIZE = 35;

export function initScannerView(app) {
  const filterState = {
    mode: 'LEG1', // 'ALL' | 'LEG1' | 'LEG2' | 'WATCH' | 'CUSTOM'
    category: 'ALL',
    search: '',
    minQty: 15,
    minPriceUsd: 0,
    maxPriceUsd: 500,
    sortBy: 'AUTO',
    page: 1
  };

  const pairGrid = document.getElementById('optimalPairsGrid');
  const tbody = document.getElementById('scannerTableBody');
  const countEl = document.getElementById('scannerCountInfo');
  const pageInfoEl = document.getElementById('scannerPageInfo');
  const prevBtn = document.getElementById('scannerPrevPage');
  const nextBtn = document.getElementById('scannerNextPage');

  const searchInp = document.getElementById('scannerSearchInput');
  const catSel = document.getElementById('scannerCategorySelect');
  const qtySel = document.getElementById('scannerMinQtySelect');
  const minPriceInp = document.getElementById('scannerMinPriceInput');
  const maxPriceInp = document.getElementById('scannerMaxPriceInput');
  const sortSel = document.getElementById('scannerSortSelect');
  const buyOrderToggle = document.getElementById('toggleBuyOrderLeg2');
  const conservativeToggle = document.getElementById('toggleConservativeSteam');

  const addDrawer = document.getElementById('customItemDrawer');
  const importDrawer = document.getElementById('importItemsDrawer');

  function getEvalOpts() {
    const s = app.settings;
    return {
      marketplace: s.marketplace,
      buyFeePct: s.buyFeePct,
      sellFeePct: s.sellFeePct,
      withdrawFeePct: s.withdrawFeePct,
      steamFeeMode: s.steamFeeMode,
      steamCustomFeePct: s.steamCustomFeePct,
      useBuyOrderForLeg2: s.useBuyOrderForLeg2,
      conservativeSteamPrice: s.conservativeSteamPrice
    };
  }

  function renderOptimalPairs() {
    if (!pairGrid) return;
    clearNode(pairGrid);
    const s = app.settings;
    const fx = app.market.fxRates;
    const money = (u) => fmtMoneyFromUsd(u, s.currency, fx);
    const pairs = findOptimalPairs(app.items, getEvalOpts(), s.capitalUsd);

    if (pairs.length === 0) {
      pairGrid.appendChild(
        el(
          'div',
          { className: 'txt-muted', style: { gridColumn: '1 / -1', fontSize: '12.5px' } },
          'Mevcut komisyon ve sermaye kısıtlarıyla kârlı likit tam döngü çifti bulunamadı. Sermayeyi veya pazar modunu değiştirmeyi deneyin.'
        )
      );
      return;
    }

    pairs.forEach((p, idx) => {
      const card = el(
        'div',
        { className: 'pair-card' },
        el(
          'div',
          { className: 'pair-card-top' },
          el('span', { className: 'pill pill-gold' }, `#${idx + 1} EN İYİ ÇİFT`),
          el('span', { className: 'pill pill-mint' }, `${fmtPct(p.roiPct, true)} • ${fmtMult(p.mCycle)}`)
        ),
        el(
          'div',
          { className: 'pair-items-stack' },
          el(
            'div',
            { className: 'pair-mini-item' },
            el(
              'div',
              { className: 'pair-mini-thumb', style: { '--rarity-color': p.leg1.item.rc || '#b0c3d9' } },
              el('img', { src: buildImageUrl(p.leg1.item.img), alt: p.leg1.item.n, loading: 'lazy' })
            ),
            el(
              'div',
              { className: 'pair-mini-info' },
              el('div', { className: 'pair-mini-name', title: p.leg1.item.n }, `1. Yön: ${p.leg1.item.n}`),
              el(
                'div',
                { className: 'pair-mini-sub' },
                `${money(p.leg1.m.marketBuyUsd)} → ${money(p.leg1.m.steamUsd)} `,
                el('span', { className: 'txt-mint' }, `(${fmtPct(p.leg1.m.leg1ProfitPct, true)})`)
              )
            )
          ),
          el(
            'div',
            { className: 'pair-mini-item' },
            el(
              'div',
              { className: 'pair-mini-thumb', style: { '--rarity-color': p.leg2.item.rc || '#b0c3d9' } },
              el('img', { src: buildImageUrl(p.leg2.item.img), alt: p.leg2.item.n, loading: 'lazy' })
            ),
            el(
              'div',
              { className: 'pair-mini-info' },
              el('div', { className: 'pair-mini-name', title: p.leg2.item.n }, `2. Yön: ${p.leg2.item.n}`),
              el(
                'div',
                { className: 'pair-mini-sub' },
                `${money(p.leg2.m.steamUsd)} → ${money(p.leg2.m.marketSellUsd)} `,
                el('span', { className: 'txt-gold' }, `(${fmtPct(p.leg2.m.leg2LossPct, false)} kayıp)`)
              )
            )
          )
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'btn btn-primary btn-sm',
            style: { width: '100%' },
            onClick: () => app.applyPair(p.leg1.item, p.leg2.item, p.leg1.m, p.leg2.m)
          },
          'Çifti Hesaplayıcıya Aktar →'
        )
      );
      pairGrid.appendChild(card);
    });
  }

  function renderTable() {
    if (!tbody) return;
    const s = app.settings;
    const fx = app.market.fxRates;
    const mkt = MARKETPLACES[s.marketplace] || MARKETPLACES.CSFLOAT;
    const money = (u) => fmtMoneyFromUsd(u, s.currency, fx);
    const evalOpts = getEvalOpts();
    const watchSet = new Set(app.watchlist);

    const tokens = filterState.search.toLowerCase().trim().split(/\s+/).filter(Boolean);

    const evaluated = [];
    for (const item of app.items) {
      if (filterState.mode === 'WATCH' && !watchSet.has(item.n)) continue;
      if (filterState.mode === 'CUSTOM' && !item.isCustom) continue;
      if (filterState.category !== 'ALL' && item.c !== filterState.category) continue;
      if (s.marketplace === 'CSFLOAT' && !item.isCustom && (item.q || 0) < filterState.minQty) continue;

      if (tokens.length > 0) {
        const hay = `${item.n} ${item.c} ${item.w} ${item.r}`.toLowerCase();
        if (!tokens.every((t) => hay.includes(t))) continue;
      }

      const m = evaluateItemMetrics(item, evalOpts);
      if (!m.hasValidMarket) continue;
      const refPriceUsd = filterState.mode === 'LEG2' ? m.steamUsd : m.marketBuyUsd;
      if (filterState.minPriceUsd > 0 && refPriceUsd < filterState.minPriceUsd) continue;
      if (filterState.maxPriceUsd > 0 && refPriceUsd > filterState.maxPriceUsd) continue;

      if (filterState.mode === 'LEG1' && (m.leg1ProfitPct <= 0 || m.leg1ProfitPct > 85)) continue;
      if (filterState.mode === 'LEG2' && (m.leg2LossPct > 15 || m.leg2LossPct < -8)) continue;

      evaluated.push({ item, m });
    }

    // Sorting
    const activeSort =
      filterState.sortBy === 'AUTO'
        ? filterState.mode === 'LEG2'
          ? 'LEG2_ASC'
          : 'LEG1_DESC'
        : filterState.sortBy;

    evaluated.sort((a, b) => {
      if (activeSort === 'LEG1_DESC') return b.m.leg1ProfitPct - a.m.leg1ProfitPct;
      if (activeSort === 'LEG2_ASC') return a.m.leg2LossPct - b.m.leg2LossPct;
      if (activeSort === 'QTY_DESC') return (b.item.q || 0) - (a.item.q || 0);
      if (activeSort === 'PRICE_ASC') return a.m.marketBuyUsd - b.m.marketBuyUsd;
      if (activeSort === 'PRICE_DESC') return b.m.marketBuyUsd - a.m.marketBuyUsd;
      return b.m.leg1ProfitPct - a.m.leg1ProfitPct;
    });

    const total = evaluated.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (filterState.page > totalPages) filterState.page = totalPages;

    const start = (filterState.page - 1) * PAGE_SIZE;
    const slice = evaluated.slice(start, start + PAGE_SIZE);

    if (countEl) {
      countEl.textContent = `${total.toLocaleString('tr-TR')} eşya eşleşti (${mkt.name} ↔ Steam)`;
    }
    if (pageInfoEl) {
      pageInfoEl.textContent = `Sayfa ${filterState.page} / ${totalPages}`;
    }
    if (prevBtn) prevBtn.disabled = filterState.page <= 1;
    if (nextBtn) nextBtn.disabled = filterState.page >= totalPages;

    clearNode(tbody);

    if (slice.length === 0) {
      tbody.appendChild(
        el(
          'tr',
          null,
          el(
            'td',
            { colspan: '8', className: 'ta-center txt-muted', style: { padding: '32px' } },
            'Filtrelere uygun eşya bulunamadı. Minimum ilan derinliğini veya fiyat sınırını genişletmeyi deneyin.'
          )
        )
      );
      return;
    }

    for (const { item, m } of slice) {
      const isWatched = watchSet.has(item.n);
      const l1Cls = m.leg1ProfitPct > 0 ? 'pill-mint' : 'pill-crimson';
      const l2Cls = m.leg2LossPct <= 10 ? 'pill-mint' : m.leg2LossPct <= 15 ? 'pill-amber' : 'pill-crimson';

      const sparkCanvas = el('canvas', { className: 'sparkline-canvas', title: 'Steam 90g → 30g → 7g → 24s trendi' });
      requestAnimationFrame(() => {
        drawSparkline(sparkCanvas, [item.s90, item.s30, item.s7, item.s]);
      });

      const marketPriceCell = el(
        'td',
        { className: 'ta-right num' },
        el('div', { style: { fontWeight: '600' } }, money(m.marketBuyUsd)),
        s.marketplace === 'CSFLOAT' && item.cfo > 0
          ? el('div', { style: { fontSize: '10.5px' }, className: 'txt-muted' }, `BO: ${money(item.cfo)}`)
          : null
      );

      const steamPriceCell = el(
        'td',
        { className: 'ta-right num' },
        el('div', { style: { fontWeight: '600' } }, money(m.steamUsd)),
        m.isSpiky
          ? el('div', { style: { fontSize: '10px' }, className: 'txt-amber' }, '⚠ Volatil')
          : el('div', { style: { fontSize: '10.5px' }, className: 'txt-muted' }, `7g: ${money(item.s7)}`)
      );

      const tr = el(
        'tr',
        null,
        // Item with real CS2 image & rarity color bar
        el(
          'td',
          null,
          el(
            'div',
            { className: 'item-cell' },
            el(
              'button',
              {
                type: 'button',
                className: isWatched ? 'txt-gold' : 'txt-muted',
                title: isWatched ? 'İzleme listesinden çıkar' : 'İzleme listesine ekle',
                style: { fontSize: '15px', padding: '2px' },
                onClick: () => app.toggleWatchlist(item.n)
              },
              isWatched ? '★' : '☆'
            ),
            el(
              'div',
              { className: 'skin-thumb', style: { '--rarity-color': item.rc || '#b0c3d9' } },
              el('img', { src: buildImageUrl(item.img), alt: item.n, loading: 'lazy' })
            ),
            el(
              'div',
              { className: 'item-cell-info' },
              el(
                'div',
                { className: 'item-cell-name' },
                el('span', null, item.n)
              ),
              el(
                'div',
                { className: 'item-cell-sub' },
                item.st ? el('span', { className: 'wear-tag wear-ST' }, 'ST™') : null,
                item.w ? el('span', { className: `wear-tag wear-${item.w}` }, item.w) : null,
                el('span', null, item.c),
                el('span', null, '•'),
                el(
                  'a',
                  { href: steamMarketUrl(item.n), target: '_blank', rel: 'noopener noreferrer', className: 'txt-muted' },
                  'Steam'
                ),
                el('span', null, '/'),
                el(
                  'a',
                  { href: mkt.searchUrl(item.n), target: '_blank', rel: 'noopener noreferrer', className: 'txt-muted' },
                  mkt.shortName
                )
              )
            )
          )
        ),
        // Depth / Liquidity
        el(
          'td',
          { className: 'ta-right num' },
          el(
            'span',
            { className: `pill ${item.q >= 100 ? 'pill-mint' : item.q >= 25 ? 'pill-ice' : 'pill-muted'}` },
            item.q > 0 ? `${item.q} ilan` : 'YP'
          )
        ),
        // Market price
        marketPriceCell,
        // Steam price
        steamPriceCell,
        // Sparkline
        el('td', { className: 'ta-center' }, sparkCanvas),
        // Leg 1 Profit %
        el(
          'td',
          { className: 'ta-right' },
          el('span', { className: `pill ${l1Cls}` }, fmtPct(m.leg1ProfitPct, true))
        ),
        // Leg 2 Loss %
        el(
          'td',
          { className: 'ta-right' },
          el('span', { className: `pill ${l2Cls}` }, fmtPct(m.leg2LossPct, false))
        ),
        // Actions
        el(
          'td',
          { className: 'ta-right' },
          el(
            'div',
            { style: { display: 'inline-flex', gap: '5px' } },
            el(
              'button',
              {
                type: 'button',
                className: 'btn btn-sm',
                onClick: () => app.applyItemToLeg(item, 1)
              },
              '1. Yön'
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'btn btn-sm',
                onClick: () => app.applyItemToLeg(item, 2)
              },
              '2. Yön'
            ),
            item.isCustom
              ? el(
                  'button',
                  {
                    type: 'button',
                    className: 'btn btn-sm btn-danger',
                    title: 'Özel eşyayı sil',
                    onClick: () => app.deleteCustomItem(item.customId)
                  },
                  '✕'
                )
              : null
          )
        )
      );

      tbody.appendChild(tr);
    }
  }

  // Filter events
  document.querySelectorAll('[data-scan-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      filterState.mode = btn.dataset.scanMode;
      filterState.page = 1;
      document.querySelectorAll('[data-scan-mode]').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.scanMode === filterState.mode);
      });
      renderTable();
    });
  });

  let searchDebounce = null;
  searchInp?.addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      filterState.search = e.target.value;
      filterState.page = 1;
      renderTable();
    }, 120);
  });

  catSel?.addEventListener('change', (e) => {
    filterState.category = e.target.value;
    filterState.page = 1;
    renderTable();
  });

  qtySel?.addEventListener('change', (e) => {
    filterState.minQty = Number(e.target.value) || 0;
    filterState.page = 1;
    renderTable();
  });

  minPriceInp?.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    filterState.minPriceUsd = Number.isFinite(v) && v > 0 ? toUsd(v, app.settings.currency, app.market.fxRates) : 0;
    filterState.page = 1;
    renderTable();
  });

  maxPriceInp?.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    filterState.maxPriceUsd = Number.isFinite(v) && v > 0 ? toUsd(v, app.settings.currency, app.market.fxRates) : 0;
    filterState.page = 1;
    renderTable();
  });

  sortSel?.addEventListener('change', (e) => {
    filterState.sortBy = e.target.value;
    filterState.page = 1;
    renderTable();
  });

  buyOrderToggle?.addEventListener('change', (e) => {
    app.settings.useBuyOrderForLeg2 = e.target.checked;
    app.saveSettings();
    render();
  });

  conservativeToggle?.addEventListener('change', (e) => {
    app.settings.conservativeSteamPrice = e.target.checked;
    app.saveSettings();
    render();
  });

  prevBtn?.addEventListener('click', () => {
    if (filterState.page > 1) {
      filterState.page -= 1;
      renderTable();
    }
  });

  nextBtn?.addEventListener('click', () => {
    filterState.page += 1;
    renderTable();
  });

  // Drawers: Custom Item + CSV/JSON Import
  document.getElementById('toggleCustomItemBtn')?.addEventListener('click', () => {
    importDrawer?.classList.add('hidden');
    addDrawer?.classList.toggle('hidden');
  });

  document.getElementById('toggleImportItemsBtn')?.addEventListener('click', () => {
    addDrawer?.classList.add('hidden');
    importDrawer?.classList.toggle('hidden');
  });

  document.getElementById('customItemForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const cur = app.settings.currency;
    const fx = app.market.fxRates;
    const name = cleanText(document.getElementById('customItemName').value, 120);
    const mktDisp = parseFloat(document.getElementById('customItemMkt').value);
    const stDisp = parseFloat(document.getElementById('customItemSteam').value);
    const cat = cleanText(document.getElementById('customItemCat').value || 'Özel', 32);

    if (!name || !Number.isFinite(mktDisp) || mktDisp <= 0 || !Number.isFinite(stDisp) || stDisp <= 0) {
      app.toast('Geçerli eşya adı ve fiyatlar girin.', 'warn');
      return;
    }

    const mktUsd = clampNumber(toUsd(mktDisp, cur, fx), 0.01, 100000);
    const steamUsd = clampNumber(toUsd(stDisp, cur, fx), 0.03, 100000);

    app.addCustomItems([
      {
        id: `usr-${Date.now()}`,
        name,
        category: cat,
        wear: '',
        steamUsd,
        csfloatUsd: mktUsd,
        youpinUsd: mktUsd,
        qty: 99
      }
    ]);
    e.target.reset();
    addDrawer.classList.add('hidden');
  });

  document.getElementById('fillImportSampleBtn')?.addEventListener('click', () => {
    document.getElementById('bulkImportTextarea').value = [
      'Gallery Case,0.82,1.28,Case',
      'AK-47 | Slate (Field-Tested),2.15,2.45,Rifles',
      'AWP | Atheris (Field-Tested),2.35,2.68,Rifles'
    ].join('\n');
  });

  document.getElementById('runBulkImportBtn')?.addEventListener('click', () => {
    const raw = (document.getElementById('bulkImportTextarea').value || '').trim();
    if (!raw) {
      app.toast('İçe aktarılacak CSV veya JSON verisi girin.', 'warn');
      return;
    }
    const cur = app.settings.currency;
    const fx = app.market.fxRates;
    const parsed = [];

    try {
      if (raw.startsWith('[') || raw.startsWith('{')) {
        const j = JSON.parse(raw);
        const arr = Array.isArray(j) ? j : [j];
        arr.forEach((row, idx) => {
          const name = cleanText(row.name || row.ad || '', 120);
          const m = parseFloat(row.marketPrice ?? row.csfloat ?? row.youpin ?? 0);
          const s = parseFloat(row.steamPrice ?? row.steam ?? 0);
          if (name && m > 0 && s > 0) {
            const mUsd = toUsd(m, cur, fx);
            parsed.push({
              id: `imp-${Date.now()}-${idx}`,
              name,
              category: cleanText(row.category || 'Özel', 32),
              wear: '',
              csfloatUsd: mUsd,
              youpinUsd: mUsd,
              steamUsd: toUsd(s, cur, fx),
              qty: 99
            });
          }
        });
      } else {
        raw.split(/\r?\n/).forEach((line, idx) => {
          const parts = line.split(/[,;]/).map((p) => p.trim());
          if (parts.length >= 3) {
            const name = cleanText(parts[0], 120);
            const m = parseFloat(parts[1]);
            const s = parseFloat(parts[2]);
            const cat = cleanText(parts[3] || 'Özel', 32);
            if (name && m > 0 && s > 0) {
              const mUsd = toUsd(m, cur, fx);
              parsed.push({
                id: `imp-${Date.now()}-${idx}`,
                name,
                category: cat,
                wear: '',
                csfloatUsd: mUsd,
                youpinUsd: mUsd,
                steamUsd: toUsd(s, cur, fx),
                qty: 99
              });
            }
          }
        });
      }
    } catch {
      app.toast('CSV/JSON ayrıştırılamadı. Formatı kontrol edin.', 'err');
      return;
    }

    if (parsed.length === 0) {
      app.toast('Geçerli eşya satırı bulunamadı.', 'warn');
      return;
    }

    app.addCustomItems(parsed);
    document.getElementById('bulkImportTextarea').value = '';
    importDrawer.classList.add('hidden');
  });

  function render() {
    if (buyOrderToggle) buyOrderToggle.checked = Boolean(app.settings.useBuyOrderForLeg2);
    if (conservativeToggle) conservativeToggle.checked = Boolean(app.settings.conservativeSteamPrice);
    renderOptimalPairs();
    renderTable();
  }

  return { render };
}
