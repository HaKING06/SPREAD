/**
 * SPREAD (spread.haking.tr) — 2-Leg Trade Desk Calculator View
 */

import { MARKETPLACES, buildImageUrl, steamMarketUrl } from '../core/config.js';
import { clearNode, el } from '../core/security.js';
import { computeLoopMetrics, computeSensitivityMatrix, findOptimalPairs } from '../core/math-engine.js';
import { fmtMoneyFromUsd, fmtMult, fmtPct, fromUsd, getCurrencyMeta, toUsd } from '../core/formatters.js';
import { renderCompoundChart, renderSensitivityHeatmap } from '../charts/canvas-charts.js';

export function initCalculatorView(app) {
  const capInput = document.getElementById('calcCapitalInput');
  const s1Name = document.getElementById('calcLeg1Name');
  const pM1Input = document.getElementById('calcPM1Input');
  const pS1Input = document.getElementById('calcPS1Input');
  const s2Name = document.getElementById('calcLeg2Name');
  const pS2Input = document.getElementById('calcPS2Input');
  const pM2Input = document.getElementById('calcPM2Input');

  const fxSrcInput = document.getElementById('fxQuickAmount');
  const fxFromSel = document.getElementById('fxQuickFrom');
  const fxToSel = document.getElementById('fxQuickTo');
  const fxOutEl = document.getElementById('fxQuickOutput');

  function syncInputsFromSettings() {
    const s = app.settings;
    const fx = app.market.fxRates;
    const cur = s.currency;
    const sym = getCurrencyMeta(cur).symbol;

    document.querySelectorAll('.cur-sym').forEach((node) => {
      node.textContent = sym;
    });

    const mkt = MARKETPLACES[s.marketplace] || MARKETPLACES.CSFLOAT;
    document.querySelectorAll('.mkt-name').forEach((node) => {
      node.textContent = mkt.name;
    });

    capInput.value = fromUsd(s.capitalUsd, cur, fx).toFixed(2);
    s1Name.value = s.leg1.name;
    pM1Input.value = fromUsd(s.leg1.marketUsd, cur, fx).toFixed(2);
    pS1Input.value = fromUsd(s.leg1.steamUsd, cur, fx).toFixed(2);
    s2Name.value = s.leg2.name;
    pS2Input.value = fromUsd(s.leg2.steamUsd, cur, fx).toFixed(2);
    pM2Input.value = fromUsd(s.leg2.marketUsd, cur, fx).toFixed(2);
  }

  function updateSettingsFromInputs() {
    const s = app.settings;
    const fx = app.market.fxRates;
    const cur = s.currency;

    s.capitalUsd = Math.max(0, toUsd(parseFloat(capInput.value) || 0, cur, fx));
    s.leg1.name = s1Name.value.trim() || '1. Yön Eşyası';
    s.leg1.marketUsd = Math.max(0, toUsd(parseFloat(pM1Input.value) || 0, cur, fx));
    s.leg1.steamUsd = Math.max(0, toUsd(parseFloat(pS1Input.value) || 0, cur, fx));
    s.leg2.name = s2Name.value.trim() || '2. Yön Eşyası';
    s.leg2.steamUsd = Math.max(0, toUsd(parseFloat(pS2Input.value) || 0, cur, fx));
    s.leg2.marketUsd = Math.max(0, toUsd(parseFloat(pM2Input.value) || 0, cur, fx));

    app.saveSettings();
    renderMetricsOnly();
  }

  function updateFxBar() {
    if (!fxSrcInput || !fxFromSel || !fxToSel || !fxOutEl) return;
    const amount = Math.max(0, parseFloat(fxSrcInput.value) || 0);
    const fromCur = fxFromSel.value;
    const toCur = fxToSel.value;
    const fx = app.market.fxRates;
    const usdVal = toUsd(amount, fromCur, fx);
    const targetVal = fromUsd(usdVal, toCur, fx);
    const sym = getCurrencyMeta(toCur).symbol;
    fxOutEl.textContent = `${sym}${targetVal.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return { usdVal, targetVal };
  }

  function renderSkinPreview(containerId, itemName, legNum) {
    const box = document.getElementById(containerId);
    if (!box) return;
    clearNode(box);

    const found = app.findItemByName(itemName);
    const mkt = MARKETPLACES[app.settings.marketplace] || MARKETPLACES.CSFLOAT;
    const imgUrl = buildImageUrl(found?.img);
    const rarityColor = found?.rc || '#f0b90b';

    const thumb = el(
      'div',
      { className: 'skin-thumb skin-thumb-lg', style: { '--rarity-color': rarityColor } },
      el('img', { src: imgUrl, alt: itemName })
    );

    const tags = el(
      'div',
      { className: 'leg-preview-tags' },
      found?.w ? el('span', { className: `wear-tag wear-${found.w}` }, found.w) : null,
      found?.c ? el('span', { className: 'pill pill-muted', style: { fontSize: '10px', padding: '1px 6px' } }, found.c) : null,
      found?.q ? el('span', { className: 'num' }, `Derinlik: ${found.q} ilan`) : null,
      found?.cfo && legNum === 2 && app.settings.marketplace === 'CSFLOAT'
        ? el(
            'button',
            {
              type: 'button',
              className: 'pill pill-gold',
              style: { fontSize: '10px', cursor: 'pointer' },
              title: 'CSFloat en yüksek alım emri (anında satış) fiyatını uygula',
              onClick: () => {
                app.settings.leg2.marketUsd = found.cfo;
                app.saveSettings();
                syncInputsFromSettings();
                renderMetricsOnly();
                app.toast(`CSFloat Buy Order fiyatı (${fmtMoneyFromUsd(found.cfo, app.settings.currency, app.market.fxRates)}) uygulandı.`);
              }
            },
            `Buy Order: ${fmtMoneyFromUsd(found.cfo, app.settings.currency, app.market.fxRates)}`
          )
        : null
    );

    const links = el(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '6px', flexShrink: '0' } },
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm',
          onClick: () => app.openCommandPalette(legNum)
        },
        'Değiştir'
      ),
      el(
        'a',
        {
          href: steamMarketUrl(itemName),
          target: '_blank',
          rel: 'noopener noreferrer',
          className: 'btn btn-sm btn-ghost',
          title: 'Steam Topluluk Pazarı'
        },
        'Steam ↗'
      ),
      el(
        'a',
        {
          href: mkt.searchUrl(itemName),
          target: '_blank',
          rel: 'noopener noreferrer',
          className: 'btn btn-sm btn-ghost',
          title: `${mkt.name} Pazar Sayfası`
        },
        `${mkt.shortName} ↗`
      )
    );

    box.appendChild(thumb);
    box.appendChild(
      el(
        'div',
        { className: 'leg-preview-meta' },
        el('div', { className: 'leg-preview-name', title: itemName }, itemName),
        tags
      )
    );
    box.appendChild(links);
  }

  function renderMetricsOnly() {
    const s = app.settings;
    const fx = app.market.fxRates;
    const cur = s.currency;
    const money = (usd, withSign = false, decimals = 2) => fmtMoneyFromUsd(usd, cur, fx, { withSign, decimals });

    const d = computeLoopMetrics({
      capitalUsd: s.capitalUsd,
      pM1Usd: s.leg1.marketUsd,
      pS1Usd: s.leg1.steamUsd,
      pS2Usd: s.leg2.steamUsd,
      pM2Usd: s.leg2.marketUsd,
      buyFeePct: s.buyFeePct,
      sellFeePct: s.sellFeePct,
      withdrawFeePct: s.withdrawFeePct,
      steamFeeMode: s.steamFeeMode,
      steamCustomFeePct: s.steamCustomFeePct
    });

    const c1 = d.firstCycle;

    // Preview wells
    renderSkinPreview('leg1PreviewWell', s.leg1.name, 1);
    renderSkinPreview('leg2PreviewWell', s.leg2.name, 2);

    // Top Hero Strip
    document.getElementById('heroMultVal').textContent = fmtMult(d.mCycle);
    const heroRoiPill = document.getElementById('heroRoiPill');
    heroRoiPill.textContent = `${fmtPct(d.netCycleRoiPct, true)} Teorik`;
    heroRoiPill.className = `pill ${d.netCycleRoiPct >= 0 ? 'pill-mint' : 'pill-crimson'}`;

    const heroNetProfit = document.getElementById('heroRealProfit');
    heroNetProfit.textContent = money(c1.netProfit, true);
    heroNetProfit.className = `metric-cell-val ${c1.netProfit >= 0 ? 'txt-mint' : 'txt-crimson'}`;
    document.getElementById('heroRealSub').textContent =
      `Nakit Eşdeğeri: ${money(c1.cashEquivPortfolio)} (${fmtPct(c1.netRoiPct, true)})`;

    document.getElementById('heroBreakEven').textContent = fmtPct(d.breakEvenLossLimitPct, false);
    const beSub = document.getElementById('heroBreakEvenSub');
    if (d.marginOfSafetyPct >= 0 && d.m1 > 1) {
      beSub.textContent = `Güvenlik Marjı: +${d.marginOfSafetyPct.toFixed(2)} puan`;
      beSub.className = 'metric-cell-sub txt-mint';
    } else {
      beSub.textContent = `Başabaş Aşıldı (${d.marginOfSafetyPct.toFixed(2)} puan)`;
      beSub.className = 'metric-cell-sub txt-crimson';
    }

    const monthlyRoi = (Math.pow(Math.max(0, d.mCycle), 2) - 1) * 100;
    const heroMonthly = document.getElementById('heroMonthlyRoi');
    heroMonthly.textContent = fmtPct(monthlyRoi, true);
    heroMonthly.className = `metric-cell-val ${monthlyRoi >= 0 ? 'txt-gold' : 'txt-crimson'}`;

    // Timeline Strip
    document.getElementById('tlDay0Main').textContent = `${money(c1.spentM1)} (${c1.q1} adet)`;
    document.getElementById('tlDay0Sub').textContent = `Cüzdan kalanı: ${money(c1.cashLeftAfterLeg1)}`;
    document.getElementById('tlDay7Main').textContent = `${money(c1.steamAfterLeg1)} Steam Net`;
    document.getElementById('tlDay7Sub').textContent = `${c1.q2} adet dönüş eşyası • Kalan: ${money(c1.steamWallet)}`;
    const tl14 = document.getElementById('tlDay14Main');
    tl14.textContent = `${money(c1.cashEquivPortfolio)} (${money(c1.netProfit, true)})`;
    tl14.className = `tl-node-main ${c1.netProfit >= 0 ? 'txt-mint' : 'txt-crimson'}`;
    document.getElementById('tlDay14Sub').textContent = `Nakit: ${money(c1.cashWallet)} + Steam(M₂): ${money(c1.steamCashEquiv)}`;

    // Leg 1 Breakdown
    document.getElementById('leg1MultBadge').textContent = `M₁ = ${fmtMult(d.m1)}`;
    document.getElementById('outNetS1').textContent = money(d.netS1, false, 4);
    document.getElementById('outSteamFeeInfo').textContent =
      s.steamFeeMode === 'EXACT_VALVE'
        ? `%${d.exactSteamDetail.effectiveFeePct.toFixed(2)} (${money(d.exactSteamDetail.totalFeeUsd)})`
        : s.steamFeeMode === 'DIV_115'
        ? '%13.04 (÷1.15)'
        : `%${s.steamCustomFeePct.toFixed(2)} (Özel)`;

    document.getElementById('outQ1').textContent = `${c1.q1} adet (Kalan: ${money(c1.cashLeftAfterLeg1)})`;
    document.getElementById('outSteamBal1').textContent = money(c1.steamAfterLeg1);
    const l1Pill = document.getElementById('outLeg1Pct');
    l1Pill.textContent = fmtPct(d.leg1ProfitPct, true);
    l1Pill.className = `pill ${d.leg1ProfitPct >= 0 ? 'pill-mint' : 'pill-crimson'}`;

    // Steam Min-Fee Trap Warning
    const feeTrapBanner = document.getElementById('steamMinFeeBanner');
    if (s.steamFeeMode === 'EXACT_VALVE' && d.pS1Usd > 0 && d.exactSteamDetail.isMinFeeTrap) {
      feeTrapBanner.classList.remove('hidden');
      document.getElementById('steamMinFeeDetail').textContent =
        `Bu fiyat seviyesinde Steam'in minimum $0.01+$0.01 kesinti kuralı efektif komisyonu %${d.exactSteamDetail.effectiveFeePct.toFixed(2)} seviyesine çıkarıyor!`;
    } else {
      feeTrapBanner.classList.add('hidden');
    }

    // Leg 2 Breakdown
    document.getElementById('leg2MultBadge').textContent = `M₂ = ${fmtMult(d.m2)}`;
    document.getElementById('outNetM2').textContent = money(d.netM2, false, 4);
    document.getElementById('outQ2').textContent = `${c1.q2} adet (Steam Kalan: ${money(c1.steamWallet)})`;
    document.getElementById('outCashReturn2').textContent = money(c1.cashReturnM2);

    const lossEl = document.getElementById('outConvLoss');
    if (d.conversionLossPct <= 0) {
      lossEl.textContent = `${fmtPct(Math.abs(d.conversionLossPct), true)} Ek Kâr`;
      lossEl.className = 'pill pill-mint';
    } else {
      lossEl.textContent = `${fmtPct(d.conversionLossPct, false)} Kayıp`;
      lossEl.className =
        d.conversionLossPct <= 10
          ? 'pill pill-mint'
          : d.conversionLossPct <= 15
          ? 'pill pill-amber'
          : 'pill pill-crimson';
    }

    // Insufficient Capital Warning
    const insuffEl = document.getElementById('insuffCapitalBanner');
    if (d.effPM1 > 0 && c1.q1 === 0) {
      insuffEl.classList.remove('hidden');
      document.getElementById('insuffCapitalMsg').textContent =
        `Başlangıç sermayesi (${money(d.capitalUsd)}) 1 adet 1. Yön eşyasını (${money(d.effPM1)}) almaya yetmiyor.`;
    } else {
      insuffEl.classList.add('hidden');
    }

    // Charts
    const compoundCanvas = document.getElementById('compoundChartCanvas');
    const compoundTip = document.getElementById('compoundChartTooltip');
    renderCompoundChart(compoundCanvas, compoundTip, d.realisticCycles, d.capitalUsd, (u) => money(u));

    const heatCanvas = document.getElementById('sensitivityCanvas');
    const heatTip = document.getElementById('sensitivityTooltip');
    const matrix = computeSensitivityMatrix({
      pM1Usd: d.pM1Usd,
      pS1Usd: d.pS1Usd,
      pS2Usd: d.pS2Usd,
      pM2Usd: d.pM2Usd,
      buyFeePct: s.buyFeePct,
      sellFeePct: s.sellFeePct,
      withdrawFeePct: s.withdrawFeePct,
      steamFeeMode: s.steamFeeMode,
      steamCustomFeePct: s.steamCustomFeePct
    });
    renderSensitivityHeatmap(heatCanvas, heatTip, matrix);

    // 12-Cycle Table
    renderCompoundTable(d, money);
    updateFxBar();

    app.latestMetrics = d;
  }

  function renderCompoundTable(d, money) {
    const thead = document.getElementById('compTableHead');
    const tbody = document.getElementById('compTableBody');
    const desc = document.getElementById('compTableDesc');
    clearNode(thead);
    clearNode(tbody);

    if (app.settings.compoundMode === 'REALISTIC') {
      desc.textContent =
        'Tam sayı eşya alımı (Q₁, Q₂), kalan bakiye devri ve Steam bakiyesinin M₂ nakit eşdeğeriyle gerçekçi 12 döngü (168 gün) projeksiyonu.';

      thead.appendChild(
        el(
          'tr',
          null,
          el('th', null, 'Döngü'),
          el('th', null, 'Süre'),
          el('th', { className: 'ta-right' }, '1. Yön (Q₁)'),
          el('th', { className: 'ta-right' }, '2. Yön (Q₂)'),
          el('th', { className: 'ta-right' }, 'Pazar Nakit'),
          el('th', { className: 'ta-right' }, 'Steam Kalan'),
          el('th', { className: 'ta-right' }, 'Nakit Eşdeğeri'),
          el('th', { className: 'ta-right' }, 'Net Kâr & ROI')
        )
      );

      for (const r of d.realisticCycles) {
        const cls = r.netProfit >= 0 ? 'txt-mint' : 'txt-crimson';
        tbody.appendChild(
          el(
            'tr',
            null,
            el('td', { style: { fontWeight: '600' } }, `${r.cycle}. Döngü`),
            el('td', { className: 'txt-sec num' }, `${r.days}g (${r.weeks}hf)`),
            el('td', { className: 'ta-right num' }, `${r.q1} ad`),
            el('td', { className: 'ta-right num' }, `${r.q2} ad`),
            el('td', { className: 'ta-right num' }, money(r.cashWallet)),
            el('td', { className: 'ta-right num txt-ice' }, money(r.steamWallet)),
            el('td', { className: 'ta-right num', style: { fontWeight: '700' } }, money(r.cashEquivPortfolio)),
            el(
              'td',
              { className: `ta-right num ${cls}`, style: { fontWeight: '700' } },
              `${money(r.netProfit, true)} (${fmtPct(r.netRoiPct, true)})`
            )
          )
        );
      }
    } else {
      desc.textContent =
        'Kesintisiz oransal bileşik getiri: Capitalₙ = Capital₀ × (M₁ × M₂)ⁿ teorik üst sınırı.';

      thead.appendChild(
        el(
          'tr',
          null,
          el('th', null, 'Döngü'),
          el('th', null, 'Süre'),
          el('th', { className: 'ta-right' }, 'Bileşik Çarpan (Mⁿ)'),
          el('th', { className: 'ta-right' }, 'Teorik Sermaye'),
          el('th', { className: 'ta-right' }, 'Teorik Net Kâr'),
          el('th', { className: 'ta-right' }, 'Toplam Büyüme %')
        )
      );

      for (const r of d.realisticCycles) {
        const cls = r.theoProfit >= 0 ? 'txt-mint' : 'txt-crimson';
        tbody.appendChild(
          el(
            'tr',
            null,
            el('td', { style: { fontWeight: '600' } }, `${r.cycle}. Döngü`),
            el('td', { className: 'txt-sec num' }, `${r.days}g (${r.weeks}hf)`),
            el('td', { className: 'ta-right num txt-sec' }, fmtMult(r.theoMult)),
            el('td', { className: 'ta-right num', style: { fontWeight: '700' } }, money(r.theoPortfolio)),
            el('td', { className: `ta-right num ${cls}`, style: { fontWeight: '700' } }, money(r.theoProfit, true)),
            el('td', { className: `ta-right num ${cls}` }, fmtPct(r.theoRoiPct, true))
          )
        );
      }
    }
  }

  // Wire input listeners
  [capInput, s1Name, pM1Input, pS1Input, s2Name, pS2Input, pM2Input].forEach((inp) => {
    inp?.addEventListener('input', updateSettingsFromInputs);
  });

  // Compound mode toggle
  document.querySelectorAll('[data-comp-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      app.settings.compoundMode = btn.dataset.compMode;
      app.saveSettings();
      document.querySelectorAll('[data-comp-mode]').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.compMode === app.settings.compoundMode);
      });
      renderMetricsOnly();
    });
  });

  // Auto-fill best live pair
  document.getElementById('autoBestPairBtn')?.addEventListener('click', () => {
    const s = app.settings;
    const pairs = findOptimalPairs(
      app.items,
      {
        marketplace: s.marketplace,
        buyFeePct: s.buyFeePct,
        sellFeePct: s.sellFeePct,
        withdrawFeePct: s.withdrawFeePct,
        steamFeeMode: s.steamFeeMode,
        steamCustomFeePct: s.steamCustomFeePct,
        useBuyOrderForLeg2: s.useBuyOrderForLeg2,
        conservativeSteamPrice: s.conservativeSteamPrice
      },
      s.capitalUsd
    );

    if (pairs.length === 0) {
      app.toast('Mevcut filtrelerde uygun likit çift bulunamadı.', 'warn');
      return;
    }

    const best = pairs[0];
    app.applyPair(best.leg1.item, best.leg2.item, best.leg1.m, best.leg2.m);
  });

  // Set min capital button
  document.getElementById('setMinCapBtn')?.addEventListener('click', () => {
    const eff = app.latestMetrics?.effPM1 || 0;
    if (eff > 0) {
      app.settings.capitalUsd = Math.ceil(eff * 100) / 100;
      app.saveSettings();
      syncInputsFromSettings();
      renderMetricsOnly();
      app.toast('Sermaye 1 adet alış tutarına eşitlendi.');
    }
  });

  // FX Quick Bar
  [fxSrcInput, fxFromSel, fxToSel].forEach((x) => x?.addEventListener('input', updateFxBar));
  [fxFromSel, fxToSel].forEach((x) => x?.addEventListener('change', updateFxBar));

  document.getElementById('fxSendToL1')?.addEventListener('click', () => {
    const res = updateFxBar();
    if (!res || res.usdVal <= 0) {
      app.toast('Önce kur çeviriciye geçerli bir tutar girin.', 'warn');
      return;
    }
    app.settings.leg1.marketUsd = res.usdVal;
    app.saveSettings();
    syncInputsFromSettings();
    renderMetricsOnly();
    app.toast('Kur çevirici tutarı 1. Yön alış fiyatına aktarıldı.');
  });

  document.getElementById('fxSendToL2')?.addEventListener('click', () => {
    const res = updateFxBar();
    if (!res || res.usdVal <= 0) {
      app.toast('Önce kur çeviriciye geçerli bir tutar girin.', 'warn');
      return;
    }
    app.settings.leg2.marketUsd = res.usdVal;
    app.saveSettings();
    syncInputsFromSettings();
    renderMetricsOnly();
    app.toast('Kur çevirici tutarı 2. Yön satış fiyatına aktarıldı.');
  });

  // Track cycle button
  document.getElementById('trackCycleBtn')?.addEventListener('click', () => {
    app.createTrackedCycleFromCalculator();
  });

  // Re-render charts cleanly on resize
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (app.activeTab === 'calculator') renderMetricsOnly();
    }, 150);
  });

  return {
    syncInputsFromSettings,
    render: () => {
      syncInputsFromSettings();
      document.querySelectorAll('[data-comp-mode]').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.compMode === app.settings.compoundMode);
      });
      renderMetricsOnly();
    }
  };
}
