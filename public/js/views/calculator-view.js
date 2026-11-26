/**
 * SPREAD (spread.haking.tr) — 2-Leg Trade Desk Calculator + Smart Capital Advisor View
 */

import { DOPPLER_PHASE_META, MARKETPLACES, STORAGE_KEYS, buildImageUrl, steamMarketUrl } from '../core/config.js';
import { clearNode, el } from '../core/security.js';
import {
  analyzeCapitalStrategies,
  computeLoopMetrics,
  computeSensitivityMatrix,
  computeVelocityProfile,
  diagnoseCurrentSetup,
  estimateExecutionReality,
  findBestExitsForLeg1
} from '../core/math-engine.js';
import {
  computeBasketLoopMetrics,
  computeSinglePairRisk,
  estimateBasketReality,
  evaluateModeArbitration,
  optimizeArbitrageForOwnedLeg1,
  optimizeMultiItemBasket,
  rebalanceBasketLeg,
  runMonteCarloSimulation
} from '../core/basket-optimizer.js';
import { fmtMoneyFromUsd, fmtMult, fmtPct, fromUsd, getCurrencyMeta, toUsd } from '../core/formatters.js';
import { isTr, t } from '../core/i18n.js';
import { renderCompoundChart, renderSensitivityHeatmap } from '../charts/canvas-charts.js';

const CAPITAL_PRESETS_USD = [50, 150, 500, 1500, 5000];

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

  const onboardingEl = document.getElementById('onboardingGuideCard');
  let advisorTimer = null;
  let lastAdvisorResult = null;
  let lastSteamVerifyKey = '';
  let lastAdvisorVerifyKey = '';
  let liveSteamMap = {};

  const advisorFilters = {
    style: 'ALL',      // 'ALL' | 'LOW_QTY' | 'FAST' | 'CASES' | 'PATIENT'
    maxQty: 0,         // 0 (auto) | 5 | 10 | 25 | 50 | 150
    minSpeed: 'FAST',  // 'ULTRA' | 'FAST' | 'MODERATE'
    cleanOnly: true
  };

  // Onboarding visibility state
  function initOnboardingState() {
    try {
      const hidden = localStorage.getItem(STORAGE_KEYS.ONBOARDING_HIDDEN) === '1';
      onboardingEl?.classList.toggle('hidden', hidden);
    } catch {
      // ignore
    }
  }

  document.getElementById('dismissOnboardingBtn')?.addEventListener('click', () => {
    onboardingEl?.classList.add('hidden');
    try {
      localStorage.setItem(STORAGE_KEYS.ONBOARDING_HIDDEN, '1');
    } catch {
      // ignore
    }
  });

  document.getElementById('showGuideQuickBtn')?.addEventListener('click', () => {
    app.switchTab('calculator');
    onboardingEl?.classList.remove('hidden');
    try {
      localStorage.removeItem(STORAGE_KEYS.ONBOARDING_HIDDEN);
    } catch {
      // ignore
    }
    if (app.tour) {
      app.tour.start();
    } else {
      onboardingEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  function renderCapitalPresets() {
    const host = document.getElementById('capitalPresetsRow');
    if (!host) return;
    clearNode(host);
    const cur = app.settings.currency;
    const fx = app.market.fxRates;

    for (const usd of CAPITAL_PRESETS_USD) {
      const isClose = Math.abs(app.settings.capitalUsd - usd) / usd < 0.04;
      host.appendChild(
        el(
          'button',
          {
            type: 'button',
            className: `preset-chip ${isClose ? 'is-active' : ''}`,
            onClick: () => {
              app.settings.capitalUsd = usd;
              app.saveSettings();
              syncInputsFromSettings();
              renderMetricsOnly(true);
              app.toast(
                isTr()
                  ? `Bütçe ${fmtMoneyFromUsd(usd, cur, fx, { decimals: 0 })} olarak ayarlandı — öneriler güncellendi.`
                  : `Budget set to ${fmtMoneyFromUsd(usd, cur, fx, { decimals: 0 })} — strategies updated.`
              );
            }
          },
          fmtMoneyFromUsd(usd, cur, fx, { decimals: 0 })
        )
      );
    }
  }

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
    const feedBadge = document.getElementById('leg1FeedBadge');
    if (feedBadge) {
      const trF = isTr();
      feedBadge.textContent =
        s.marketplace === 'YOUPIN'
          ? trF
            ? 'Youpin898 Canlı • Ask + Buy-Order + Steam 24s'
            : 'Youpin898 Live • Ask + Buy-Order + Steam 24h'
          : trF
            ? 'CSFloat Canlı • Satış Grafiği + Buy-Order'
            : 'CSFloat Live • Sales Graph + Buy-Order';
      feedBadge.className = `pill ${s.marketplace === 'YOUPIN' ? 'pill-gold' : 'pill-ice'} num`;
    }

    capInput.value = fromUsd(s.capitalUsd, cur, fx).toFixed(2);
    s1Name.value = s.leg1.name;
    pM1Input.value = fromUsd(s.leg1.marketUsd, cur, fx).toFixed(2);
    pS1Input.value = fromUsd(s.leg1.steamUsd, cur, fx).toFixed(2);
    s2Name.value = s.leg2.name;
    pS2Input.value = fromUsd(s.leg2.steamUsd, cur, fx).toFixed(2);
    pM2Input.value = fromUsd(s.leg2.marketUsd, cur, fx).toFixed(2);

    const splitToggle = document.getElementById('splitModeToggle');
    const splitSels = document.getElementById('splitModeSelectors');
    const splitBuySel = document.getElementById('splitBuyCountSelect');
    const splitSellSel = document.getElementById('splitSellCountSelect');
    if (splitToggle) splitToggle.checked = Boolean(s.splitMode);
    if (splitSels) splitSels.classList.toggle('hidden', !s.splitMode);
    if (splitBuySel) splitBuySel.value = String(Number(s.splitBuyCount) || 0);
    if (splitSellSel) splitSellSel.value = String(Number(s.splitSellCount) || 0);

    renderCapitalPresets();
  }

  function updateSettingsFromInputs() {
    const s = app.settings;
    const fx = app.market.fxRates;
    const cur = s.currency;

    s.capitalUsd = Math.max(0, toUsd(parseFloat(capInput.value) || 0, cur, fx));
    s.leg1.name = s1Name.value.trim() || (isTr() ? '1. Adım Eşyası' : 'Step 1 Item');
    s.leg1.marketUsd = Math.max(0, toUsd(parseFloat(pM1Input.value) || 0, cur, fx));
    s.leg1.steamUsd = Math.max(0, toUsd(parseFloat(pS1Input.value) || 0, cur, fx));
    s.leg2.name = s2Name.value.trim() || (isTr() ? '2. Adım Eşyası' : 'Step 2 Item');
    s.leg2.steamUsd = Math.max(0, toUsd(parseFloat(pS2Input.value) || 0, cur, fx));
    s.leg2.marketUsd = Math.max(0, toUsd(parseFloat(pM2Input.value) || 0, cur, fx));

    app.saveSettings();
    renderCapitalPresets();
    renderMetricsOnly(false);

    // Debounce heavy 4,500-item strategy advisor re-scan when typing fast
    clearTimeout(advisorTimer);
    advisorTimer = setTimeout(() => {
      renderAdvisorSection();
    }, 180);
  }

  function updateFxBar() {
    if (!fxSrcInput || !fxFromSel || !fxToSel || !fxOutEl) return null;
    const amount = Math.max(0, parseFloat(fxSrcInput.value) || 0);
    const fromCur = fxFromSel.value;
    const toCur = fxToSel.value;
    const fx = app.market.fxRates;
    const usdVal = toUsd(amount, fromCur, fx);
    const targetVal = fromUsd(usdVal, toCur, fx);
    const sym = getCurrencyMeta(toCur).symbol;
    fxOutEl.textContent = `${sym}${targetVal.toLocaleString(isTr() ? 'tr-TR' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return { usdVal, targetVal };
  }

  function formatSaleAge(ageHours, tr) {
    const h = Math.max(0, Number(ageHours) || 0);
    if (h < 1) return tr ? '<1s' : '<1h';
    if (h < 48) return tr ? `${Math.round(h)}s` : `${Math.round(h)}h`;
    const d = Math.round(h / 24);
    return tr ? `${d}g` : `${d}d`;
  }

  /**
   * V11.1 Unified Self-Consistent Steam Telemetry Resolver:
   * - Never overwrites verified snapshot 7d/30d history with 0 when Edge HTML fetch returns histLive=false!
   * - Never contradicts the recent sales tape (enforces st24 >= tape24, st7 >= max(tape7, st24), st30 >= max(tape30, st7))!
   * - Computes live relative age from the actual transaction UNIX timestamp.
   */
  function resolveSteamTelemetry(found, liveRec) {
    const useLiveHist =
      Boolean(liveRec?.histLive) &&
      (Number(liveRec.sold30d) > 0 || (Array.isArray(liveRec.recentSales) && liveRec.recentSales.length > 0));
    const stSales = useLiveHist && Array.isArray(liveRec.recentSales) && liveRec.recentSales.length
      ? liveRec.recentSales
      : Array.isArray(found?.stSales)
        ? found.stSales
        : [];
    const stHist = useLiveHist || Boolean(found?.stHist) || stSales.length > 0;

    const nowSec = Math.floor(Date.now() / 1000);
    let tape24 = 0;
    let tape7 = 0;
    let tape30 = 0;
    for (const r of stSales) {
      const tSec = Number(r?.t) || 0;
      const qRow = Math.max(1, Number(r?.q) || 1);
      if (tSec >= nowSec - 86400) tape24 += qRow;
      if (tSec >= nowSec - 7 * 86400) tape7 += qRow;
      if (tSec >= nowSec - 30 * 86400) tape30 += qRow;
    }

    const liveHas24 = Boolean(liveRec?.sold24hChecked) && Number.isFinite(Number(liveRec?.volume24h));
    const st24Checked = useLiveHist || liveHas24 || Boolean(found?.st24Checked) || stHist;
    let st24Val = 0;
    if (useLiveHist) {
      st24Val = Math.max(Number(liveRec.volume24h) || 0, tape24);
    } else if (liveHas24) {
      const lv = Number(liveRec.volume24h) || 0;
      const fv = Number(found?.st24) || 0;
      st24Val = lv > 0 ? Math.max(lv, tape24) : tape24 > 0 ? Math.max(fv, tape24) : 0;
    } else if (st24Checked) {
      st24Val = Math.max(Number(found?.st24) || 0, tape24);
    }

    const raw7 = useLiveHist ? Number(liveRec.sold7d) || 0 : Number(found?.st7) || 0;
    const raw30 = useLiveHist ? Number(liveRec.sold30d) || 0 : Number(found?.st30) || 0;
    const st7Val = stHist ? Math.max(raw7, tape7, st24Val) : 0;
    const st30Val = stHist ? Math.max(raw30, tape30, st7Val) : 0;

    const lastEntry = stSales.length > 0 ? stSales[stSales.length - 1] : null;
    const stLastVal =
      (useLiveHist ? Number(liveRec.lastSaleUsd) || 0 : Number(found?.stLast) || 0) ||
      (lastEntry ? Number(lastEntry.p) || 0 : 0);
    const stLastHVal =
      lastEntry && Number(lastEntry.t) > 0
        ? Math.max(0, (nowSec - Number(lastEntry.t)) / 3600)
        : useLiveHist
          ? Number(liveRec.lastSaleAgeH) || 0
          : Number(found?.stLastH) || 0;

    const stAvg7Val = useLiveHist ? Number(liveRec.avg7Usd) || 0 : Number(found?.stAvg7) || 0;
    const stBuyOrd = Number(liveRec?.steamBuyOrderUsd || found?.stBuyOrd) || 0;
    const stSellOrd = Number(liveRec?.steamSellOrderUsd || liveRec?.lowestUsd || found?.stSellOrd) || 0;
    const stSellCnt = Number(liveRec?.steamSellCount || found?.stSellCnt) || 0;
    const stMed = Number(liveRec?.medianUsd || found?.stMed) || 0;
    const steamAskVal = stSellOrd > 0 ? stSellOrd : Number(found?.s) || 0;
    let stRealVal = useLiveHist ? Number(liveRec.realisticSellUsd) || 0 : Number(found?.stReal) || 0;
    if (stRealVal > 0 && steamAskVal > 0 && stRealVal > steamAskVal) {
      stRealVal = Math.round(steamAskVal * 100) / 100;
    }
    const askGapPct = stHist && stRealVal > 0 && steamAskVal > stRealVal ? ((steamAskVal - stRealVal) / stRealVal) * 100 : 0;

    return {
      stHist,
      st24Checked,
      st24Val,
      st7Val,
      st30Val,
      stLastVal,
      stLastHVal,
      stAvg7Val,
      stRealVal,
      stBuyOrd,
      stSellOrd,
      stSellCnt,
      stMed,
      steamAskVal,
      askGapPct,
      stSales
    };
  }

  function renderRecentSteamSalesTape(st7, st30, stAvg7, stSales, money, tr, onPickPrice) {
    if (!Array.isArray(stSales) || stSales.length === 0) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    const chips = stSales.slice(-4).map((entry, idx, arr) => {
      const p = Number(entry?.p) || 0;
      const q = Math.max(1, Number(entry?.q) || 1);
      const tSec = Number(entry?.t) || 0;
      const ageH = tSec > 0 ? Math.max(0, (nowSec - tSec) / 3600) : 0;
      const isLatest = idx === arr.length - 1;
      const ageTxt = ageH > 0 ? ` · ${formatSaleAge(ageH, tr)}` : '';
      return el(
        'button',
        {
          type: 'button',
          className: `steam-sale-chip ${isLatest ? 'is-latest' : ''}`,
          title: tr
            ? `Gerçekleşen Steam satışı: ${money(p)} (${q} adet, ~${formatSaleAge(ageH, true)} önce) — tıklayıp 1. adım fiyatına uygula`
            : `Actual Steam sale: ${money(p)} (${q} sold, ~${formatSaleAge(ageH, false)} ago) — click to apply to Step 1`,
          onClick: () => onPickPrice(p, tr ? 'Seçilen Steam satış fiyatı' : 'Selected Steam sale price')
        },
        `${money(p)}${q > 1 ? ` ×${q}` : ''}${ageTxt}`
      );
    });
    const avgPart = stAvg7 > 0 ? ` • ${tr ? '7g Ort' : '7d Avg'}: ${money(stAvg7)}` : '';
    return el(
      'div',
      { className: 'steam-sales-tape num' },
      el(
        'strong',
        null,
        tr
          ? `📊 Son Steam Satışları (7g: ${st7} • 30g: ${st30}${avgPart}):`
          : `📊 Recent Steam Sales (7d: ${st7} • 30d: ${st30}${avgPart}):`
      ),
      chips
    );
  }

  function renderLeg1SteamDeck(st, found, activeSteamUsd, money, tr, onApply) {
    const presetBtns = [];
    const isSel = (v) => v > 0 && Math.abs((Number(activeSteamUsd) || 0) - v) <= 0.025;

    if (st.stHist && st.stRealVal > 0) {
      const active = isSel(st.stRealVal);
      presetBtns.push(
        el(
          'button',
          {
            type: 'button',
            className: `steam-preset-btn pill-mint ${active ? 'is-selected' : ''}`,
            title: tr
              ? `Gerçek son satış + 7g ağırlıklı ortalamaya göre makul Steam satış fiyatı${st.stAvg7Val > 0 ? ` (7g ort: ${money(st.stAvg7Val)})` : ''} — tıklayıp uygula`
              : `Realistic Steam clearing price blended from last actual sale & 7d weighted avg${st.stAvg7Val > 0 ? ` (7d avg: ${money(st.stAvg7Val)})` : ''} — click to apply`,
            onClick: () => onApply(st.stRealVal, tr ? 'Gerçekçi Steam satış fiyatı' : 'Realistic Steam clearing price')
          },
          `${active ? '✓ ' : ''}${tr ? 'Gerçekçi Satış' : 'Realistic Sell'}: ${money(st.stRealVal)}`
        )
      );
    }

    if (st.stHist && st.stLastVal > 0) {
      const active = isSel(st.stLastVal);
      presetBtns.push(
        el(
          'button',
          {
            type: 'button',
            className: `steam-preset-btn pill-ice ${active ? 'is-selected' : ''}`,
            title: tr
              ? `Steam'de gerçekleşen en son satış (${st.stLastHVal > 0 ? `~${formatSaleAge(st.stLastHVal, true)} önce` : 'güncel'}) — tıklayıp uygula`
              : `Last actual sale on Steam (${st.stLastHVal > 0 ? `~${formatSaleAge(st.stLastHVal, false)} ago` : 'recent'}) — click to apply`,
            onClick: () => onApply(st.stLastVal, tr ? 'Son Steam satış fiyatı' : 'Last Steam sale price')
          },
          `${active ? '✓ ' : ''}${tr ? 'Son Satış' : 'Last Sale'}: ${money(st.stLastVal)}`
        )
      );
    }

    if (st.stHist && st.steamAskVal > 0 && Math.abs(st.steamAskVal - st.stRealVal) >= 0.25) {
      const active = isSel(st.steamAskVal);
      presetBtns.push(
        el(
          'button',
          {
            type: 'button',
            className: `steam-preset-btn ${st.askGapPct >= 5 ? 'pill-amber' : 'pill-muted'} ${active ? 'is-selected' : ''}`,
            title: tr
              ? `Steam'deki aktif en düşük satış ilanı (${st.askGapPct >= 4 ? `gerçekçi satışın +%${st.askGapPct.toFixed(1)} üstünde, satılması uzun sürebilir` : 'son satışlara yakın'})`
              : `Lowest active Steam sell listing (${st.askGapPct >= 4 ? `+${st.askGapPct.toFixed(1)}% above realistic sell, may sit unsold` : 'close to recent sales'})`,
            onClick: () => onApply(st.steamAskVal, tr ? 'Steam en düşük ilan fiyatı' : 'Steam lowest ask price')
          },
          `${active ? '✓ ' : ''}${tr ? 'En Düşük İlan' : 'Lowest Ask'}: ${money(st.steamAskVal)}${st.askGapPct >= 4 ? ` (+${tr ? '%' : ''}${st.askGapPct.toFixed(1)}${tr ? '' : '%'})` : ''}`
        )
      );
    } else if (!st.stHist && found?.sEst && st.stSellOrd > 0) {
      const active = isSel(st.stSellOrd);
      presetBtns.push(
        el(
          'button',
          {
            type: 'button',
            className: `steam-preset-btn pill-mint ${active ? 'is-selected' : ''}`,
            title: tr
              ? 'Steam canlı en düşük satış ilanı fiyatını uygula (itemordershistogram)'
              : 'Apply live Steam lowest sell listing price (itemordershistogram)',
            onClick: () => onApply(st.stSellOrd, tr ? 'Canlı Steam en düşük ilan fiyatı' : 'Live Steam lowest ask')
          },
          `${active ? '✓ ' : ''}${tr ? 'Canlı Steam Ask' : 'Live Steam Ask'}: ${money(st.stSellOrd)}`
        )
      );
    }

    if (st.stBuyOrd > 0) {
      const active = isSel(st.stBuyOrd);
      presetBtns.push(
        el(
          'button',
          {
            type: 'button',
            className: `steam-preset-btn pill-gold ${active ? 'is-selected' : ''}`,
            title: tr
              ? 'Steam en yüksek alım emri (0 saniyede anında Steam satışı testi için tıkla)'
              : 'Live Steam highest buy order (click to test 0-second instant Steam sell)',
            onClick: () => onApply(st.stBuyOrd, tr ? 'Steam anında alım emri' : 'Steam instant buy order')
          },
          `${active ? '✓ ' : ''}${tr ? 'Steam Anında Sat' : 'Steam Instant'}: ${money(st.stBuyOrd)}`
        )
      );
    }

    if (!st.stHist && st.stMed > 0 && st.stMed < (Number(activeSteamUsd) || 0) * 0.96) {
      const active = isSel(st.stMed);
      presetBtns.push(
        el(
          'button',
          {
            type: 'button',
            className: `steam-preset-btn pill-amber ${active ? 'is-selected' : ''}`,
            title: tr
              ? 'Son 24 saatte gerçekleşen medyan Steam satış fiyatını uygula (daha hızlı satış testi)'
              : 'Apply actual 24h Steam median sold price (realistic fast-sell check)',
            onClick: () => onApply(st.stMed, tr ? 'Steam hızlı satış medyanı' : 'Steam fast-sell median')
          },
          `${active ? '✓ ' : ''}${tr ? 'Steam Medyan' : 'Steam Median'}: ${money(st.stMed)}`
        )
      );
    }

    const salesTape =
      st.stHist && st.stSales.length > 0
        ? renderRecentSteamSalesTape(st.st7Val, st.st30Val, st.stAvg7Val, st.stSales, money, tr, onApply)
        : null;

    if (presetBtns.length === 0 && !salesTape) return null;

    return el(
      'div',
      { className: 'leg-steam-deck' },
      presetBtns.length > 0 ? el('div', { className: 'steam-presets-row' }, presetBtns) : null,
      salesTape
    );
  }

  function renderSkinPreview(containerId, itemName, legNum) {
    const box = document.getElementById(containerId);
    if (!box) return;
    clearNode(box);

    const isYoupin = app.settings.marketplace === 'YOUPIN';
    const found = app.findItemByName(itemName);
    const vel = computeVelocityProfile(found, app.settings.marketplace, legNum);
    const liveSteam = liveSteamMap[`${app.settings.marketplace}:${itemName}`];
    const mkt = MARKETPLACES[app.settings.marketplace] || MARKETPLACES.CSFLOAT;
    const imgUrl = buildImageUrl(found?.img);
    const rarityColor = found?.rc || '#f0b90b';

    const thumb = el(
      'div',
      { className: 'skin-thumb skin-thumb-lg', style: { '--rarity-color': rarityColor } },
      el('img', { src: imgUrl, alt: itemName })
    );

    const tr = isTr();
    const cur = app.settings.currency;
    const fx = app.market.fxRates;
    const money = (u) => fmtMoneyFromUsd(u, cur, fx);

    const st = resolveSteamTelemetry(found, liveSteam);
    const instantCashoutUsd = isYoupin ? Number(found?.ypo) || 0 : Number(found?.cfo) || 0;

    const applyLeg1SteamPrice = (usdVal, labelTxt) => {
      if (!(usdVal > 0)) return;
      app.settings.leg1.steamUsd = Math.round(usdVal * 100) / 100;
      app.saveSettings();
      syncInputsFromSettings();
      renderMetricsOnly(true);
      app.toast(tr ? `${labelTxt} (${money(usdVal)}) uygulandı.` : `Applied ${labelTxt} (${money(usdVal)}).`);
    };

    // V11.1 DIRECTIONAL TELEMETRY:
    //   - Leg 1 (Sell on STEAM): REAL self-consistent Steam 7d/30d/24h sales history + full-width price preset bar & recent sales tape!
    //   - Leg 2 (Sell on CSFloat/Youpin): REAL CSFloat 24h/7d OR Youpin Bid/Ask + P2P 24h/7d + 1-click Cashout Bid + Steam Buy-Order Discount!
    let primaryVolChip = null;
    if (legNum === 1) {
      if (st.stHist) {
        const cls = st.st7Val >= 25 ? 'pill-mint' : st.st7Val >= 6 ? 'pill-ice' : 'pill-amber';
        primaryVolChip = el(
          'span',
          {
            className: `pill ${cls}`,
            style: { fontSize: '10px', padding: '1px 6px' },
            title: tr
              ? `Steam'in GERÇEK aşınma-eşleşmeli satış grafiği: 7 günde ${st.st7Val}, 30 günde ${st.st30Val}, son 24 saatte ${st.st24Val} adet satıldı.${st.stAvg7Val > 0 ? ` 7g ort: ${money(st.stAvg7Val)}` : ''}`
              : `REAL wear-matched Steam sales history: ${st.st7Val} sold in 7d, ${st.st30Val} in 30d, ${st.st24Val} in 24h.${st.stAvg7Val > 0 ? ` 7d avg: ${money(st.stAvg7Val)}` : ''}`
          },
          `${st.st7Val <= 4 ? '⚠ ' : ''}${tr
            ? `Steam 7g: ${st.st7Val.toLocaleString('tr-TR')} satış • 30g: ${st.st30Val.toLocaleString('tr-TR')} • 24s: ${st.st24Val}`
            : `Steam 7d: ${st.st7Val.toLocaleString('en-US')} sold • 30d: ${st.st30Val.toLocaleString('en-US')} • 24h: ${st.st24Val}`}`
        );
      } else if (st.st24Checked) {
        const cls = st.st24Val >= 15 ? 'pill-mint' : st.st24Val >= 3 ? 'pill-ice' : 'pill-amber';
        primaryVolChip = el(
          'span',
          {
            className: `pill ${cls}`,
            style: { fontSize: '10px', padding: '1px 6px' },
            title: tr
              ? `1. Adımda Steam'de satacağın için GERÇEK canlı Steam 24s satış adedi ve aktif Steam ilan sayısı gösterilir${st.stMed > 0 ? ` (Medyan: ${money(st.stMed)})` : ''}.`
              : `Because Step 1 sells on Steam, this shows REAL live Steam 24h sold count & active Steam sell listings${st.stMed > 0 ? ` (Median: ${money(st.stMed)})` : ''}.`
          },
          `${st.st24Val === 0 ? '⚠ ' : ''}${tr ? `Steam 24s: ${st.st24Val.toLocaleString('tr-TR')} satış` : `Steam 24h: ${st.st24Val.toLocaleString('en-US')} sold`}${st.stSellCnt > 0 ? ` • ${st.stSellCnt.toLocaleString(tr ? 'tr-TR' : 'en-US')} ${tr ? 'ilan' : 'listed'}` : ''}`
        );
      } else if (found) {
        primaryVolChip = el(
          'span',
          {
            className: `pill ${vel.pillCls}`,
            style: { fontSize: '10px', padding: '1px 6px' },
            title: tr ? 'Gerçek Steam 7g/30g satış geçmişi çekiliyor...' : 'Fetching real Steam 7d/30d sales history...'
          },
          `${vel.shortLabel} • ${vel.volText}`
        );
      }
    } else {
      const liveCf = !isYoupin && liveSteam?.csfloat?.live ? liveSteam.csfloat : null;
      if (liveCf) {
        primaryVolChip = el(
          'span',
          {
            className: `pill ${liveCf.sold7d >= 40 ? 'pill-mint' : liveCf.sold7d >= 12 ? 'pill-ice' : 'pill-amber'}`,
            style: { fontSize: '10px', padding: '1px 6px' },
            title: tr
              ? `2. Adımda CSFloat'ta satacağın için GERÇEK canlı CSFloat satış geçmişi (24s: ${liveCf.sold24h} • 7g: ${liveCf.sold7d} • 30g: ${liveCf.sold30d})`
              : `Because Step 2 sells on CSFloat, this shows REAL live CSFloat sales history (24h: ${liveCf.sold24h} • 7d: ${liveCf.sold7d} • 30d: ${liveCf.sold30d})`
          },
          `CSFloat • ${tr ? `24s: ${liveCf.sold24h} • 7g: ${liveCf.sold7d} satış` : `24h: ${liveCf.sold24h} • 7d: ${liveCf.sold7d} sold`}`
        );
      } else if (found) {
        primaryVolChip = el(
          'span',
          {
            className: `pill ${vel.pillCls}`,
            style: { fontSize: '10px', padding: '1px 6px' },
            title: isYoupin
              ? tr
                ? `2. Adım Youpin898 nakit dönüşü: canlı Youpin Ask/Buy-Order sıkılığı (%${vel.bidAskPct.toFixed(1)}) + küresel P2P 24s/7g satış temposu. Sıfır bekleme için Anında Sat fiyatını baz alın.`
                : `Step 2 Youpin898 cashout: live Youpin Ask/Buy-Order tightness (${vel.bidAskPct.toFixed(1)}%) + global P2P 24h/7d sales pace. Use Instant Bid for 0-wait cashout.`
              : tr
                ? 'Canlı CSFloat 24s/7g satış geçmişi yükleniyor...'
                : 'Loading live CSFloat 24h/7d sales history...'
          },
          `${vel.shortLabel} • ${vel.volText}`
        );
      }
    }

    const buySupplyChip =
      legNum === 1 && found
        ? !isYoupin && found.q > 0
          ? el(
            'span',
            { className: 'txt-muted num', title: tr ? 'CSFloat alış tarafındaki aktif ilan stoğu' : 'Active supply available to buy on CSFloat' },
            `${tr ? 'Alış stoğu' : 'Buy supply'}: ${found.q} ${tr ? 'ilan' : 'listed'}`
          )
          : isYoupin && vel.bidAskPct > 0
            ? el(
              'span',
              { className: 'txt-muted num', title: tr ? 'Youpin898 canlı Ask / Buy-Order oranı' : 'Live Youpin898 Ask / Buy-Order ratio' },
              `YP Bid ${tr ? '%' : ''}${vel.bidAskPct.toFixed(1)}${tr ? '' : '%'}`
            )
            : null
        : null;

    const phMeta = found?.ph ? DOPPLER_PHASE_META[found.ph] : null;

    const tags = el(
      'div',
      { className: 'leg-preview-tags' },
      found?.w ? el('span', { className: `wear-tag wear-${found.w}` }, found.w) : null,
      phMeta ? el('span', { className: `phase-tag ${phMeta.cls}` }, found.ph) : null,
      primaryVolChip,
      buySupplyChip,
      found?.isGem || found?.phPrem
        ? el(
          'span',
          {
            className: 'pill pill-amber',
            style: { fontSize: '10px', padding: '1px 6px' },
            title: tr
              ? 'Steam Pazarı Doppler fazlarını/gemleri (Ruby, Sapphire, Emerald, Black Pearl, Phase 2) ayrı fiyatlamaz; P2P nakit pazarında satmak genelde Steam arbitrajından çok daha kârlıdır.'
              : 'Steam Market does not separate Doppler phases/gems (Ruby, Sapphire, Emerald, Black Pearl, Phase 2); direct P2P cash sale usually beats Steam.'
          },
          found.isGem
            ? tr
              ? `💎 ${found.ph} Gem • Steam Faz Fiyatlamaz`
              : `💎 ${found.ph} Gem • No Steam Overpay`
            : tr
              ? `⚠ ${found.ph} Overpay • Steam Taban Fiyatı`
              : `⚠ ${found.ph} Overpay • Base Steam Floor`
        )
        : null,
      found?.sEst && legNum === 1 && !st.stHist && st.stSellOrd <= 0
        ? el(
          'span',
          {
            className: 'pill pill-amber',
            style: { fontSize: '10px', padding: '1px 6px' },
            title: tr
              ? 'Bu nadir skin için son Steam satış verisi boş — Steam satış fiyatını kontrol edip manuel güncelleyebilirsiniz.'
              : 'No recent Steam sale record for this rare skin — verify & edit the Steam sell price manually.'
          },
          tr ? '⚠ Tahmini Steam Fiyatı' : '⚠ Est. Steam Price'
        )
        : null
    );

    let bottomDeck = null;
    if (legNum === 1) {
      bottomDeck = renderLeg1SteamDeck(st, found, app.settings.leg1.steamUsd, money, tr, applyLeg1SteamPrice);
    } else {
      const l2Btns = [];
      if (st.stBuyOrd > 0 && st.stBuyOrd < app.settings.leg2.steamUsd * 0.985) {
        l2Btns.push(
          el(
            'button',
            {
              type: 'button',
              className: 'steam-preset-btn pill-ice',
              title: tr
                ? '2. adımda Steam ilanı yerine Buy Order (alım emri) ile daha ucuza alma senaryosunu test et'
                : 'Test buying Leg 2 cheaper via Steam Buy Order instead of paying instant ask',
              onClick: () => {
                const bidBuy = Math.round((st.stBuyOrd + 0.01) * 100) / 100;
                app.settings.leg2.steamUsd = bidBuy;
                app.saveSettings();
                syncInputsFromSettings();
                renderMetricsOnly(true);
                app.toast(
                  isTr()
                    ? `Steam Emirle Al fiyatı (${money(bidBuy)}) uygulandı.`
                    : `Applied Steam Buy-Order purchase price (${money(bidBuy)}).`
                );
              }
            },
            `${tr ? 'Steam Emirle Al' : 'Steam Buy Order'}: ${money(st.stBuyOrd)}`
          )
        );
      }
      if (instantCashoutUsd > 0) {
        const activeBid = Math.abs(app.settings.leg2.marketUsd - instantCashoutUsd) <= 0.025;
        l2Btns.push(
          el(
            'button',
            {
              type: 'button',
              className: `steam-preset-btn pill-gold ${activeBid ? 'is-selected' : ''}`,
              title: tr
                ? `${mkt.name} en yüksek alım emri (anında satış) fiyatını uygula`
                : `Apply ${mkt.name} highest buy order (instant sell) price`,
              onClick: () => {
                app.settings.leg2.marketUsd = instantCashoutUsd;
                app.saveSettings();
                syncInputsFromSettings();
                renderMetricsOnly(true);
                app.toast(
                  isTr()
                    ? `${mkt.name} anında satış fiyatı (${money(instantCashoutUsd)}) uygulandı.`
                    : `Applied ${mkt.name} instant buy order (${money(instantCashoutUsd)}).`
                );
              }
            },
            `${activeBid ? '✓ ' : ''}${mkt.shortName} ${tr ? 'Anında Sat' : 'Instant Bid'}: ${money(instantCashoutUsd)}`
          )
        );
      }
      if (l2Btns.length > 0) {
        bottomDeck = el('div', { className: 'leg-steam-deck' }, el('div', { className: 'steam-presets-row' }, l2Btns));
      }
    }

    const links = el(
      'div',
      { className: 'leg-preview-actions' },
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm',
          onClick: () => app.openCommandPalette(legNum)
        },
        t('leg.change')
      ),
      el(
        'a',
        {
          href: steamMarketUrl(itemName, found),
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
          href: mkt.searchUrl(itemName, found),
          target: '_blank',
          rel: 'noopener noreferrer',
          className: 'btn btn-sm btn-ghost',
          title: `${mkt.name} Pazar Sayfası`
        },
        `${mkt.shortName} ↗`
      )
    );

    box.appendChild(
      el(
        'div',
        { className: 'leg-preview-top' },
        thumb,
        el(
          'div',
          { className: 'leg-preview-meta' },
          el('div', { className: 'leg-preview-name', title: itemName }, itemName),
          tags
        ),
        links
      )
    );
    if (bottomDeck) box.appendChild(bottomDeck);
  }

  /**
   * Renders the compact 1-click Pareto-Optimal Leg 2 Exit Switcher directly inside the Leg 2 panel
   */
  function renderLeg2SmartExits(item1Obj) {
    const host = document.getElementById('leg2SmartExitsBar');
    if (!host) return;
    clearNode(host);

    const s = app.settings;
    if (!app.items || app.items.length === 0 || s.leg1.marketUsd <= 0 || s.leg1.steamUsd <= 0) {
      host.classList.add('hidden');
      return;
    }

    const exits = findBestExitsForLeg1(
      app.items,
      {
        item: item1Obj,
        name: s.leg1.name,
        pM1Usd: s.leg1.marketUsd,
        pS1Usd: s.leg1.steamUsd
      },
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
      s.capitalUsd,
      3
    );

    if (exits.length === 0) {
      host.classList.add('hidden');
      return;
    }

    host.classList.remove('hidden');
    const tr = isTr();
    const cur = s.currency;
    const fx = app.market.fxRates;
    const money = (u, sign = false) => fmtMoneyFromUsd(u, cur, fx, { withSign: sign, decimals: 0 });

    host.appendChild(
      el(
        'div',
        { className: 'smart-exits-label' },
        tr
          ? '⚡ Bu 1. Yön için En İyi 2. Yön Seçenekleri (Tek Tıkla Değiştir):'
          : '⚡ Best Step 2 Cashout Exits for Current Step 1 (1-Click Swap):'
      )
    );

    const row = el('div', { className: 'smart-exits-row' });
    const curL2Lower = (s.leg2.name || '').toLowerCase();

    for (const ex of exits) {
      const isAct = ex.item.n.toLowerCase() === curL2Lower;
      const shortName = ex.item.n
        .replace(' (Factory New)', ' (FN)')
        .replace(' (Minimal Wear)', ' (MW)')
        .replace(' (Field-Tested)', ' (FT)')
        .replace(' (Well-Worn)', ' (WW)')
        .replace(' (Battle-Scarred)', ' (BS)');

      row.appendChild(
        el(
          'button',
          {
            type: 'button',
            className: `smart-exit-chip ${isAct ? 'is-active' : ''}`,
            title: tr
              ? `${ex.item.n} • ${ex.vel.shortLabel} (7g: ${ex.vel.sold7d} satış) • ~${ex.reality.minDays}–${ex.reality.maxDays}G • Anında Taban: ${money(ex.instantFloorProfit, true)}`
              : `${ex.item.n} • ${ex.vel.shortLabel} (7d: ${ex.vel.sold7d} sold) • ~${ex.reality.minDays}–${ex.reality.maxDays}D • Instant Floor: ${money(ex.instantFloorProfit, true)}`,
            onClick: () => {
              app.settings.leg2.name = ex.item.n;
              app.settings.leg2.steamUsd = ex.m.steamUsd;
              app.settings.leg2.marketUsd = ex.m.marketSellUsd;
              app.saveSettings();
              syncInputsFromSettings();
              renderMetricsOnly(true);
              app.toast(
                isTr()
                  ? `2. Yön güncellendi: ${ex.c1.q2}x ${ex.item.n} (${fmtMoneyFromUsd(ex.c1.netProfit, cur, fx, { withSign: true })})`
                  : `Step 2 swapped: ${ex.c1.q2}x ${ex.item.n} (${fmtMoneyFromUsd(ex.c1.netProfit, cur, fx, { withSign: true })})`
              );
            }
          },
          el('span', { className: `vel-dot is-${ex.vel.tier}` }),
          el('span', { className: 'smart-exit-name' }, `${ex.c1.q2}x ${shortName}`),
          el(
            'span',
            { className: `num ${ex.c1.netProfit >= 0 ? 'txt-mint' : 'txt-crimson'}`, style: { fontWeight: '700' } },
            money(ex.c1.netProfit, true)
          ),
          el(
            'span',
            { className: 'txt-muted num', style: { fontSize: '10px' } },
            tr ? `7g:${ex.vel.sold7d}` : `7d:${ex.vel.sold7d}`
          )
        )
      );
    }
    host.appendChild(row);
  }

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

  /**
   * Renders V7 500-Scenario Monte Carlo Telemetry Strip (Risk Grade, PoP, EV, CVaR 5% + Warnings)
   */
  function renderMonteCarloStrip(mc, money, tr) {
    if (!mc) return null;
    const cvarCls =
      mc.cvar5ProfitUsd >= 0
        ? 'txt-mint'
        : mc.cvar5ProfitUsd >= -(app.settings.capitalUsd * 0.03)
          ? 'txt-gold'
          : 'txt-crimson';

    const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    wrap.appendChild(
      el(
        'div',
        { className: 'mc-telemetry-bar' },
        el(
          'div',
          { className: 'mc-cell' },
          el('span', { className: 'mc-cell-lbl' }, tr ? 'V11 Risk Notu' : 'V11 Risk Grade'),
          el(
            'span',
            { className: 'mc-cell-val', style: { display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' } },
            el('span', { className: `pill ${mc.riskCls}`, style: { padding: '0 6px', fontSize: '10.5px' } }, mc.riskGrade),
            el('span', { style: { fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' } }, mc.riskLabel)
          )
        ),
        el(
          'div',
          { className: 'mc-cell' },
          el('span', { className: 'mc-cell-lbl' }, tr ? '500 Sim. Kâr Olasılığı' : '500-Sim Profit Prob'),
          el(
            'span',
            { className: `mc-cell-val ${mc.popPct >= 90 ? 'txt-mint' : mc.popPct >= 75 ? 'txt-gold' : 'txt-amber'}` },
            `${tr ? '%' : ''}${mc.popPct.toFixed(1)}${tr ? '' : '%'}${mc.kellyPct < 95 ? ` • Kelly ${tr ? '%' : ''}${mc.kellyPct}${tr ? '' : '%'}` : ''}`
          )
        ),
        el(
          'div',
          { className: 'mc-cell' },
          el('span', { className: 'mc-cell-lbl' }, tr ? 'Beklenen Değer (EV)' : 'Expected Value (EV)'),
          el(
            'span',
            { className: `mc-cell-val ${mc.evProfitUsd >= 0 ? 'txt-mint' : 'txt-crimson'}` },
            `${money(mc.evProfitUsd, true)} (${fmtPct(mc.evRoiPct, true)})`
          )
        ),
        el(
          'div',
          { className: 'mc-cell' },
          el('span', { className: 'mc-cell-lbl' }, tr ? 'En Kötü %5 (CVaR)' : 'Worst 5% Crash (CVaR)'),
          el('span', { className: `mc-cell-val ${cvarCls}` }, money(mc.cvar5ProfitUsd, true))
        )
      )
    );

    if (Array.isArray(mc.warnings) && mc.warnings.length > 0) {
      for (const w of mc.warnings) {
        wrap.appendChild(el('div', { className: 'mc-warn-line' }, `⚠ ${w}`));
      }
    }
    return wrap;
  }

  /**
   * SPREAD Agent V7 — Owned / Custom Leg 1 Skin Arbitrage Optimizer Panel on Desk
   */
  function openOwnedLeg1Optimizer() {
    const host = document.getElementById('ownedLeg1PlanBox');
    if (!host) return;
    const s = app.settings;
    const tr = isTr();
    const fx = app.market.fxRates;
    const cur = s.currency;
    const money = (u, sign = false) => fmtMoneyFromUsd(u, cur, fx, { withSign: sign });
    const mkt = MARKETPLACES[s.marketplace] || MARKETPLACES.CSFLOAT;

    const leg1DeskLines =
      s.activeBasket?.leg1?.length > 0
        ? s.activeBasket.leg1.map((l) => ({
          name: l.name,
          qty: Math.max(1, Number(l.qty) || 1),
          marketUsd: l.marketUsd,
          steamUsd: l.steamUsd
        }))
        : [
          {
            name: s.leg1.name,
            qty: Math.max(1, app.latestMetrics?.firstCycle?.q1 || 1),
            marketUsd: s.leg1.marketUsd,
            steamUsd: s.leg1.steamUsd
          }
        ];

    const res = optimizeArbitrageForOwnedLeg1(
      app.items,
      leg1DeskLines,
      getEvalOpts(),
      s.capitalUsd,
      (n) => app.findItemByName(n)
    );

    clearNode(host);
    if (!res || res.options.length === 0) {
      host.classList.add('hidden');
      app.toast(
        tr
          ? 'Bu 1. adım eşyası ve fiyatıyla kârlı arbitraj çıkışı bulunamadı. Steam satış fiyatını kontrol edin.'
          : 'No profitable arbitrage exit found for this Step 1 item & price. Check the Steam sell price.',
        'warn'
      );
      return;
    }

    host.classList.remove('hidden');
    const summaryLabel = leg1DeskLines.map((l) => `${l.qty}x ${l.name}`).join(' + ');
    const verdictPill = res.beatsDirectSell
      ? el(
        'span',
        { className: 'pill pill-mint num' },
        tr
          ? `Steam Arbitrajı +${money(res.topExtraVsDirectUsd)} Daha Kârlı (Direkt ${mkt.shortName}: ${money(res.directSellNetUsd)})`
          : `Steam Arbitrage +${money(res.topExtraVsDirectUsd)} Better (Direct ${mkt.shortName}: ${money(res.directSellNetUsd)})`
      )
      : el(
        'span',
        { className: 'pill pill-amber num' },
        tr
          ? `Dikkat: Direkt ${mkt.shortName} satışı (${money(res.directSellNetUsd)}) daha avantajlı (${money(res.topExtraVsDirectUsd, true)})`
          : `Heads up: Selling directly on ${mkt.shortName} (${money(res.directSellNetUsd)}) pays more (${money(res.topExtraVsDirectUsd, true)})`
      );

    host.appendChild(
      el(
        'div',
        { className: 'owned-plan-head' },
        el(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '5px', minWidth: '0', flex: '1' } },
          el(
            'div',
            { className: 'agent-head' },
            el(
              'span',
              { className: 'agent-badge' },
              el('span', { className: 'agent-pulse' }),
              tr ? 'SPREAD AGENT V11 • ÖZEL SKİN PLANI' : 'SPREAD AGENT V11 • OWNED SKIN PLAN'
            ),
            verdictPill
          ),
          el(
            'div',
            { style: { fontSize: '12.5px', fontWeight: '600', color: 'var(--text-primary)' } },
            `${summaryLabel} → ${money(res.totalNetSteamUsd)} Steam Net`
          )
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'btn btn-sm btn-ghost',
            onClick: () => host.classList.add('hidden')
          },
          '✕'
        )
      )
    );

    const grid = el('div', { className: 'owned-plan-grid' });
    res.options.forEach((opt, idx) => {
      const pl = opt.plan;
      const mc = opt.mc;
      const card = el(
        'div',
        { className: `owned-plan-card ${idx === 0 ? 'is-best' : ''}` },
        el(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '7px' } },
          el(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', flexWrap: 'wrap' } },
            el('span', { className: `pill ${idx === 0 ? 'pill-mint' : idx === 1 ? 'pill-ice' : 'pill-gold'}` }, opt.tag),
            el(
              'span',
              { className: `num ${pl.netProfitUsd >= 0 ? 'txt-mint' : 'txt-crimson'}`, style: { fontWeight: '700', fontSize: '13.5px' } },
              `${money(pl.netProfitUsd, true)} (${fmtPct(pl.netRoiPct, true)})`
            )
          ),
          el('div', { style: { fontSize: '12.5px', fontWeight: '700', color: 'var(--text-primary)' } }, opt.title),
          el(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: '5px' } },
            pl.leg2Lines.map((l2) =>
              el(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11.5px' } },
                el(
                  'div',
                  { className: 'pair-mini-thumb', style: { width: '32px', height: '24px', flex: '0 0 32px', '--rarity-color': l2.item.rc || '#b0c3d9' } },
                  el('img', { src: buildImageUrl(l2.item.img), alt: l2.item.n, loading: 'lazy' })
                ),
                el(
                  'div',
                  { style: { minWidth: '0', flex: '1' } },
                  el(
                    'div',
                    { style: { fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, title: l2.item.n },
                    `${l2.qty}x ${l2.item.n}`
                  ),
                  el(
                    'div',
                    { className: 'txt-muted num', style: { fontSize: '10.5px' } },
                    `${money(l2.unitSteamUsd)} → ${money(l2.unitSellUsd)} (${fmtPct(l2.m.leg2LossPct, false)} ${t('leg.lossWord').toLowerCase()})`
                  )
                )
              )
            )
          ),
          el(
            'div',
            { className: 'agent-reasons' },
            el('span', { className: `pill ${mc.riskCls}`, style: { fontSize: '10px', padding: '1px 6px' } }, `${tr ? 'Not' : 'Grade'} ${mc.riskGrade}`),
            el('span', { className: 'agent-chip num' }, `PoP ${tr ? '%' : ''}${mc.popPct.toFixed(1)}${tr ? '' : '%'}`),
            el('span', { className: 'agent-chip num' }, `CVaR ${money(mc.cvar5ProfitUsd, true)}`),
            el('span', { className: 'agent-chip num' }, `~${pl.minDays}–${pl.maxDays}${tr ? 'G' : 'd'}`)
          ),
          mc.warnings?.[0] ? el('div', { className: 'mc-warn-line' }, `⚠ ${mc.warnings[0]}`) : null
        ),
        el(
          'button',
          {
            type: 'button',
            className: `btn btn-sm ${idx === 0 ? 'btn-primary' : ''}`,
            style: { width: '100%' },
            onClick: () => {
              if (pl.totalSpentUsd > s.capitalUsd + 0.5) {
                s.capitalUsd = Math.ceil(pl.totalSpentUsd * 100) / 100;
              }
              if (pl.k1 === 1 && pl.k2 === 1) {
                const l1 = pl.leg1Lines[0];
                const l2 = pl.leg2Lines[0];
                s.activeBasket = null;
                s.leg1 = { name: l1.item.n, marketUsd: l1.unitBuyUsd, steamUsd: l1.unitSteamUsd };
                s.leg2 = { name: l2.item.n, steamUsd: l2.unitSteamUsd, marketUsd: l2.unitSellUsd };
                app.saveSettings();
                syncInputsFromSettings();
                renderMetricsOnly(true, true);
                app.toast(
                  tr
                    ? `Özel skin çıkışı uygulandı: ${l2.qty}x ${l2.item.n} (${money(pl.netProfitUsd, true)})`
                    : `Custom skin exit applied: ${l2.qty}x ${l2.item.n} (${money(pl.netProfitUsd, true)})`
                );
              } else {
                app.applyBasket(pl);
              }
              host.classList.add('hidden');
            }
          },
          tr ? 'Masaya Uygula →' : 'Apply to Desk →'
        )
      );
      grid.appendChild(card);
    });

    host.appendChild(grid);
    host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /**
   * Renders the Smart Capital Strategy Advisor Panel inside the Trade Desk
   */
  function renderAdvisorSection() {
    const tierBadgeEl = document.getElementById('advisorTierBadge');
    const tierAdviceEl = document.getElementById('advisorTierAdvice');
    const strategiesGrid = document.getElementById('advisorStrategiesGrid');
    const splitBarHost = document.getElementById('advisorSplitPlan');
    const diagHost = document.getElementById('advisorDiagnosticsHost');
    if (!strategiesGrid) return;

    const s = app.settings;
    const fx = app.market.fxRates;
    const cur = s.currency;
    const money = (u, sign = false) => fmtMoneyFromUsd(u, cur, fx, { withSign: sign });

    const advisor = analyzeCapitalStrategies(
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
      s.capitalUsd,
      advisorFilters
    );
    lastAdvisorResult = advisor;

    if (tierBadgeEl) {
      tierBadgeEl.textContent = `${advisor.tier.badge} • ${money(s.capitalUsd)}`;
    }
    if (tierAdviceEl) {
      tierAdviceEl.textContent = advisor.tier.advice;
    }

    const matchMeta = document.getElementById('advisorFilterStatus');
    if (matchMeta) {
      matchMeta.textContent = `${advisor.strategies.length} ${t('adv.stratsCount')} • ${t('adv.maxLabel')} ${advisor.effectiveMaxQ1}`;
    }

    // Async live volume + Steam histogram hydration for top displayed advisor items (marketplace-isolated!)
    const topAdvNames = [];
    for (const st of advisor.strategies.slice(0, 3)) {
      if (st?.pair?.leg1?.item?.n) topAdvNames.push(st.pair.leg1.item.n);
      if (st?.pair?.leg2?.item?.n) topAdvNames.push(st.pair.leg2.item.n);
    }
    const uniqueTopAdv = Array.from(new Set(topAdvNames)).slice(0, 6);
    const advVerifyKey = `${s.marketplace}:${uniqueTopAdv.join('|')}`;
    if (uniqueTopAdv.length > 0 && advVerifyKey !== lastAdvisorVerifyKey && app.items.length > 0) {
      lastAdvisorVerifyKey = advVerifyKey;
      const mktSnap = s.marketplace;
      const missingLive = uniqueTopAdv.filter((n) => !liveSteamMap[`${mktSnap}:${n}`]);
      if (missingLive.length > 0) {
        app.market.verifySteamLive(missingLive, app.items, mktSnap).then((res) => {
          if (res && Object.keys(res).length > 0) {
            for (const [k, v] of Object.entries(res)) liveSteamMap[`${mktSnap}:${k}`] = v;
            renderAdvisorSection();
          }
        });
      }
    }

    // V9 Unified Single + Multi-Item Basket Engine & Head-to-Head Mode Arbitrator
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
    const basketHost = document.getElementById('basketBlueprintPanel');
    const agentHost = document.getElementById('spreadAgentCard');
    const modePillEl = document.getElementById('splitModeAgentPill');
    const splitActive = Boolean(s.splitMode);
    const mkt = MARKETPLACES[s.marketplace] || MARKETPLACES.CSFLOAT;
    const trNow = isTr();

    const brief = advisor.agentBrief;
    const ap = brief?.pair || null;
    const singleMc = ap
      ? runMonteCarloSimulation({
        leg1Lines: [{ item: ap.leg1.item, m: ap.leg1.m, spentUsd: ap.c1.spentM1 }],
        leg2Lines: [{ item: ap.leg2.item, m: ap.leg2.m, steamCostUsd: ap.c1.q2 * ap.leg2.m.steamUsd }],
        expectedProfitUsd: ap.c1.netProfit,
        capitalUsd: s.capitalUsd,
        instantFloorProfitUsd: ap.instantFloorProfit,
        marketplace: s.marketplace
      })
      : null;

    // ALWAYS evaluate Basket Mode alongside Single Mode so Agent can compare both head-to-head!
    const basketRes =
      app.items.length > 0
        ? optimizeMultiItemBasket(app.items, evalOpts, s.capitalUsd, {
          ...advisorFilters,
          buyCount: splitActive ? Number(s.splitBuyCount) || 0 : 0,
          sellCount: splitActive ? Number(s.splitSellCount) || 0 : 0,
          anchorLeg1Name: ap?.leg1?.item?.n || ''
        })
        : null;

    const pl = basketRes?.plan || null;
    const basketMc = pl
      ? runMonteCarloSimulation({
        leg1Lines: pl.leg1Lines,
        leg2Lines: pl.leg2Lines,
        expectedProfitUsd: pl.slippageAdjProfitUsd,
        capitalUsd: s.capitalUsd,
        instantFloorProfitUsd: pl.instantFloorProfitUsd,
        marketplace: s.marketplace
      })
      : null;

    const modeVerdict = evaluateModeArbitration(ap, basketRes, singleMc, basketMc, s.capitalUsd, evalOpts, money);

    const switchSplitMode = (enable, resetAuto = false) => {
      app.settings.splitMode = Boolean(enable);
      if (resetAuto) {
        app.settings.splitBuyCount = 0;
        app.settings.splitSellCount = 0;
      }
      app.saveSettings();
      syncInputsFromSettings();
      renderAdvisorSection();
      app.toast(
        isTr()
          ? enable
            ? 'SPREAD Agent: Sepet / Bölme Modu açıldı.'
            : 'SPREAD Agent: Tekli Moda geçildi.'
          : enable
            ? 'SPREAD Agent: Multi-Item Basket Mode enabled.'
            : 'SPREAD Agent: Switched to Single Mode.'
      );
    };

    // Hydrate live Agent Mode Pill right next to the Sepet / Bölme Modu toggle switch
    if (modePillEl) {
      if (modeVerdict.togglePill) {
        modePillEl.textContent = modeVerdict.togglePill;
        modePillEl.className = `mode-agent-pill num ${modeVerdict.togglePillCls}`;
        modePillEl.onclick = () => {
          if (modeVerdict.verdict === 'PREFER_SINGLE') {
            if (app.settings.splitMode) switchSplitMode(false, false);
          } else if (modeVerdict.verdict === 'PREFER_BASKET') {
            if (!app.settings.splitMode) switchSplitMode(true, true);
          } else {
            switchSplitMode(!app.settings.splitMode, !app.settings.splitMode);
          }
        };
      } else {
        modePillEl.className = 'mode-agent-pill hidden';
        modePillEl.textContent = '';
        modePillEl.onclick = null;
      }
    }

    const renderModeVerdictBar = (banner) => {
      if (!banner) return null;
      const isPrimaryAction = banner.tone === 'is-single-win' || banner.tone === 'is-basket-win';
      return el(
        'div',
        { className: `mode-verdict-bar ${banner.tone}` },
        el(
          'div',
          { className: 'mode-verdict-copy' },
          el('div', { className: 'mode-verdict-title' }, banner.title),
          el('div', { className: 'mode-verdict-detail' }, banner.detail)
        ),
        el(
          'button',
          {
            type: 'button',
            className: `btn btn-sm ${isPrimaryAction ? 'btn-primary' : 'btn-ghost'}`,
            onClick: () => switchSplitMode(banner.targetSplitMode, banner.targetSplitMode)
          },
          banner.ctaLabel
        )
      );
    };

    // Unified Premium Visual Skin Line Renderer (used in BOTH Single Mode & Basket Mode!)
    const renderBlueprintLine = (line, isLeg1) => {
      const it = line.item;
      const wearShort = it.w ? it.w.replace(/[^A-Z]/g, '').slice(0, 2) || it.w : '';
      const phMeta = it.ph ? DOPPLER_PHASE_META[it.ph] : null;
      const daysVol = Number(line.daysOfVol) || 0;
      const absCls = daysVol > 0 && daysVol <= 2.2 ? 'is-fast' : daysVol > 4.5 ? 'is-heavy' : '';
      const absText =
        daysVol > 0
          ? trNow
            ? `~${daysVol < 0.2 ? '0.1' : daysVol.toFixed(1)}G hacim`
            : `~${daysVol < 0.2 ? '0.1' : daysVol.toFixed(1)}d vol`
          : '';
      const instBuyOrd = isLeg1
        ? Number(it.stBuyOrd) || 0
        : s.marketplace === 'YOUPIN'
          ? Number(it.ypo) || 0
          : Number(it.cfo) || 0;

      return el(
        'div',
        { className: 'basket-line-row' },
        el(
          'div',
          { className: 'pair-mini-thumb', style: { '--rarity-color': it.rc || '#b0c3d9' } },
          el('img', { src: buildImageUrl(it.img), alt: it.n, loading: 'lazy' })
        ),
        el(
          'div',
          { className: 'basket-line-main' },
          el(
            'div',
            { className: 'basket-line-top' },
            el('span', { className: 'basket-line-name', title: it.n }, `${line.qty}x ${it.n}`),
            el(
              'span',
              { className: 'basket-line-share num' },
              trNow ? `%${Number(line.sharePct ?? 100).toFixed(0)}` : `${Number(line.sharePct ?? 100).toFixed(0)}%`
            )
          ),
          el(
            'div',
            { className: 'basket-line-sub num' },
            isLeg1
              ? `${money(line.spentUsd)} → ${money(line.netSteamUsd)} Steam (${fmtPct(line.m.leg1ProfitPct, true)})`
              : `${money(line.steamCostUsd)} Steam → ${money(line.cashReturnUsd)} (${fmtPct(line.m.leg2LossPct, false)} ${t('leg.lossWord').toLowerCase()})`
          ),
          el(
            'div',
            { className: 'vel-micro-row num' },
            el('span', { className: `vel-dot is-${line.vel.tier}` }),
            el(
              'span',
              null,
              `${line.vel.shortLabel} • ${line.vel.volText} • ${line.fillDays <= 1
                ? trNow
                  ? '~0–1G'
                  : '~0–1d'
                : trNow
                  ? `~${line.fillDays}G satış`
                  : `~${line.fillDays}d fill`
              }`
            )
          ),
          el(
            'div',
            { className: 'plan-line-meta' },
            wearShort ? el('span', { className: 'pill pill-muted', style: { fontSize: '9.5px', padding: '0 5px' } }, wearShort) : null,
            phMeta ? el('span', { className: `phase-tag ${phMeta.cls}` }, it.ph) : null,
            absText ? el('span', { className: `absorption-pill ${absCls}` }, absText) : null,
            instBuyOrd > 0
              ? el(
                'span',
                { className: 'absorption-pill', title: isLeg1 ? 'Steam Buy-Order' : `${mkt.shortName} Buy-Order` },
                isLeg1
                  ? trNow
                    ? `Steam Anında: ${money(instBuyOrd)}`
                    : `Steam Bid: ${money(instBuyOrd)}`
                  : trNow
                    ? `Anında: ${money(instBuyOrd)}`
                    : `Instant: ${money(instBuyOrd)}`
              )
              : null
          )
        ),
        el(
          'div',
          { className: 'basket-line-links', style: { flexDirection: 'column', alignItems: 'flex-end', gap: '3px' } },
          el(
            'a',
            {
              href: isLeg1 ? mkt.searchUrl(it.n, it) : steamMarketUrl(it.n, it),
              target: '_blank',
              rel: 'noopener noreferrer',
              className: 'btn btn-sm btn-ghost',
              style: { padding: '2px 6px', fontSize: '10.5px' },
              title: isLeg1 ? `${mkt.name} ↗` : 'Steam ↗'
            },
            isLeg1 ? `${mkt.shortName} ↗` : 'Steam ↗'
          ),
          el(
            'a',
            {
              href: isLeg1 ? steamMarketUrl(it.n, it) : mkt.searchUrl(it.n, it),
              target: '_blank',
              rel: 'noopener noreferrer',
              className: 'btn btn-sm btn-ghost txt-muted',
              style: { padding: '1px 6px', fontSize: '10px' },
              title: isLeg1 ? 'Steam ↗' : `${mkt.name} ↗`
            },
            isLeg1 ? 'Steam ↗' : `${mkt.shortName} ↗`
          )
        )
      );
    };

    // BASKET MODE PANEL (when splitActive === true)
    if (basketHost) {
      clearNode(basketHost);
      if (!splitActive) {
        basketHost.classList.add('hidden');
      } else if (!basketRes || !pl) {
        basketHost.classList.remove('hidden');
        basketHost.appendChild(
          el(
            'div',
            { className: 'txt-muted', style: { fontSize: '12.5px' } },
            trNow
              ? 'Bu bütçe ve hız filtreleriyle çoklu sepet oluşturulamadı. Daha yüksek bütçe veya daha esnek hız seçin.'
              : 'Could not build a multi-item basket under current budget/speed filters. Try increasing budget or relaxing Sell Speed.'
          )
        );
      } else {
        basketHost.classList.remove('hidden');

        // Live Steam + Cashout Market volume verification for active basket items (marketplace-isolated!)
        const bpNames = Array.from(
          new Set([...pl.leg1Lines.map((l) => l.item.n), ...pl.leg2Lines.map((l) => l.item.n)])
        ).slice(0, 6);
        const mktBp = s.marketplace;
        const bpMissing = bpNames.filter((n) => !liveSteamMap[`${mktBp}:${n}`]);
        if (bpMissing.length > 0 && app.items.length > 0) {
          const bpKey = `bp:${mktBp}:${bpNames.join('|')}`;
          if (bpKey !== lastAdvisorVerifyKey) {
            lastAdvisorVerifyKey = bpKey;
            app.market.verifySteamLive(bpMissing, app.items, mktBp).then((res) => {
              if (res && Object.keys(res).length > 0) {
                for (const [k, v] of Object.entries(res)) liveSteamMap[`${mktBp}:${k}`] = v;
                renderAdvisorSection();
              }
            });
          }
        }

        const reqLabel =
          pl.k1Requested === 0 && pl.k2Requested === 0
            ? trNow
              ? `Oto: ${pl.k1} Al → ${pl.k2} Sat`
              : `Auto: ${pl.k1} Buy → ${pl.k2} Sell`
            : trNow
              ? `${pl.k1} Al → ${pl.k2} Sat`
              : `${pl.k1} Buy → ${pl.k2} Sell`;

        const bpChips = [
          trNow
            ? `Günde +%${pl.roiPerDay.toFixed(2)} (~${pl.minDays}–${pl.maxDays}G)`
            : `+${pl.roiPerDay.toFixed(2)}%/day (~${pl.minDays}–${pl.maxDays}d)`,
          trNow
            ? `Anında Taban: ${money(pl.instantFloorProfitUsd, true)}`
            : `Instant Floor: ${money(pl.instantFloorProfitUsd, true)}`,
          trNow
            ? `Kötü Hafta (%10): ${money(pl.risk.downside10ProfitUsd, true)}`
            : `10% Stress Case: ${money(pl.risk.downside10ProfitUsd, true)}`,
          trNow
            ? `Aktif Sermaye: %${pl.deployedCashPct.toFixed(0)} • Steam %${pl.steamUsedPct.toFixed(0)}`
            : `Cash Deployed: ${pl.deployedCashPct.toFixed(0)}% • Steam ${pl.steamUsedPct.toFixed(0)}%`,
          trNow
            ? `Kayma: %${pl.totalSlippagePct.toFixed(2)} • Risk ±%${pl.risk.sigma14dPct.toFixed(1)}`
            : `Slippage: ${pl.totalSlippagePct.toFixed(2)}% • Vol ±${pl.risk.sigma14dPct.toFixed(1)}%`
        ];

        basketHost.appendChild(
          el(
            'div',
            { className: 'basket-bp-head' },
            el(
              'div',
              { className: 'basket-bp-title-col' },
              el(
                'div',
                { className: 'agent-head' },
                el('span', { className: 'agent-badge' }, el('span', { className: 'agent-pulse' }), t('split.badge')),
                el('span', { className: 'pill pill-ice num' }, reqLabel),
                el(
                  'span',
                  { className: `pill ${pl.risk.popPct >= 95 ? 'pill-mint' : 'pill-gold'} num` },
                  trNow ? `Kâr İhtimali %${pl.risk.popPct.toFixed(1)}` : `Profit Prob ${pl.risk.popPct.toFixed(1)}%`
                )
              ),
              basketRes.rationale ? el('div', { className: 'basket-bp-rationale' }, basketRes.rationale) : null,
              el(
                'div',
                { className: 'agent-reasons' },
                bpChips.map((c) => el('span', { className: 'agent-chip num' }, c))
              )
            ),
            el(
              'div',
              { className: 'agent-cta-col' },
              el(
                'div',
                { className: 'agent-profit-big num txt-mint' },
                `${money(pl.netProfitUsd, true)} `,
                el('small', null, `(${fmtPct(pl.netRoiPct, true)})`)
              ),
              el(
                'span',
                { className: 'txt-muted num', style: { fontSize: '11px' } },
                trNow
                  ? `Toplam ${pl.totalQ1} alım → ${pl.totalQ2} paralel çıkış`
                  : `Total ${pl.totalQ1} buys → ${pl.totalQ2} parallel exits`
              )
            )
          )
        );

        basketHost.appendChild(renderMonteCarloStrip(basketMc, money, trNow));

        // V9 Head-to-Head Single vs Basket Verdict inside Basket Mode (e.g. "Close Basket Mode -> +$58 more profit!")
        if (modeVerdict.basketBanner) {
          basketHost.appendChild(renderModeVerdictBar(modeVerdict.basketBanner));
        }

        if (basketRes.agentBetterAlt) {
          const alt = basketRes.agentBetterAlt;
          basketHost.appendChild(
            el(
              'div',
              { className: 'basket-advice-strip' },
              el('span', null, `💡 ${alt.reason}`),
              el(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-sm btn-primary',
                  onClick: () => {
                    app.settings.splitBuyCount = alt.k1;
                    app.settings.splitSellCount = alt.k2;
                    app.saveSettings();
                    syncInputsFromSettings();
                    renderAdvisorSection();
                    app.toast(
                      isTr()
                        ? `Agent önerisi uygulandı: ${alt.k1} Al → ${alt.k2} Sat`
                        : `Applied Agent recommendation: ${alt.k1} Buy → ${alt.k2} Sell`
                    );
                  }
                },
                trNow ? `${alt.k1} Al → ${alt.k2} Sat Uygula` : `Switch to ${alt.k1} Buy → ${alt.k2} Sell`
              )
            )
          );
        }

        basketHost.appendChild(
          el(
            'div',
            { className: 'basket-grid-2col' },
            el(
              'div',
              { className: 'basket-col-box' },
              el(
                'div',
                { className: 'basket-col-head' },
                el('span', { className: 'txt-mint' }, `${t('split.buyCol')} (${pl.k1})`),
                el('span', { className: 'num txt-sec' }, `${money(pl.totalSpentUsd)} → ${money(pl.totalNetSteamUsd)} Steam`)
              ),
              pl.leg1Lines.map((l) => renderBlueprintLine(l, true)),
              el(
                'div',
                { className: 'basket-col-foot num' },
                el('span', null, trNow ? `Boşta kalan nakit: ${money(pl.idleCashUsd)}` : `Cash leftover: ${money(pl.idleCashUsd)}`),
                el('span', null, trNow ? `Paralel Steam satış: ~${pl.extraLeg1Days}G` : `Parallel Steam sell: ~${pl.extraLeg1Days}d`)
              )
            ),
            el(
              'div',
              { className: 'basket-col-box' },
              el(
                'div',
                { className: 'basket-col-head' },
                el('span', { className: 'txt-gold' }, `${t('split.sellCol')} (${pl.k2})`),
                el('span', { className: 'num txt-sec' }, `${money(pl.totalSteamUsedUsd)} → ${money(pl.totalCashReturnUsd)}`)
              ),
              pl.leg2Lines.map((l) => renderBlueprintLine(l, false)),
              el(
                'div',
                { className: 'basket-col-foot num' },
                el('span', null, trNow ? `Kalan Steam bakiye: ${money(pl.leftoverSteamUsd)}` : `Steam leftover: ${money(pl.leftoverSteamUsd)}`),
                el('span', null, trNow ? `Paralel çıkış süresi: ~${pl.extraLeg2Days}G` : `Parallel exit wait: ~${pl.extraLeg2Days}d`)
              )
            )
          )
        );

        basketHost.appendChild(
          el(
            'div',
            { className: 'basket-footer-actions' },
            el(
              'div',
              { style: { display: 'flex', gap: '7px', flexWrap: 'wrap' } },
              el(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-sm btn-primary',
                  onClick: () => app.createTrackedBasketCycle(pl)
                },
                t('split.trackBasket')
              ),
              el(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-sm',
                  onClick: () => {
                    const linesTxt = [
                      `SPREAD Smart Basket (${money(s.capitalUsd)} • ${pl.k1} -> ${pl.k2})`,
                      `Est. Profit: ${money(pl.netProfitUsd, true)} (${fmtPct(pl.netRoiPct, true)}) | Floor: ${money(pl.instantFloorProfitUsd, true)} | PoP: ${pl.risk.popPct}%`,
                      '',
                      `[1] BUY (${mkt.name} -> Steam):`,
                      ...pl.leg1Lines.map((l) => `- ${l.qty}x ${l.item.n} @ ${money(l.unitBuyUsd)} = ${money(l.spentUsd)} -> Steam Net ${money(l.netSteamUsd)}`),
                      '',
                      `[2] PARALLEL CASHOUT (Steam -> ${mkt.name}):`,
                      ...pl.leg2Lines.map((l) => `- ${l.qty}x ${l.item.n} @ ${money(l.unitSteamUsd)} -> Cash ${money(l.cashReturnUsd)} (${fmtPct(l.m.leg2LossPct, false)} loss)`),
                      '',
                      'Generated on https://spread.haking.tr'
                    ].join('\n');
                    navigator.clipboard?.writeText(linesTxt).then(
                      () => app.toast(trNow ? 'Sepet alış/satış listesi panoya kopyalandı.' : 'Basket buy/sell checklist copied to clipboard.'),
                      () => app.toast(trNow ? 'Panoya kopyalanamadı.' : 'Clipboard copy failed.', 'warn')
                    );
                  }
                },
                t('split.copyPlan')
              )
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'btn btn-sm btn-primary',
                onClick: () => app.applyBasket(pl)
              },
              t('split.loadPrimary')
            )
          )
        );
      }
    }

    // SPREAD AGENT V9 Visual Blueprint Card (Single Pair Mode — Full Skin Visuals + Mode Arbitrator!)
    if (agentHost) {
      clearNode(agentHost);
      if (!brief || !ap || splitActive) {
        agentHost.classList.add('hidden');
      } else {
        agentHost.classList.remove('hidden');
        const pairRisk = computeSinglePairRisk(ap, s.capitalUsd);
        const isActivePick =
          !s.activeBasket &&
          s.leg1.name.toLowerCase() === ap.leg1.item.n.toLowerCase() &&
          s.leg2.name.toLowerCase() === ap.leg2.item.n.toLowerCase();
        const reasonsWithPop = [
          ...brief.reasons.slice(0, 4),
          trNow
            ? `Kâr İhtimali %${pairRisk.popPct.toFixed(1)} (±%${pairRisk.sigma14dPct.toFixed(1)})`
            : `Profit Prob ${pairRisk.popPct.toFixed(1)}% (±${pairRisk.sigma14dPct.toFixed(1)}%)`
        ];

        // Build full visual blueprint lines for Step 1 & Step 2 (matches Basket Mode's premium look!)
        const l1DailySingle = ap.leg1.item?.stHist
          ? Math.max(0.08, ((Number(ap.leg1.item.st7) || 0) / 7) * 0.65 + ((Number(ap.leg1.item.st30) || 0) / 30) * 0.35)
          : ap.leg1.item?.st24Checked
            ? Math.max(0.15, Number(ap.leg1.item.st24) || 0)
            : Math.max(0.25, ap.leg1.vel.estDailySales || 0.5);
        const l2DailySingle =
          s.marketplace !== 'YOUPIN' && ap.leg2.item?.cfLive
            ? Math.max(0.35, Number(ap.leg2.item.cf24) || 0, (Number(ap.leg2.item.cf7) || 0) / 7)
            : Math.max(0.35, ap.leg2.vel.estDailySales || 0.5, (Number(ap.leg2.vel.sold7d) || 0) / 7);

        const singleL1Line = {
          item: ap.leg1.item,
          m: ap.leg1.m,
          vel: ap.leg1.vel,
          qty: ap.c1.q1,
          sharePct: 100,
          spentUsd: ap.c1.spentM1,
          netSteamUsd: ap.c1.steamAfterLeg1,
          fillDays: Math.max(ap.leg1.vel.extraSellDays || 0, Math.min(18, Math.max(0, Math.ceil(ap.c1.q1 / Math.max(0.25, l1DailySingle * 0.85)) - 1))),
          daysOfVol: Math.round((ap.c1.q1 / l1DailySingle) * 10) / 10
        };
        const singleL2Line = {
          item: ap.leg2.item,
          m: ap.leg2.m,
          vel: ap.leg2.vel,
          qty: ap.c1.q2,
          sharePct: 100,
          steamCostUsd: ap.c1.spentS2,
          cashReturnUsd: ap.c1.cashReturnM2,
          fillDays: Math.max(ap.leg2.vel.extraSellDays || 0, Math.min(14, Math.max(0, Math.ceil(ap.c1.q2 / Math.max(0.35, l2DailySingle * 0.9)) - 1))),
          daysOfVol: Math.round((ap.c1.q2 / l2DailySingle) * 10) / 10
        };

        const deployedPctSingle = s.capitalUsd > 0 ? Math.min(100, (ap.c1.spentM1 / s.capitalUsd) * 100) : 0;

        agentHost.appendChild(
          el(
            'div',
            { className: 'basket-bp-head' },
            el(
              'div',
              { className: 'basket-bp-title-col' },
              el(
                'div',
                { className: 'agent-head' },
                el('span', { className: 'agent-badge' }, el('span', { className: 'agent-pulse' }), 'SPREAD AGENT V11'),
                el('span', { className: 'pill pill-ice num' }, trNow ? 'Tekli: 1 Al → 1 Sat' : 'Single: 1 Buy → 1 Sell'),
                el(
                  'span',
                  { className: `pill ${ap.confidenceScore >= 80 ? 'pill-mint' : 'pill-gold'} num` },
                  `${t('adv.conf')} ${trNow ? '%' : ''}${ap.confidenceScore}${trNow ? '' : '%'}`
                ),
                el(
                  'span',
                  { className: 'txt-muted num', style: { fontSize: '11px' } },
                  trNow
                    ? `7 kaynak • ${app.items.length.toLocaleString('tr-TR')} skin tarandı`
                    : `7 feeds • ${app.items.length.toLocaleString('en-US')} skins scanned`
                )
              ),
              el(
                'div',
                { className: 'agent-reasons' },
                reasonsWithPop.map((r) => el('span', { className: 'agent-chip num' }, r))
              )
            ),
            el(
              'div',
              { className: 'agent-cta-col' },
              el(
                'div',
                { className: 'agent-profit-big num txt-mint' },
                `${money(ap.c1.netProfit, true)} `,
                el('small', null, `(${fmtPct(ap.c1.netRoiPct, true)})`)
              ),
              el(
                'span',
                { className: 'txt-muted num', style: { fontSize: '11px' } },
                trNow
                  ? `Toplam ${ap.c1.q1} alım → ${ap.c1.q2} çıkış • Aktif %${deployedPctSingle.toFixed(0)}`
                  : `Total ${ap.c1.q1} buys → ${ap.c1.q2} exits • ${deployedPctSingle.toFixed(0)}% deployed`
              )
            )
          )
        );

        agentHost.appendChild(renderMonteCarloStrip(singleMc, money, trNow));

        // V9 Head-to-Head Mode Arbitrator Verdict (Honest Single vs Basket Comparison!)
        if (modeVerdict.singleBanner) {
          agentHost.appendChild(renderModeVerdictBar(modeVerdict.singleBanner));
        } else if (brief.knapsackLane2) {
          agentHost.appendChild(
            el(
              'div',
              { className: 'mode-verdict-bar is-basket-win' },
              el(
                'div',
                { className: 'mode-verdict-copy' },
                el(
                  'div',
                  { className: 'mode-verdict-title' },
                  trNow ? '🧩 Boşta Kalan Nakit Fırsatı' : '🧩 Idle Cash Deployment Opportunity'
                ),
                el(
                  'div',
                  { className: 'mode-verdict-detail' },
                  trNow
                    ? `Artan ${money(brief.knapsackLane2.idleCashUsd)} nakit boşta kalmasın: +${brief.knapsackLane2.pair.c1.q1}x ${brief.knapsackLane2.pair.leg1.item.n} ekleyerek toplam kârı ${money(brief.knapsackLane2.combinedProfitUsd, true)} (${fmtPct(brief.knapsackLane2.combinedRoiPct, true)}) yapabilirsin.`
                    : `Deploy idle ${money(brief.knapsackLane2.idleCashUsd)} cash: add ${brief.knapsackLane2.pair.c1.q1}x ${brief.knapsackLane2.pair.leg1.item.n} to lift total profit to ${money(brief.knapsackLane2.combinedProfitUsd, true)} (${fmtPct(brief.knapsackLane2.combinedRoiPct, true)}).`
                )
              ),
              el(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-sm btn-primary',
                  onClick: () => switchSplitMode(true, true)
                },
                trNow ? '🔀 Sepet Modunu Aç →' : '🔀 Open Basket Mode →'
              )
            )
          );
        }

        // Visual 2-Column Step 1 & Step 2 Skin Blueprint (High-Res Skin Images + Directional Stats!)
        agentHost.appendChild(
          el(
            'div',
            { className: 'basket-grid-2col' },
            el(
              'div',
              { className: 'basket-col-box' },
              el(
                'div',
                { className: 'basket-col-head' },
                el('span', { className: 'txt-mint' }, trNow ? '1. ADIM • ALIM (1)' : 'STEP 1 • BUY (1)'),
                el('span', { className: 'num txt-sec' }, `${money(ap.c1.spentM1)} → ${money(ap.c1.steamAfterLeg1)} Steam`)
              ),
              renderBlueprintLine(singleL1Line, true),
              el(
                'div',
                { className: 'basket-col-foot num' },
                el('span', null, trNow ? `Boşta kalan nakit: ${money(ap.c1.cashLeftAfterLeg1)}` : `Cash leftover: ${money(ap.c1.cashLeftAfterLeg1)}`),
                el('span', null, trNow ? `Steam satış: ~${singleL1Line.fillDays}G` : `Steam sell: ~${singleL1Line.fillDays}d`)
              )
            ),
            el(
              'div',
              { className: 'basket-col-box' },
              el(
                'div',
                { className: 'basket-col-head' },
                el('span', { className: 'txt-gold' }, trNow ? '2. ADIM • ÇIKIŞ (1)' : 'STEP 2 • CASHOUT (1)'),
                el('span', { className: 'num txt-sec' }, `${money(ap.c1.spentS2)} → ${money(ap.c1.cashReturnM2)}`)
              ),
              renderBlueprintLine(singleL2Line, false),
              el(
                'div',
                { className: 'basket-col-foot num' },
                el('span', null, trNow ? `Kalan Steam bakiye: ${money(ap.c1.steamWallet)}` : `Steam leftover: ${money(ap.c1.steamWallet)}`),
                el('span', null, trNow ? `Çıkış süresi: ~${singleL2Line.fillDays}G • Steam %${ap.utilizedPct.toFixed(0)}` : `Exit wait: ~${singleL2Line.fillDays}d • Steam ${ap.utilizedPct.toFixed(0)}%`)
              )
            )
          )
        );

        // Quick Footer Actions (Consistent with Basket Mode!)
        agentHost.appendChild(
          el(
            'div',
            { className: 'basket-footer-actions' },
            el(
              'div',
              { style: { display: 'flex', gap: '7px', flexWrap: 'wrap' } },
              el(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-sm',
                  onClick: () => {
                    if (!isActivePick) {
                      app.applyPair(ap.leg1.item, ap.leg2.item, ap.leg1.m, ap.leg2.m);
                    }
                    document.getElementById('trackCycleBtn')?.click();
                  }
                },
                t('calc.trackBtn')
              ),
              el(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-sm',
                  onClick: () => {
                    const linesTxt = [
                      `SPREAD Agent V9 Single Plan (${money(s.capitalUsd)} • 1 -> 1)`,
                      `Est. Profit: ${money(ap.c1.netProfit, true)} (${fmtPct(ap.c1.netRoiPct, true)}) | Floor: ${money(ap.instantFloorProfit, true)} | PoP: ${singleMc.popPct}%`,
                      '',
                      `[1] BUY (${mkt.name} -> Steam):`,
                      `- ${ap.c1.q1}x ${ap.leg1.item.n} @ ${money(ap.leg1.m.marketBuyUsd)} = ${money(ap.c1.spentM1)} -> Steam Net ${money(ap.c1.steamAfterLeg1)}`,
                      '',
                      `[2] CASHOUT (Steam -> ${mkt.name}):`,
                      `- ${ap.c1.q2}x ${ap.leg2.item.n} @ ${money(ap.leg2.m.steamUsd)} -> Cash ${money(ap.c1.cashReturnM2)} (${fmtPct(ap.leg2.m.leg2LossPct, false)} loss)`,
                      '',
                      'Generated on https://spread.haking.tr'
                    ].join('\n');
                    navigator.clipboard?.writeText(linesTxt).then(
                      () => app.toast(trNow ? 'Alış/satış planı panoya kopyalandı.' : 'Buy/sell plan copied to clipboard.'),
                      () => app.toast(trNow ? 'Panoya kopyalanamadı.' : 'Clipboard copy failed.', 'warn')
                    );
                  }
                },
                t('split.copyPlan')
              )
            ),
            el(
              'button',
              {
                type: 'button',
                className: `btn btn-sm ${isActivePick ? 'btn-mint' : 'btn-primary'}`,
                onClick: () => app.applyPair(ap.leg1.item, ap.leg2.item, ap.leg1.m, ap.leg2.m)
              },
              isActivePick
                ? trNow
                  ? '✓ Agent Önerisi Masada Aktif'
                  : '✓ Agent Pick Active on Desk'
                : trNow
                  ? '⚡ Agent Teklifini Masaya Uygula'
                  : '⚡ Apply Agent Pick to Desk'
            )
          )
        );
      }
    }

    // Live Diagnostics on current selection
    if (diagHost && app.latestMetrics) {
      clearNode(diagHost);
      const alerts = diagnoseCurrentSetup(app.latestMetrics, advisor, app.latestReality);
      for (const al of alerts) {
        const icon = al.level === 'danger' ? '⚠' : al.level === 'warn' ? '!' : al.level === 'good' ? '✓' : '★';
        diagHost.appendChild(
          el(
            'div',
            { className: `diag-pill is-${al.level}` },
            el('span', { className: 'diag-icon' }, icon),
            el('span', null, al.text)
          )
        );
      }
    }

    // Up to 6 Smart Strategy Cards
    clearNode(strategiesGrid);
    if (advisor.strategies.length === 0) {
      strategiesGrid.appendChild(
        el(
          'div',
          { className: 'txt-muted', style: { gridColumn: '1 / -1', fontSize: '12.5px', padding: '12px 4px' } },
          t('adv.empty')
        )
      );
    } else {
      const tr = isTr();
      for (const st of advisor.strategies) {
        const p = st.pair;
        const isCurrent =
          s.leg1.name.toLowerCase() === p.leg1.item.n.toLowerCase() &&
          s.leg2.name.toLowerCase() === p.leg2.item.n.toLowerCase();
        const confCls = p.confidenceScore >= 85 ? 'txt-mint' : p.confidenceScore >= 70 ? 'txt-gold' : 'txt-amber';

        const card = el(
          'div',
          { className: `strategy-card ${isCurrent ? 'is-selected' : ''}` },
          el(
            'div',
            { className: 'strategy-card-head' },
            el('span', { className: `pill ${st.tagCls}` }, st.tag),
            el(
              'span',
              { className: 'num txt-mint', style: { fontWeight: '700', fontSize: '13.5px' } },
              `${money(p.c1.netProfit, true)} (${fmtPct(p.c1.netRoiPct, true)})`
            )
          ),
          el(
            'div',
            null,
            el('h4', { className: 'strategy-card-title' }, st.title),
            el('div', { className: 'strategy-action-line num' }, st.actionLine)
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
                el('div', { className: 'pair-mini-name', title: p.leg1.item.n }, `${p.c1.q1}x ${p.leg1.item.n}`),
                el(
                  'div',
                  { className: 'pair-mini-sub' },
                  `${money(p.leg1.m.marketBuyUsd)} → ${money(p.leg1.m.steamSellUsd || p.leg1.m.steamUsd)} (${fmtPct(p.leg1.m.leg1ProfitPct, true)})`
                ),
                el(
                  'div',
                  { className: 'vel-micro-row num' },
                  el('span', { className: `vel-dot is-${p.leg1.vel.tier}` }),
                  el('span', null, `${p.leg1.vel.shortLabel} • ${p.leg1.vel.volText}`)
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
                el('div', { className: 'pair-mini-name', title: p.leg2.item.n }, `${p.c1.q2}x ${p.leg2.item.n}`),
                el(
                  'div',
                  { className: 'pair-mini-sub' },
                  `${money(p.leg2.m.steamUsd)} → ${money(p.leg2.m.marketSellUsd)} (${fmtPct(p.leg2.m.leg2LossPct, false)} ${t('leg.lossWord').toLowerCase()})`
                ),
                el(
                  'div',
                  { className: 'vel-micro-row num' },
                  el('span', { className: `vel-dot is-${p.leg2.vel.tier}` }),
                  el('span', null, `${p.leg2.vel.shortLabel} • ${p.leg2.vel.volText}`)
                )
              )
            )
          ),
          st.cautionNote
            ? el('div', { className: 'strategy-caution' }, `⏱ ${st.cautionNote}`)
            : null,
          el(
            'div',
            { className: 'strategy-meta-strip num' },
            el('span', null, `~${p.reality.minDays}–${p.reality.maxDays}${tr ? 'G' : 'D'}`),
            p.leg1.m.vsBuffPct !== null && p.leg1.m.vsBuffPct <= 2.5
              ? el('span', { className: 'txt-mint', title: tr ? 'Buff163 küresel nakit fiyatına göre fark' : 'vs Buff163 global cash benchmark' }, `Buff ${p.leg1.m.vsBuffPct <= 0 ? '' : '+'}${p.leg1.m.vsBuffPct.toFixed(1)}%`)
              : el('span', null, `${t('adv.eff')} ${tr ? '%' : ''}${p.utilizedPct.toFixed(0)}${tr ? '' : '%'}`),
            el('span', { className: confCls }, `${t('adv.conf')} ${tr ? '%' : ''}${p.confidenceScore}${tr ? '' : '%'}`)
          ),
          el(
            'button',
            {
              type: 'button',
              className: `btn btn-sm ${isCurrent ? 'btn-mint' : 'btn-primary'}`,
              style: { width: '100%' },
              onClick: () => {
                app.applyPair(p.leg1.item, p.leg2.item, p.leg1.m, p.leg2.m);
              }
            },
            isCurrent ? t('adv.active') : t('adv.apply')
          )
        );
        strategiesGrid.appendChild(card);
      }
    }

    // Budget Split Allocation Plan
    if (splitBarHost) {
      clearNode(splitBarHost);
      const colors = ['var(--gold)', 'var(--mint)', 'var(--ice)'];
      const bar = el('div', { className: 'split-bar-track' });
      const legend = el('div', { className: 'split-legend-grid' });

      const trSplit = isTr();
      advisor.tier.splitPlan.forEach((seg, idx) => {
        const segUsd = (s.capitalUsd * seg.pct) / 100;
        bar.appendChild(
          el('div', {
            className: 'split-bar-seg',
            style: { width: `${seg.pct}%`, background: colors[idx % colors.length] }
          })
        );
        legend.appendChild(
          el(
            'div',
            { className: 'split-legend-item' },
            el(
              'div',
              { className: 'split-legend-head' },
              el('i', { className: 'legend-dot', style: { background: colors[idx % colors.length] } }),
              el('strong', null, trSplit ? `%${seg.pct} • ${seg.role}` : `${seg.pct}% • ${seg.role}`),
              el('span', { className: 'num txt-gold' }, money(segUsd))
            ),
            el('div', { className: 'txt-muted', style: { fontSize: '11.5px', marginTop: '2px' } }, seg.note)
          )
        );
      });

      splitBarHost.appendChild(bar);
      splitBarHost.appendChild(legend);
    }
  }

  /**
   * Renders interactive multi-item basket rows directly inside Leg 1 or Leg 2 Trade Card.
   * Each item shows skin art, velocity pill, % share, live links, and editable Qty / Buy / Sell inputs!
   */
  function renderDeskBasketLeg(hostId, legNum, evalLines, totalBasisUsd) {
    const host = document.getElementById(hostId);
    if (!host) return;
    clearNode(host);

    const s = app.settings;
    const fx = app.market.fxRates;
    const cur = s.currency;
    const sym = getCurrencyMeta(cur).symbol;
    const mkt = MARKETPLACES[s.marketplace] || MARKETPLACES.CSFLOAT;
    const tr = isTr();
    const money = (u, sign = false) => fmtMoneyFromUsd(u, cur, fx, { withSign: sign });
    const rawArr = legNum === 1 ? s.activeBasket?.leg1 : s.activeBasket?.leg2;
    if (!Array.isArray(rawArr)) return;

    const isYoupin = s.marketplace === 'YOUPIN';
    evalLines.forEach((line, idx) => {
      const found = app.findItemByName(line.name);
      const vel = computeVelocityProfile(found, s.marketplace, legNum);
      const liveRec = liveSteamMap[`${s.marketplace}:${line.name}`];
      const st = resolveSteamTelemetry(found, liveRec);
      const instantBidUsd = isYoupin ? Number(found?.ypo) || 0 : Number(found?.cfo) || 0;
      const imgUrl = buildImageUrl(found?.img);
      const rarityColor = found?.rc || '#f0b90b';
      const basis = legNum === 1 ? line.spentUsd : line.steamSpentUsd;
      const sharePct = totalBasisUsd > 0 ? (basis / totalBasisUsd) * 100 : 0;
      const subId = `deskBSub_${legNum}_${idx}`;

      const applyBasketLeg1Steam = (usdVal) => {
        if (!(usdVal > 0)) return;
        rawArr[idx].steamUsd = Math.round(usdVal * 100) / 100;
        app.saveSettings();
        renderMetricsOnly(false, true);
      };

      const formatSub = (evLine) =>
        legNum === 1
          ? `${money(evLine.spentUsd)} → ${money(evLine.steamEarnedUsd)} Steam (${fmtPct(evLine.profitPct, true)})`
          : `${money(evLine.steamSpentUsd)} Steam → ${money(evLine.cashReturnUsd)} (${fmtPct(evLine.lossPct, false)} ${t('leg.lossWord').toLowerCase()})`;

      const qtyInput = el('input', {
        type: 'number',
        step: '1',
        min: '0',
        max: '9999',
        className: 'input num',
        value: String(line.qty),
        onInput: (e) => {
          rawArr[idx].qty = Math.max(0, Math.floor(parseFloat(e.target.value) || 0));
          app.saveSettings();
          renderMetricsOnly(false, false);
        }
      });

      const p1Input = el('input', {
        type: 'number',
        step: '0.01',
        min: '0.01',
        className: 'input num',
        value: fromUsd(legNum === 1 ? line.marketUsd : line.steamUsd, cur, fx).toFixed(2),
        onInput: (e) => {
          const usdVal = Math.max(0, toUsd(parseFloat(e.target.value) || 0, cur, fx));
          if (legNum === 1) rawArr[idx].marketUsd = usdVal;
          else rawArr[idx].steamUsd = usdVal;
          app.saveSettings();
          renderMetricsOnly(false, false);
        }
      });

      const p2Input = el('input', {
        type: 'number',
        step: '0.01',
        min: '0.01',
        className: 'input num',
        value: fromUsd(legNum === 1 ? line.steamUsd : line.marketUsd, cur, fx).toFixed(2),
        onInput: (e) => {
          const usdVal = Math.max(0, toUsd(parseFloat(e.target.value) || 0, cur, fx));
          if (legNum === 1) rawArr[idx].steamUsd = usdVal;
          else rawArr[idx].marketUsd = usdVal;
          app.saveSettings();
          renderMetricsOnly(false, false);
        }
      });

      // Directional V11.1 Basket Pill: Leg 1 = Real self-consistent Steam 7d/30d Sales History; Leg 2 = Active Cashout Market speed!
      const primaryPill =
        legNum === 1 && st.stHist
          ? el(
            'span',
            {
              className: `pill ${st.st7Val >= 25 ? 'pill-mint' : st.st7Val >= 6 ? 'pill-ice' : 'pill-amber'}`,
              style: { fontSize: '10px', padding: '1px 6px' },
              title: tr
                ? `Gerçek Steam satış geçmişi: 7g ${st.st7Val} • 30g ${st.st30Val} • 24s ${st.st24Val}${st.stLastVal > 0 ? ` • Son satış ${money(st.stLastVal)}` : ''}`
                : `Real Steam sales history: 7d ${st.st7Val} • 30d ${st.st30Val} • 24h ${st.st24Val}${st.stLastVal > 0 ? ` • Last sale ${money(st.stLastVal)}` : ''}`
            },
            `${st.st7Val <= 4 ? '⚠ ' : ''}${tr ? `Steam 7g: ${st.st7Val} satış • 30g: ${st.st30Val} • 24s: ${st.st24Val}` : `Steam 7d: ${st.st7Val} sold • 30d: ${st.st30Val} • 24h: ${st.st24Val}`}`
          )
          : legNum === 1 && st.st24Checked
            ? el(
              'span',
              {
                className: `pill ${st.st24Val >= 15 ? 'pill-mint' : st.st24Val >= 3 ? 'pill-ice' : 'pill-amber'}`,
                style: { fontSize: '10px', padding: '1px 6px' },
                title: tr
                  ? '1. Adım Steam satışı: canlı Steam 24s satış adedi ve aktif Steam ilan sayısı'
                  : 'Step 1 Steam sell: live Steam 24h sold count & active Steam sell listings'
              },
              `${st.st24Val === 0 ? '⚠ ' : ''}${tr ? `Steam 24s: ${st.st24Val} satış` : `Steam 24h: ${st.st24Val} sold`}${st.stSellCnt > 0 ? ` • ${st.stSellCnt} ${tr ? 'ilan' : 'listed'}` : ''}`
            )
            : found
              ? el(
                'span',
                { className: `pill ${vel.pillCls}`, style: { fontSize: '10px', padding: '1px 6px' } },
                `${vel.shortLabel} • ${vel.volText}`
              )
              : null;

      const basketSteamDeck =
        legNum === 1
          ? renderLeg1SteamDeck(st, found, line.steamUsd, money, tr, (picked) => applyBasketLeg1Steam(picked))
          : null;

      const itemCard = el(
        'div',
        { className: 'desk-basket-item' },
        el(
          'div',
          { className: 'desk-basket-item-head' },
          el(
            'div',
            { className: 'pair-mini-thumb', style: { '--rarity-color': rarityColor } },
            el('img', { src: imgUrl, alt: line.name, loading: 'lazy' })
          ),
          el(
            'div',
            { className: 'desk-basket-item-meta' },
            el(
              'div',
              { className: 'desk-basket-item-title' },
              el('span', { className: 'desk-basket-item-name', title: line.name }, line.name),
              el('span', { className: 'basket-line-share num' }, tr ? `%${sharePct.toFixed(0)}` : `${sharePct.toFixed(0)}%`)
            ),
            el(
              'div',
              { className: 'leg-preview-tags' },
              found?.w ? el('span', { className: `wear-tag wear-${found.w}` }, found.w) : null,
              found?.ph && DOPPLER_PHASE_META[found.ph]
                ? el('span', { className: `phase-tag ${DOPPLER_PHASE_META[found.ph].cls}` }, found.ph)
                : null,
              primaryPill,
              legNum === 1 && !isYoupin && found?.q > 0
                ? el('span', { className: 'txt-muted num', style: { fontSize: '10px' } }, `${tr ? 'Alış stoğu' : 'Supply'}: ${found.q}`)
                : null,
              legNum === 1 && isYoupin && vel.bidAskPct > 0
                ? el('span', { className: 'txt-muted num', style: { fontSize: '10px' } }, `YP Bid ${tr ? '%' : ''}${vel.bidAskPct.toFixed(1)}${tr ? '' : '%'}`)
                : null,
              legNum === 2 && st.stBuyOrd > 0 && st.stBuyOrd < line.steamUsd * 0.985
                ? el(
                  'button',
                  {
                    type: 'button',
                    className: 'pill pill-ice',
                    style: { fontSize: '10px', cursor: 'pointer' },
                    title: tr ? '2. adımda Steam Buy-Order ile daha ucuza alma senaryosunu uygula' : 'Apply cheaper Steam Buy-Order purchase price for Step 2',
                    onClick: () => {
                      rawArr[idx].steamUsd = Math.round((st.stBuyOrd + 0.01) * 100) / 100;
                      app.saveSettings();
                      renderMetricsOnly(false, true);
                    }
                  },
                  `${tr ? 'Steam Emirle Al' : 'Steam Buy Order'}: ${money(st.stBuyOrd)}`
                )
                : null,
              legNum === 2 && instantBidUsd > 0
                ? el(
                  'button',
                  {
                    type: 'button',
                    className: 'pill pill-gold',
                    style: { fontSize: '10px', cursor: 'pointer' },
                    title: tr ? `${mkt.name} anında satış (buy-order) fiyatını uygula` : `Apply ${mkt.name} instant buy-order price`,
                    onClick: () => {
                      rawArr[idx].marketUsd = instantBidUsd;
                      app.saveSettings();
                      renderMetricsOnly(false, true);
                    }
                  },
                  `${mkt.shortName} ${tr ? 'Anında Sat' : 'Instant Bid'}: ${money(instantBidUsd)}`
                )
                : null
            )
          ),
          el(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '4px', flexShrink: '0' } },
            el(
              'a',
              {
                href: steamMarketUrl(line.name, found),
                target: '_blank',
                rel: 'noopener noreferrer',
                className: 'btn btn-sm btn-ghost',
                style: { padding: '2px 6px', fontSize: '10.5px' }
              },
              'Steam ↗'
            ),
            el(
              'a',
              {
                href: mkt.searchUrl(line.name, found),
                target: '_blank',
                rel: 'noopener noreferrer',
                className: 'btn btn-sm btn-ghost',
                style: { padding: '2px 6px', fontSize: '10.5px' }
              },
              `${mkt.shortName} ↗`
            ),
            rawArr.length > 1
              ? el(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-sm btn-ghost',
                  style: { padding: '2px 6px', fontSize: '11px', color: 'var(--crimson)' },
                  title: tr ? 'Bu eşyayı çıkar ve kalanların adetlerini otomatik yeniden hesapla' : 'Remove item and auto-rebalance remaining quantities',
                  onClick: () => {
                    const removedName = rawArr[idx]?.name || '';
                    rawArr.splice(idx, 1);
                    const rebOpts = getEvalOpts();
                    if (legNum === 1) {
                      s.activeBasket.leg1 = rebalanceBasketLeg(
                        s.activeBasket.leg1,
                        s.activeBasket.leg2,
                        1,
                        s.capitalUsd,
                        rebOpts,
                        (n) => app.findItemByName(n)
                      );
                      s.activeBasket.leg2 = rebalanceBasketLeg(
                        s.activeBasket.leg1,
                        s.activeBasket.leg2,
                        2,
                        s.capitalUsd,
                        rebOpts,
                        (n) => app.findItemByName(n)
                      );
                    } else {
                      s.activeBasket.leg2 = rebalanceBasketLeg(
                        s.activeBasket.leg1,
                        s.activeBasket.leg2,
                        2,
                        s.capitalUsd,
                        rebOpts,
                        (n) => app.findItemByName(n)
                      );
                    }
                    if (s.activeBasket.leg1[0]) {
                      s.leg1 = {
                        name: s.activeBasket.leg1[0].name,
                        marketUsd: s.activeBasket.leg1[0].marketUsd,
                        steamUsd: s.activeBasket.leg1[0].steamUsd
                      };
                    }
                    if (s.activeBasket.leg2[0]) {
                      s.leg2 = {
                        name: s.activeBasket.leg2[0].name,
                        steamUsd: s.activeBasket.leg2[0].steamUsd,
                        marketUsd: s.activeBasket.leg2[0].marketUsd
                      };
                    }
                    app.saveSettings();
                    renderMetricsOnly(false, true);
                    const targetArr = legNum === 1 ? s.activeBasket.leg1 : s.activeBasket.leg2;
                    const totQ = targetArr.reduce((a, x) => a + (Number(x.qty) || 0), 0);
                    app.toast(
                      tr
                        ? `"${removedName}" çıkarıldı → kalan ${targetArr.length} eşyanın adetleri otomatik dengelendi (${totQ} adet).`
                        : `Removed "${removedName}" → auto-rebalanced remaining ${targetArr.length} item(s) (${totQ} units total).`
                    );
                  }
                },
                '✕'
              )
              : null
          )
        ),
        basketSteamDeck,
        el(
          'div',
          { className: 'desk-basket-inputs-3col' },
          el('div', { className: 'desk-basket-field' }, el('label', null, t('split.qtyLbl')), qtyInput),
          el(
            'div',
            { className: 'desk-basket-field' },
            el('label', null, legNum === 1 ? `${mkt.shortName} ${t('leg1.buy')} (${sym})` : `${t('leg2.buy')} (${sym})`),
            p1Input
          ),
          el(
            'div',
            { className: 'desk-basket-field' },
            el('label', null, legNum === 1 ? `${t('leg1.sell')} (${sym})` : `${mkt.shortName} ${t('leg2.sell')} (${sym})`),
            p2Input
          )
        ),
        el(
          'div',
          { className: 'desk-basket-item-foot num' },
          el('span', { id: subId }, formatSub(line)),
          el(
            'span',
            { className: legNum === 1 ? 'txt-mint' : line.lossPct <= 11 ? 'txt-mint' : 'txt-amber', style: { fontWeight: '700' } },
            legNum === 1 ? `M₁ ${fmtMult(line.m1)}` : `M₂ ${fmtMult(line.m2)}`
          )
        )
      );

      host.appendChild(itemCard);
    });

    host.appendChild(
      el(
        'div',
        { className: 'desk-basket-add-row' },
        el(
          'span',
          { className: 'txt-muted num', style: { fontSize: '11px' } },
          tr
            ? `${evalLines.length} eşya aktif • Çıkarınca adetler otomatik dengelenir`
            : `${evalLines.length} item(s) active • Auto-rebalances on add/remove`
        ),
        el(
          'div',
          { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
          el(
            'button',
            {
              type: 'button',
              className: 'btn btn-sm btn-ghost',
              title: tr ? 'Boşta kalan bütçe/Steam bakiyesini kalan eşyalara otomatik dağıt' : 'Automatically redistribute freed budget/Steam across active items',
              onClick: () => {
                const rebOpts = getEvalOpts();
                if (legNum === 1) {
                  s.activeBasket.leg1 = rebalanceBasketLeg(s.activeBasket.leg1, s.activeBasket.leg2, 1, s.capitalUsd, rebOpts, (n) => app.findItemByName(n));
                  s.activeBasket.leg2 = rebalanceBasketLeg(s.activeBasket.leg1, s.activeBasket.leg2, 2, s.capitalUsd, rebOpts, (n) => app.findItemByName(n));
                } else {
                  s.activeBasket.leg2 = rebalanceBasketLeg(s.activeBasket.leg1, s.activeBasket.leg2, 2, s.capitalUsd, rebOpts, (n) => app.findItemByName(n));
                }
                app.saveSettings();
                renderMetricsOnly(false, true);
                app.toast(tr ? `${legNum}. adım adetleri otomatik dengelendi.` : `Step ${legNum} quantities auto-rebalanced.`);
              }
            },
            t('split.rebalance')
          ),
          el(
            'button',
            {
              type: 'button',
              className: 'btn btn-sm',
              onClick: () => app.openCommandPalette(legNum, null, true)
            },
            t('split.addItem')
          )
        )
      )
    );
  }

  function renderMetricsOnly(refreshAdvisor = true, rebuildBasketDom = true) {
    const s = app.settings;
    const fx = app.market.fxRates;
    const cur = s.currency;
    const money = (usd, withSign = false, decimals = 2) => fmtMoneyFromUsd(usd, cur, fx, { withSign, decimals });
    const isBasketActive = Boolean(s.activeBasket?.leg1?.length && s.activeBasket?.leg2?.length);

    let d;
    let reality;
    let item1Obj = null;
    let item2Obj = null;

    if (isBasketActive) {
      d = computeBasketLoopMetrics({
        capitalUsd: s.capitalUsd,
        leg1Lines: s.activeBasket.leg1,
        leg2Lines: s.activeBasket.leg2,
        buyFeePct: s.buyFeePct,
        sellFeePct: s.sellFeePct,
        withdrawFeePct: s.withdrawFeePct,
        steamFeeMode: s.steamFeeMode,
        steamCustomFeePct: s.steamCustomFeePct
      });
      const l1Map = new Map();
      const l2Map = new Map();
      for (const l of s.activeBasket.leg1) {
        const found = app.findItemByName(l.name);
        if (found) l1Map.set(l.name.toLowerCase(), found);
      }
      for (const l of s.activeBasket.leg2) {
        const found = app.findItemByName(l.name);
        if (found) l2Map.set(l.name.toLowerCase(), found);
      }
      reality = estimateBasketReality(d, l1Map, l2Map, {
        marketplace: s.marketplace,
        useBuyOrderForLeg2: s.useBuyOrderForLeg2
      });
    } else {
      d = computeLoopMetrics({
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
      item1Obj = app.findItemByName(s.leg1.name);
      item2Obj = app.findItemByName(s.leg2.name);
      reality = estimateExecutionReality(d, item1Obj, item2Obj, {
        marketplace: s.marketplace,
        useBuyOrderForLeg2: s.useBuyOrderForLeg2
      });
    }

    app.latestMetrics = d;
    const c1 = d.firstCycle;
    app.latestReality = reality;

    // Toggle Single vs Full Multi-Item Basket Trade Desk UI
    const tr = isTr();
    const deskBanner = document.getElementById('deskBasketBanner');
    const deskSummaryEl = document.getElementById('deskBasketSummaryText');
    const deskMatchBtn = document.getElementById('deskBasketMatchCapBtn');
    const l1Single = document.getElementById('leg1SingleBox');
    const l2Single = document.getElementById('leg2SingleBox');
    const l1BasketHost = document.getElementById('leg1BasketDeskHost');
    const l2BasketHost = document.getElementById('leg2BasketDeskHost');

    if (deskBanner) deskBanner.classList.toggle('hidden', !isBasketActive);
    if (l1Single) l1Single.classList.toggle('hidden', isBasketActive);
    if (l2Single) l2Single.classList.toggle('hidden', isBasketActive);
    if (l1BasketHost) l1BasketHost.classList.toggle('hidden', !isBasketActive);
    if (l2BasketHost) l2BasketHost.classList.toggle('hidden', !isBasketActive);

    if (isBasketActive) {
      const bd = d.basketDetail;
      if (deskSummaryEl) {
        deskSummaryEl.textContent = tr
          ? `${bd.leg1.length} Alım (${c1.q1} ad) → ${bd.leg2.length} Paralel Çıkış (${c1.q2} ad) • Kâr İhtimali %${reality.risk?.popPct?.toFixed(1) || '99.0'}`
          : `${bd.leg1.length} Buy (${c1.q1} qty) → ${bd.leg2.length} Parallel Exit (${c1.q2} qty) • Profit Prob ${reality.risk?.popPct?.toFixed(1) || '99.0'}%`;
      }
      if (deskMatchBtn) {
        const needsCapBump = bd.overBudgetUsd > 0.5;
        deskMatchBtn.classList.toggle('hidden', !needsCapBump);
        deskMatchBtn.textContent = tr
          ? `Bütçeyi Sepete Eşitle (${money(bd.totalSpent1)})`
          : `Match Budget (${money(bd.totalSpent1)})`;
      }
      if (rebuildBasketDom) {
        renderDeskBasketLeg('leg1BasketDeskHost', 1, bd.leg1, bd.totalSpent1);
        renderDeskBasketLeg('leg2BasketDeskHost', 2, bd.leg2, bd.totalSteamSpent2);
      } else {
        bd.leg1.forEach((ev, idx) => {
          const elSub = document.getElementById(`deskBSub_1_${idx}`);
          if (elSub) elSub.textContent = `${money(ev.spentUsd)} → ${money(ev.steamEarnedUsd)} Steam (${fmtPct(ev.profitPct, true)})`;
        });
        bd.leg2.forEach((ev, idx) => {
          const elSub = document.getElementById(`deskBSub_2_${idx}`);
          if (elSub) {
            elSub.textContent = `${money(ev.steamSpentUsd)} Steam → ${money(ev.cashReturnUsd)} (${fmtPct(ev.lossPct, false)} ${t('leg.lossWord').toLowerCase()})`;
          }
        });
      }
    }

    const realityBadge = document.getElementById('tlRealityBadge');
    if (realityBadge) {
      realityBadge.textContent = reality.label;
      realityBadge.className = `pill ${reality.pillCls}`;
    }

    const realityBanner = document.getElementById('executionRealityBanner');
    const realityMsg = document.getElementById('executionRealityMsg');
    if (realityBanner && realityMsg) {
      if (reality.needsUpperTierSuggestion && c1.q1 > 0) {
        realityBanner.classList.remove('hidden');
        realityBanner.className = `alert-banner ${reality.level === 'impractical' ? 'is-danger' : ''}`;
        realityMsg.textContent = `${reality.label}: ${reality.reasons[0] ||
          (tr
            ? 'Yüksek adet veya düşük likidite nedeniyle döngü süresi 14 günü aşabilir.'
            : 'High item count or lower sales speed may extend this cycle beyond 14 days.')
          }`;
      } else {
        realityBanner.classList.add('hidden');
      }
    }

    // Preview wells + Pareto Leg 2 quick switcher + live CSFloat/Steam volume verification (Single & Basket Mode!)
    if (!isBasketActive) {
      renderSkinPreview('leg1PreviewWell', s.leg1.name, 1);
      renderSkinPreview('leg2PreviewWell', s.leg2.name, 2);
      renderLeg2SmartExits(item1Obj);
    }

    const deskVerifyNames = isBasketActive
      ? Array.from(new Set([...s.activeBasket.leg1.map((l) => l.name), ...s.activeBasket.leg2.map((l) => l.name)])).slice(0, 6)
      : [s.leg1.name, s.leg2.name].filter(Boolean);
    const mktDesk = s.marketplace;
    const verifyKey = `${mktDesk}:${deskVerifyNames.join('|')}`;
    if (deskVerifyNames.length > 0 && verifyKey !== lastSteamVerifyKey && app.items.length > 0) {
      lastSteamVerifyKey = verifyKey;
      app.market.verifySteamLive(deskVerifyNames, app.items, mktDesk).then((res) => {
        if (res && Object.keys(res).length > 0) {
          for (const [k, v] of Object.entries(res)) liveSteamMap[`${mktDesk}:${k}`] = v;
          if (app.settings.activeBasket) {
            renderMetricsOnly(false, true);
          } else {
            renderSkinPreview('leg1PreviewWell', app.settings.leg1.name, 1);
            renderSkinPreview('leg2PreviewWell', app.settings.leg2.name, 2);
          }
        }
      });
    }

    // Top Hero Strip
    document.getElementById('heroMultVal').textContent = fmtMult(d.mCycle);
    const heroRoiPill = document.getElementById('heroRoiPill');
    heroRoiPill.textContent = `${fmtPct(d.netCycleRoiPct, true)} ${t('calc.theo')}`;
    heroRoiPill.className = `pill ${d.netCycleRoiPct >= 0 ? 'pill-mint' : 'pill-crimson'}`;

    const heroNetProfit = document.getElementById('heroRealProfit');
    heroNetProfit.textContent = money(c1.netProfit, true);
    heroNetProfit.className = `metric-cell-val ${c1.netProfit >= 0 ? 'txt-mint' : 'txt-crimson'}`;
    document.getElementById('heroRealSub').textContent =
      `${t('calc.cashEquiv')}: ${money(c1.cashEquivPortfolio)} (${fmtPct(c1.netRoiPct, true)})`;

    document.getElementById('heroBreakEven').textContent = fmtPct(d.breakEvenLossLimitPct, false);
    const beSub = document.getElementById('heroBreakEvenSub');
    if (d.marginOfSafetyPct >= 0 && d.m1 > 1) {
      beSub.textContent = `${t('calc.safetyMargin')}: +${d.marginOfSafetyPct.toFixed(2)} ${t('calc.pts')}`;
      beSub.className = 'metric-cell-sub txt-mint';
    } else {
      beSub.textContent = `${t('calc.limitExceeded')} (${d.marginOfSafetyPct.toFixed(2)} ${t('calc.pts')})`;
      beSub.className = 'metric-cell-sub txt-crimson';
    }

    const monthlyRoi = (Math.pow(Math.max(0, d.mCycle), 2) - 1) * 100;
    const heroMonthly = document.getElementById('heroMonthlyRoi');
    heroMonthly.textContent = fmtPct(monthlyRoi, true);
    heroMonthly.className = `metric-cell-val ${monthlyRoi >= 0 ? 'txt-gold' : 'txt-crimson'}`;

    // Timeline Strip
    const l1KindTxt = isBasketActive ? ` • ${s.activeBasket.leg1.length} ${tr ? 'çeşit' : 'items'}` : '';
    const l2KindTxt = isBasketActive ? ` • ${s.activeBasket.leg2.length} ${tr ? 'çeşit' : 'items'}` : '';
    document.getElementById('tlDay0Main').textContent = `${money(c1.spentM1)} (${c1.q1} ${t('leg.units')}${l1KindTxt})`;
    document.getElementById('tlDay0Sub').textContent = `${t('tl.leftover')}: ${money(c1.cashLeftAfterLeg1)}`;
    document.getElementById('tlDay7Main').textContent = `${money(c1.steamAfterLeg1)} Steam Net`;
    document.getElementById('tlDay7Sub').textContent = `${c1.q2} ${t('tl.exitItems')}${l2KindTxt} • ${t('leg.left')}: ${money(c1.steamWallet)}`;
    const tl14 = document.getElementById('tlDay14Main');
    tl14.textContent = `${money(c1.cashEquivPortfolio)} (${money(c1.netProfit, true)})`;
    tl14.className = `tl-node-main ${c1.netProfit >= 0 ? 'txt-mint' : 'txt-crimson'}`;
    document.getElementById('tlDay14Sub').textContent = `${t('tl.cash')}: ${money(c1.cashWallet)} + Steam(M₂): ${money(c1.steamCashEquiv)}`;

    // Leg 1 Breakdown
    document.getElementById('leg1MultBadge').textContent = `M₁ = ${fmtMult(d.m1)}`;
    document.getElementById('outNetS1').textContent = isBasketActive
      ? `${money(d.netS1, false, 2)} (${tr ? 'ort.' : 'avg'})`
      : money(d.netS1, false, 4);
    document.getElementById('outSteamFeeInfo').textContent =
      s.steamFeeMode === 'EXACT_VALVE'
        ? `${fmtPct(d.exactSteamDetail.effectiveFeePct, false)} (${money(d.exactSteamDetail.totalFeeUsd)})`
        : s.steamFeeMode === 'DIV_115'
          ? `${fmtPct(13.04, false)} (÷1.15)`
          : `${fmtPct(s.steamCustomFeePct, false)} (${tr ? 'Özel' : 'Custom'})`;

    document.getElementById('outQ1').textContent = `${c1.q1} ${t('leg.units')}${l1KindTxt} (${t('leg.left')}: ${money(c1.cashLeftAfterLeg1)})`;
    document.getElementById('outSteamBal1').textContent = money(c1.steamAfterLeg1);
    const l1Pill = document.getElementById('outLeg1Pct');
    l1Pill.textContent = fmtPct(d.leg1ProfitPct, true);
    l1Pill.className = `pill ${d.leg1ProfitPct >= 0 ? 'pill-mint' : 'pill-crimson'}`;

    // Steam Min-Fee Trap Warning
    const feeTrapBanner = document.getElementById('steamMinFeeBanner');
    if (s.steamFeeMode === 'EXACT_VALVE' && d.pS1Usd > 0 && d.exactSteamDetail.isMinFeeTrap) {
      feeTrapBanner.classList.remove('hidden');
      document.getElementById('steamMinFeeDetail').textContent = tr
        ? `Bu fiyat seviyesinde Steam'in minimum $0.01+$0.01 kesinti kuralı efektif komisyonu %${d.exactSteamDetail.effectiveFeePct.toFixed(2)} seviyesine çıkarıyor!`
        : `At this price tier, Valve's $0.01+$0.01 minimum fee floor raises your real Steam fee to ${d.exactSteamDetail.effectiveFeePct.toFixed(2)}%!`;
    } else {
      feeTrapBanner.classList.add('hidden');
    }

    // Leg 2 Breakdown
    document.getElementById('leg2MultBadge').textContent = `M₂ = ${fmtMult(d.m2)}`;
    document.getElementById('outNetM2').textContent = isBasketActive
      ? `${money(d.netM2, false, 2)} (${tr ? 'ort.' : 'avg'})`
      : money(d.netM2, false, 4);
    document.getElementById('outQ2').textContent = `${c1.q2} ${t('leg.units')}${l2KindTxt} (Steam ${t('leg.left')}: ${money(c1.steamWallet)})`;
    document.getElementById('outCashReturn2').textContent = money(c1.cashReturnM2);

    const lossEl = document.getElementById('outConvLoss');
    if (d.conversionLossPct <= 0) {
      lossEl.textContent = `${fmtPct(Math.abs(d.conversionLossPct), true)} ${t('leg.extraGain')}`;
      lossEl.className = 'pill pill-mint';
    } else {
      lossEl.textContent = `${fmtPct(d.conversionLossPct, false)} ${t('leg.lossWord')}`;
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
      document.getElementById('insuffCapitalMsg').textContent = tr
        ? `Başlangıç sermayesi (${money(d.capitalUsd)}) 1 adet 1. Yön eşyasını (${money(d.effPM1)}) almaya yetmiyor.`
        : `Starting capital (${money(d.capitalUsd)}) is below 1 unit of Leg 1 (${money(d.effPM1)}).`;
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

    if (refreshAdvisor) {
      renderAdvisorSection();
    }
  }

  function renderCompoundTable(d, money) {
    const thead = document.getElementById('compTableHead');
    const tbody = document.getElementById('compTableBody');
    const desc = document.getElementById('compTableDesc');
    const tr = isTr();
    clearNode(thead);
    clearNode(tbody);

    if (app.settings.compoundMode === 'REALISTIC') {
      desc.textContent = tr
        ? 'Tam sayı eşya alımı (Q₁, Q₂), kalan bakiye devri ve Steam bakiyesinin M₂ nakit eşdeğeriyle gerçekçi 12 döngü (168 gün) projeksiyonu.'
        : 'Realistic 12-cycle (168-day) integer unit projection with leftover wallet carry-over & M₂ Steam cash-equivalent valuation.';

      thead.appendChild(
        el(
          'tr',
          null,
          el('th', null, t('table.colCycle')),
          el('th', null, t('table.colTime')),
          el('th', { className: 'ta-right' }, 'Q₁'),
          el('th', { className: 'ta-right' }, 'Q₂'),
          el('th', { className: 'ta-right' }, t('table.colCash')),
          el('th', { className: 'ta-right' }, t('table.colSteamLeft')),
          el('th', { className: 'ta-right' }, t('table.colCashEq')),
          el('th', { className: 'ta-right' }, t('table.colProfit'))
        )
      );

      for (const r of d.realisticCycles) {
        const cls = r.netProfit >= 0 ? 'txt-mint' : 'txt-crimson';
        tbody.appendChild(
          el(
            'tr',
            null,
            el('td', { style: { fontWeight: '600' } }, tr ? `${r.cycle}. Döngü` : `Cycle ${r.cycle}`),
            el('td', { className: 'txt-sec num' }, tr ? `${r.days}g (${r.weeks}hf)` : `${r.days}d (${r.weeks}w)`),
            el('td', { className: 'ta-right num' }, `${r.q1}`),
            el('td', { className: 'ta-right num' }, `${r.q2}`),
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
      desc.textContent = tr
        ? 'Kesintisiz oransal bileşik getiri: Capitalₙ = Capital₀ × (M₁ × M₂)ⁿ teorik üst sınırı.'
        : 'Continuous proportional compounding upper bound: Capitalₙ = Capital₀ × (M₁ × M₂)ⁿ.';

      thead.appendChild(
        el(
          'tr',
          null,
          el('th', null, t('table.colCycle')),
          el('th', null, t('table.colTime')),
          el('th', { className: 'ta-right' }, t('table.colMult')),
          el('th', { className: 'ta-right' }, t('table.colTheoCap')),
          el('th', { className: 'ta-right' }, t('table.colTheoProfit')),
          el('th', { className: 'ta-right' }, t('table.colGrowth'))
        )
      );

      for (const r of d.realisticCycles) {
        const cls = r.theoProfit >= 0 ? 'txt-mint' : 'txt-crimson';
        tbody.appendChild(
          el(
            'tr',
            null,
            el('td', { style: { fontWeight: '600' } }, tr ? `${r.cycle}. Döngü` : `Cycle ${r.cycle}`),
            el('td', { className: 'txt-sec num' }, tr ? `${r.days}g (${r.weeks}hf)` : `${r.days}d (${r.weeks}w)`),
            el('td', { className: 'ta-right num txt-sec' }, fmtMult(r.theoMult)),
            el('td', { className: 'ta-right num', style: { fontWeight: '700' } }, money(r.theoPortfolio)),
            el('td', { className: `ta-right num ${cls}`, style: { fontWeight: '700' } }, money(r.theoProfit, true)),
            el('td', { className: `ta-right num ${cls}` }, fmtPct(r.theoRoiPct, true))
          )
        );
      }
    }
  }

  // Advisor Filter Bar Events
  document.querySelectorAll('[data-adv-style]').forEach((btn) => {
    btn.addEventListener('click', () => {
      advisorFilters.style = btn.dataset.advStyle;
      document.querySelectorAll('[data-adv-style]').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.advStyle === advisorFilters.style);
      });
      // Sync maxQty & speed selects cleanly with style preset
      const qtySel = document.getElementById('advisorMaxQtySelect');
      const spdSel = document.getElementById('advisorSpeedSelect');
      if (advisorFilters.style === 'LOW_QTY' && qtySel && Number(qtySel.value) === 0) {
        advisorFilters.maxQty = 10;
        qtySel.value = '10';
      } else if (advisorFilters.style === 'ALL' && qtySel && Number(qtySel.value) === 10) {
        advisorFilters.maxQty = 0;
        qtySel.value = '0';
      }
      if (advisorFilters.style === 'FAST' && spdSel) {
        advisorFilters.minSpeed = 'ULTRA';
        spdSel.value = 'ULTRA';
      } else if (advisorFilters.style === 'PATIENT' && spdSel) {
        advisorFilters.minSpeed = 'MODERATE';
        spdSel.value = 'MODERATE';
      } else if (advisorFilters.style === 'ALL' && spdSel) {
        advisorFilters.minSpeed = 'FAST';
        spdSel.value = 'FAST';
      }
      renderAdvisorSection();
    });
  });

  document.getElementById('advisorMaxQtySelect')?.addEventListener('change', (e) => {
    advisorFilters.maxQty = Number(e.target.value) || 0;
    renderAdvisorSection();
  });

  document.getElementById('advisorSpeedSelect')?.addEventListener('change', (e) => {
    advisorFilters.minSpeed = e.target.value || 'FAST';
    renderAdvisorSection();
  });

  document.getElementById('advisorCleanToggle')?.addEventListener('change', (e) => {
    advisorFilters.cleanOnly = e.target.checked;
    renderAdvisorSection();
  });

  // V6 Multi-Item Split / Basket Mode Controls
  document.getElementById('splitModeToggle')?.addEventListener('change', (e) => {
    app.settings.splitMode = e.target.checked;
    app.saveSettings();
    document.getElementById('splitModeSelectors')?.classList.toggle('hidden', !app.settings.splitMode);
    renderAdvisorSection();
  });

  document.getElementById('splitBuyCountSelect')?.addEventListener('change', (e) => {
    app.settings.splitBuyCount = Number(e.target.value) || 0;
    app.saveSettings();
    renderAdvisorSection();
  });

  document.getElementById('splitSellCountSelect')?.addEventListener('change', (e) => {
    app.settings.splitSellCount = Number(e.target.value) || 0;
    app.saveSettings();
    renderAdvisorSection();
  });

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
      renderMetricsOnly(false);
    });
  });

  // Auto-fill best live strategy for current budget
  document.getElementById('autoBestPairBtn')?.addEventListener('click', () => {
    const best = lastAdvisorResult?.bestBenchmark;
    if (!best) {
      app.toast(
        isTr() ? 'Mevcut bütçede uygun likit strateji bulunamadı.' : 'No matching liquid strategy found for this budget.',
        'warn'
      );
      return;
    }
    app.applyPair(best.leg1.item, best.leg2.item, best.leg1.m, best.leg2.m);
  });

  document.getElementById('fixRealityBestBtn')?.addEventListener('click', () => {
    const best = lastAdvisorResult?.bestBenchmark;
    if (best) {
      app.applyPair(best.leg1.item, best.leg2.item, best.leg1.m, best.leg2.m);
    } else {
      const minUsd = Math.max(5, Math.round(app.settings.capitalUsd / 120));
      app.openCommandPalette(1, minUsd);
    }
  });

  document.getElementById('fixRealitySearchBtn')?.addEventListener('click', () => {
    const minUsd = Math.max(5, Math.round(app.settings.capitalUsd / 100));
    app.openCommandPalette(1, minUsd);
  });

  // Set min capital button
  document.getElementById('setMinCapBtn')?.addEventListener('click', () => {
    const eff = app.latestMetrics?.effPM1 || 0;
    if (eff > 0) {
      app.settings.capitalUsd = Math.ceil(eff * 100) / 100;
      app.saveSettings();
      syncInputsFromSettings();
      renderMetricsOnly(true);
      app.toast(isTr() ? 'Bütçe 1 adet alış tutarına eşitlendi.' : 'Budget matched to 1 unit purchase price.');
    }
  });

  // FX Quick Bar
  [fxSrcInput, fxFromSel, fxToSel].forEach((x) => x?.addEventListener('input', updateFxBar));
  [fxFromSel, fxToSel].forEach((x) => x?.addEventListener('change', updateFxBar));

  document.getElementById('fxSendToL1')?.addEventListener('click', () => {
    const res = updateFxBar();
    if (!res || res.usdVal <= 0) {
      app.toast(isTr() ? 'Önce kur çeviriciye geçerli bir tutar girin.' : 'Enter a valid amount in the FX converter first.', 'warn');
      return;
    }
    app.settings.leg1.marketUsd = res.usdVal;
    app.saveSettings();
    syncInputsFromSettings();
    renderMetricsOnly(true);
    app.toast(isTr() ? 'Kur çevirici tutarı 1. Adım alış fiyatına aktarıldı.' : 'FX amount sent to Step 1 buy price.');
  });

  document.getElementById('fxSendToL2')?.addEventListener('click', () => {
    const res = updateFxBar();
    if (!res || res.usdVal <= 0) {
      app.toast(isTr() ? 'Önce kur çeviriciye geçerli bir tutar girin.' : 'Enter a valid amount in the FX converter first.', 'warn');
      return;
    }
    app.settings.leg2.marketUsd = res.usdVal;
    app.saveSettings();
    syncInputsFromSettings();
    renderMetricsOnly(true);
    app.toast(isTr() ? 'Kur çevirici tutarı 2. Adım satış fiyatına aktarıldı.' : 'FX amount sent to Step 2 sell price.');
  });

  // Owned / Custom Leg 1 Arbitrage Optimizer Button (V7)
  document.getElementById('optimizeForLeg1Btn')?.addEventListener('click', () => {
    openOwnedLeg1Optimizer();
  });

  // Track cycle button & Active Basket Desk Banner buttons
  document.getElementById('trackCycleBtn')?.addEventListener('click', () => {
    app.createTrackedCycleFromCalculator();
  });

  document.getElementById('exitDeskBasketBtn')?.addEventListener('click', () => {
    app.clearActiveBasket();
  });

  document.getElementById('deskBasketMatchCapBtn')?.addEventListener('click', () => {
    const spent = app.latestMetrics?.basketDetail?.totalSpent1 || 0;
    if (spent > 0) {
      app.settings.capitalUsd = Math.ceil(spent * 100) / 100;
      app.saveSettings();
      syncInputsFromSettings();
      renderMetricsOnly(true, true);
      app.toast(isTr() ? 'Bütçe aktif sepet maliyetine eşitlendi.' : 'Budget matched to active basket cost.');
    }
  });

  // Resize charts smoothly
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (app.activeTab === 'calculator') renderMetricsOnly(false);
    }, 150);
  });

  initOnboardingState();

  return {
    syncInputsFromSettings,
    render: () => {
      syncInputsFromSettings();
      document.querySelectorAll('[data-comp-mode]').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.compMode === app.settings.compoundMode);
      });
      renderMetricsOnly(true);
    }
  };
}
