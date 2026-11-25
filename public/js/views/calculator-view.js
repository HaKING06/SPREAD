/**
 * SPREAD (spread.haking.tr) — 2-Leg Trade Desk Calculator + Smart Capital Advisor View
 */

import { MARKETPLACES, STORAGE_KEYS, buildImageUrl, steamMarketUrl } from '../core/config.js';
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
import { computeSinglePairRisk, optimizeMultiItemBasket } from '../core/basket-optimizer.js';
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

  function renderSkinPreview(containerId, itemName, legNum) {
    const box = document.getElementById(containerId);
    if (!box) return;
    clearNode(box);

    const found = app.findItemByName(itemName);
    const vel = computeVelocityProfile(found);
    const liveSteam = liveSteamMap[itemName];
    const mkt = MARKETPLACES[app.settings.marketplace] || MARKETPLACES.CSFLOAT;
    const imgUrl = buildImageUrl(found?.img);
    const rarityColor = found?.rc || '#f0b90b';

    const thumb = el(
      'div',
      { className: 'skin-thumb skin-thumb-lg', style: { '--rarity-color': rarityColor } },
      el('img', { src: imgUrl, alt: itemName })
    );

    const tr = isTr();
    const steamVolChip = liveSteam?.live
      ? el(
          'span',
          {
            className: `pill ${liveSteam.volume24h >= 50 ? 'pill-mint' : liveSteam.volume24h >= 10 ? 'pill-ice' : 'pill-amber'}`,
            style: { fontSize: '10px', padding: '1px 6px' },
            title: tr ? 'Canlı Steam 24 saatlik satış adedi & medyan fiyat' : 'Live Steam 24h sold count & median price'
          },
          `Steam 24h: ${liveSteam.volume24h.toLocaleString(tr ? 'tr-TR' : 'en-US')} ${tr ? 'satış' : 'sold'}${liveSteam.medianUsd > 0 ? ` • Med ${fmtMoneyFromUsd(liveSteam.medianUsd, app.settings.currency, app.market.fxRates)}` : ''}`
        )
      : found
      ? el(
          'span',
          {
            className: `pill ${vel.pillCls}`,
            style: { fontSize: '10px', padding: '1px 6px' },
            title: tr ? 'Son 7 günlük / 30 günlük gerçek satış temposu' : 'Real 7d / 30d sales velocity'
          },
          `${vel.shortLabel} • ${vel.volText}`
        )
      : null;

    const tags = el(
      'div',
      { className: 'leg-preview-tags' },
      found?.w ? el('span', { className: `wear-tag wear-${found.w}` }, found.w) : null,
      steamVolChip,
      found?.q ? el('span', { className: 'num' }, `${found.q} ${tr ? 'ilan' : 'listed'}`) : null,
      legNum === 1 && liveSteam?.live && liveSteam.medianUsd > 0 && liveSteam.medianUsd < app.settings.leg1.steamUsd * 0.96
        ? el(
            'button',
            {
              type: 'button',
              className: 'pill pill-amber',
              style: { fontSize: '10px', cursor: 'pointer' },
              title: tr
                ? 'Son 24 saatte gerçekleşen medyan Steam satış fiyatını uygula (daha hızlı satış testi)'
                : 'Apply actual 24h Steam median sold price (realistic fast-sell check)',
              onClick: () => {
                app.settings.leg1.steamUsd = liveSteam.medianUsd;
                app.saveSettings();
                syncInputsFromSettings();
                renderMetricsOnly(true);
                app.toast(
                  isTr()
                    ? `Steam hızlı satış medyanı (${fmtMoneyFromUsd(liveSteam.medianUsd, app.settings.currency, app.market.fxRates)}) uygulandı.`
                    : `Applied Steam fast-sell median (${fmtMoneyFromUsd(liveSteam.medianUsd, app.settings.currency, app.market.fxRates)}).`
                );
              }
            },
            `${tr ? 'Hızlı Medyan' : 'Fast Median'}: ${fmtMoneyFromUsd(liveSteam.medianUsd, app.settings.currency, app.market.fxRates)}`
          )
        : null,
      found?.cfo && legNum === 2 && app.settings.marketplace === 'CSFLOAT'
        ? el(
            'button',
            {
              type: 'button',
              className: 'pill pill-gold',
              style: { fontSize: '10px', cursor: 'pointer' },
              title: tr ? 'CSFloat en yüksek alım emri (anında satış) fiyatını uygula' : 'Apply CSFloat highest buy order (instant sell) price',
              onClick: () => {
                app.settings.leg2.marketUsd = found.cfo;
                app.saveSettings();
                syncInputsFromSettings();
                renderMetricsOnly(true);
                app.toast(
                  isTr()
                    ? `CSFloat anında satış fiyatı (${fmtMoneyFromUsd(found.cfo, app.settings.currency, app.market.fxRates)}) uygulandı.`
                    : `Applied CSFloat instant buy order (${fmtMoneyFromUsd(found.cfo, app.settings.currency, app.market.fxRates)}).`
                );
              }
            },
            `${tr ? 'Anında Sat' : 'Instant Bid'}: ${fmtMoneyFromUsd(found.cfo, app.settings.currency, app.market.fxRates)}`
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
        t('leg.change')
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

    // V6 Optional Multi-Item Split / Basket Portfolio Blueprint
    const basketHost = document.getElementById('basketBlueprintPanel');
    const splitActive = Boolean(s.splitMode);
    const mkt = MARKETPLACES[s.marketplace] || MARKETPLACES.CSFLOAT;
    if (basketHost) {
      clearNode(basketHost);
      if (!splitActive) {
        basketHost.classList.add('hidden');
      } else {
        const basketRes = optimizeMultiItemBasket(
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
          {
            ...advisorFilters,
            buyCount: Number(s.splitBuyCount) || 0,
            sellCount: Number(s.splitSellCount) || 0
          }
        );

        if (!basketRes || !basketRes.plan) {
          basketHost.classList.remove('hidden');
          basketHost.appendChild(
            el(
              'div',
              { className: 'txt-muted', style: { fontSize: '12.5px' } },
              isTr()
                ? 'Bu bütçe ve hız filtreleriyle çoklu sepet oluşturulamadı. Daha yüksek bütçe veya daha esnek hız seçin.'
                : 'Could not build a multi-item basket under current budget/speed filters. Try increasing budget or relaxing Sell Speed.'
            )
          );
        } else {
          basketHost.classList.remove('hidden');
          const trB = isTr();
          const pl = basketRes.plan;
          const reqLabel =
            pl.k1Requested === 0 && pl.k2Requested === 0
              ? trB
                ? `Oto: ${pl.k1} Al → ${pl.k2} Sat`
                : `Auto: ${pl.k1} Buy → ${pl.k2} Sell`
              : trB
              ? `${pl.k1} Al → ${pl.k2} Sat`
              : `${pl.k1} Buy → ${pl.k2} Sell`;

          const bpChips = [
            trB
              ? `Günde +%${pl.roiPerDay.toFixed(2)} (~${pl.minDays}–${pl.maxDays}G)`
              : `+${pl.roiPerDay.toFixed(2)}%/day (~${pl.minDays}–${pl.maxDays}d)`,
            trB
              ? `Anında Taban: ${money(pl.instantFloorProfitUsd, true)}`
              : `Instant Floor: ${money(pl.instantFloorProfitUsd, true)}`,
            trB
              ? `Kötü Hafta (%10): ${money(pl.risk.downside10ProfitUsd, true)}`
              : `10% Stress Case: ${money(pl.risk.downside10ProfitUsd, true)}`,
            trB
              ? `Aktif Sermaye: %${pl.deployedCashPct.toFixed(0)} • Steam %${pl.steamUsedPct.toFixed(0)}`
              : `Cash Deployed: ${pl.deployedCashPct.toFixed(0)}% • Steam ${pl.steamUsedPct.toFixed(0)}%`,
            trB
              ? `Kayma: %${pl.totalSlippagePct.toFixed(2)} • Risk ±%${pl.risk.sigma14dPct.toFixed(1)}`
              : `Slippage: ${pl.totalSlippagePct.toFixed(2)}% • Vol ±${pl.risk.sigma14dPct.toFixed(1)}%`
          ];

          const renderBasketLine = (line, isLeg1) =>
            el(
              'div',
              { className: 'basket-line-row' },
              el(
                'div',
                { className: 'pair-mini-thumb', style: { '--rarity-color': line.item.rc || '#b0c3d9' } },
                el('img', { src: buildImageUrl(line.item.img), alt: line.item.n, loading: 'lazy' })
              ),
              el(
                'div',
                { className: 'basket-line-main' },
                el(
                  'div',
                  { className: 'basket-line-top' },
                  el('span', { className: 'basket-line-name', title: line.item.n }, `${line.qty}x ${line.item.n}`),
                  el('span', { className: 'basket-line-share num' }, trB ? `%${line.sharePct.toFixed(0)}` : `${line.sharePct.toFixed(0)}%`)
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
                    `${line.vel.shortLabel} • ${trB ? `7g: ${line.vel.sold7d}` : `7d: ${line.vel.sold7d}`} • ${
                      line.fillDays <= 1
                        ? trB ? '~0–1G' : '~0–1d'
                        : trB ? `~${line.fillDays}G satış` : `~${line.fillDays}d fill`
                    }`
                  )
                )
              ),
              el(
                'div',
                { className: 'basket-line-links' },
                el(
                  'a',
                  {
                    href: isLeg1 ? mkt.searchUrl(line.item.n) : steamMarketUrl(line.item.n),
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    className: 'btn btn-sm btn-ghost',
                    style: { padding: '2px 6px', fontSize: '10.5px' },
                    title: isLeg1 ? `${mkt.name} ↗` : 'Steam ↗'
                  },
                  isLeg1 ? `${mkt.shortName} ↗` : 'Steam ↗'
                )
              )
            );

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
                    trB ? `Kâr İhtimali %${pl.risk.popPct.toFixed(1)}` : `Profit Prob ${pl.risk.popPct.toFixed(1)}%`
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
                  trB
                    ? `Toplam ${pl.totalQ1} alım → ${pl.totalQ2} paralel çıkış`
                    : `Total ${pl.totalQ1} buys → ${pl.totalQ2} parallel exits`
                )
              )
            )
          );

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
                  trB ? `${alt.k1} Al → ${alt.k2} Sat Uygula` : `Switch to ${alt.k1} Buy → ${alt.k2} Sell`
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
                pl.leg1Lines.map((l) => renderBasketLine(l, true)),
                el(
                  'div',
                  { className: 'basket-col-foot num' },
                  el('span', null, trB ? `Boşta kalan nakit: ${money(pl.idleCashUsd)}` : `Cash leftover: ${money(pl.idleCashUsd)}`),
                  el('span', null, trB ? `Paralel Steam satış: ~${pl.extraLeg1Days}G` : `Parallel Steam sell: ~${pl.extraLeg1Days}d`)
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
                pl.leg2Lines.map((l) => renderBasketLine(l, false)),
                el(
                  'div',
                  { className: 'basket-col-foot num' },
                  el('span', null, trB ? `Kalan Steam bakiye: ${money(pl.leftoverSteamUsd)}` : `Steam leftover: ${money(pl.leftoverSteamUsd)}`),
                  el('span', null, trB ? `Paralel çıkış süresi: ~${pl.extraLeg2Days}G` : `Parallel exit wait: ~${pl.extraLeg2Days}d`)
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
                        () => app.toast(trB ? 'Sepet alış/satış listesi panoya kopyalandı.' : 'Basket buy/sell checklist copied to clipboard.'),
                        () => app.toast(trB ? 'Panoya kopyalanamadı.' : 'Clipboard copy failed.', 'warn')
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
                  className: 'btn btn-sm btn-ghost',
                  onClick: () => {
                    const top1 = pl.leg1Lines[0];
                    const top2 = pl.leg2Lines[0];
                    if (top1 && top2) app.applyPair(top1.item, top2.item, top1.m, top2.m);
                  }
                },
                t('split.loadPrimary')
              )
            )
          );
        }
      }
    }

    // SPREAD AGENT Executive Recommendation Card (Single Pair Mode)
    const agentHost = document.getElementById('spreadAgentCard');
    if (agentHost) {
      clearNode(agentHost);
      const brief = advisor.agentBrief;
      if (!brief || splitActive) {
        agentHost.classList.add('hidden');
      } else {
        agentHost.classList.remove('hidden');
        const trA = isTr();
        const ap = brief.pair;
        const pairRisk = computeSinglePairRisk(ap, s.capitalUsd);
        const isActivePick =
          s.leg1.name.toLowerCase() === ap.leg1.item.n.toLowerCase() &&
          s.leg2.name.toLowerCase() === ap.leg2.item.n.toLowerCase();
        const reasonsWithPop = [
          ...brief.reasons.slice(0, 4),
          trA
            ? `Kâr İhtimali %${pairRisk.popPct.toFixed(1)} (±%${pairRisk.sigma14dPct.toFixed(1)})`
            : `Profit Prob ${pairRisk.popPct.toFixed(1)}% (±${pairRisk.sigma14dPct.toFixed(1)}%)`
        ];

        agentHost.appendChild(
          el(
            'div',
            { className: 'agent-main-col' },
            el(
              'div',
              { className: 'agent-head' },
              el('span', { className: 'agent-badge' }, el('span', { className: 'agent-pulse' }), 'SPREAD AGENT'),
              el(
                'span',
                { className: 'txt-muted num', style: { fontSize: '11px' } },
                trA ? `6 kaynak • ${app.items.length.toLocaleString('tr-TR')} skin tarandı` : `6 feeds • ${app.items.length.toLocaleString('en-US')} skins scanned`
              ),
              el(
                'span',
                { className: `pill ${ap.confidenceScore >= 80 ? 'pill-mint' : 'pill-gold'}` },
                `${t('adv.conf')} ${trA ? '%' : ''}${ap.confidenceScore}${trA ? '' : '%'}`
              )
            ),
            el('div', { className: 'agent-headline' }, brief.headline),
            el(
              'div',
              { className: 'agent-reasons' },
              reasonsWithPop.map((r) => el('span', { className: 'agent-chip num' }, r))
            ),
            brief.knapsackLane2
              ? el(
                  'div',
                  { className: 'agent-knapsack-box' },
                  el(
                    'span',
                    null,
                    trA
                      ? `🧩 Artan ${money(brief.knapsackLane2.idleCashUsd)} nakit boşta kalmasın: +${brief.knapsackLane2.pair.c1.q1}x ${brief.knapsackLane2.pair.leg1.item.n} ekleyerek toplam kârı ${money(brief.knapsackLane2.combinedProfitUsd, true)} (${fmtPct(brief.knapsackLane2.combinedRoiPct, true)}) yapabilirsin.`
                      : `🧩 Deploy idle ${money(brief.knapsackLane2.idleCashUsd)} cash: add ${brief.knapsackLane2.pair.c1.q1}x ${brief.knapsackLane2.pair.leg1.item.n} to lift total profit to ${money(brief.knapsackLane2.combinedProfitUsd, true)} (${fmtPct(brief.knapsackLane2.combinedRoiPct, true)}).`
                  ),
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'btn btn-sm btn-ghost',
                      onClick: () => {
                        app.settings.splitMode = true;
                        app.settings.splitBuyCount = 0;
                        app.settings.splitSellCount = 0;
                        app.saveSettings();
                        syncInputsFromSettings();
                        renderAdvisorSection();
                      }
                    },
                    trA ? '🔀 Sepet Modunu Aç →' : '🔀 Open Split Mode →'
                  )
                )
              : ap.c1.q2 >= 12
              ? el(
                  'div',
                  { className: 'agent-knapsack-box' },
                  el(
                    'span',
                    null,
                    trA
                      ? `🔀 ${ap.c1.q2}x tek eşya satmak yerine Sepet Modu ile 2–3 çıkışa bölerek paralel satışla hızı artırabilirsin.`
                      : `🔀 Instead of selling ${ap.c1.q2}x of one skin, enable Split Mode to sell across 2–3 books in parallel.`
                  ),
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'btn btn-sm btn-ghost',
                      onClick: () => {
                        app.settings.splitMode = true;
                        app.settings.splitBuyCount = 0;
                        app.settings.splitSellCount = 0;
                        app.saveSettings();
                        syncInputsFromSettings();
                        renderAdvisorSection();
                      }
                    },
                    trA ? 'Sepet Modunu Aç →' : 'Enable Split Mode →'
                  )
                )
              : brief.splitHint
              ? el('div', { className: 'agent-split-note' }, brief.splitHint)
              : null
          )
        );

        agentHost.appendChild(
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
              'button',
              {
                type: 'button',
                className: `btn btn-sm ${isActivePick ? 'btn-mint' : 'btn-primary'}`,
                onClick: () => app.applyPair(ap.leg1.item, ap.leg2.item, ap.leg1.m, ap.leg2.m)
              },
              isActivePick
                ? trA ? '✓ Agent Önerisi Aktif' : '✓ Agent Pick Active'
                : trA ? '⚡ Agent Teklifini Uygula' : '⚡ Apply Agent Pick'
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
                  `${money(p.leg1.m.marketBuyUsd)} → ${money(p.leg1.m.steamUsd)} (${fmtPct(p.leg1.m.leg1ProfitPct, true)})`
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

  function renderMetricsOnly(refreshAdvisor = true) {
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

    app.latestMetrics = d;
    const c1 = d.firstCycle;

    // Realistic Execution & Duration Estimation (Order-book depth, 1000-slot limit, listing effort)
    const item1Obj = app.findItemByName(s.leg1.name);
    const item2Obj = app.findItemByName(s.leg2.name);
    const reality = estimateExecutionReality(d, item1Obj, item2Obj, {
      marketplace: s.marketplace,
      useBuyOrderForLeg2: s.useBuyOrderForLeg2
    });
    app.latestReality = reality;

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
        realityMsg.textContent = `${reality.label}: ${
          reality.reasons[0] ||
          (isTr()
            ? 'Yüksek adet veya düşük likidite nedeniyle döngü süresi 14 günü aşabilir.'
            : 'High item count or lower sales speed may extend this cycle beyond 14 days.')
        }`;
      } else {
        realityBanner.classList.add('hidden');
      }
    }

    // Preview wells + Pareto Leg 2 quick switcher + async live Steam 24h sold volume verification
    renderSkinPreview('leg1PreviewWell', s.leg1.name, 1);
    renderSkinPreview('leg2PreviewWell', s.leg2.name, 2);
    renderLeg2SmartExits(item1Obj);

    const verifyKey = `${s.leg1.name}|${s.leg2.name}`;
    if (verifyKey !== lastSteamVerifyKey && app.items.length > 0) {
      lastSteamVerifyKey = verifyKey;
      app.market.verifySteamLive([s.leg1.name, s.leg2.name]).then((res) => {
        if (res && Object.keys(res).length > 0) {
          liveSteamMap = { ...liveSteamMap, ...res };
          renderSkinPreview('leg1PreviewWell', app.settings.leg1.name, 1);
          renderSkinPreview('leg2PreviewWell', app.settings.leg2.name, 2);
        }
      });
    }

    // Top Hero Strip
    const tr = isTr();
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
    document.getElementById('tlDay0Main').textContent = `${money(c1.spentM1)} (${c1.q1} ${t('leg.units')})`;
    document.getElementById('tlDay0Sub').textContent = `${t('tl.leftover')}: ${money(c1.cashLeftAfterLeg1)}`;
    document.getElementById('tlDay7Main').textContent = `${money(c1.steamAfterLeg1)} Steam Net`;
    document.getElementById('tlDay7Sub').textContent = `${c1.q2} ${t('tl.exitItems')} • ${t('leg.left')}: ${money(c1.steamWallet)}`;
    const tl14 = document.getElementById('tlDay14Main');
    tl14.textContent = `${money(c1.cashEquivPortfolio)} (${money(c1.netProfit, true)})`;
    tl14.className = `tl-node-main ${c1.netProfit >= 0 ? 'txt-mint' : 'txt-crimson'}`;
    document.getElementById('tlDay14Sub').textContent = `${t('tl.cash')}: ${money(c1.cashWallet)} + Steam(M₂): ${money(c1.steamCashEquiv)}`;

    // Leg 1 Breakdown
    document.getElementById('leg1MultBadge').textContent = `M₁ = ${fmtMult(d.m1)}`;
    document.getElementById('outNetS1').textContent = money(d.netS1, false, 4);
    document.getElementById('outSteamFeeInfo').textContent =
      s.steamFeeMode === 'EXACT_VALVE'
        ? `${fmtPct(d.exactSteamDetail.effectiveFeePct, false)} (${money(d.exactSteamDetail.totalFeeUsd)})`
        : s.steamFeeMode === 'DIV_115'
        ? `${fmtPct(13.04, false)} (÷1.15)`
        : `${fmtPct(s.steamCustomFeePct, false)} (${tr ? 'Özel' : 'Custom'})`;

    document.getElementById('outQ1').textContent = `${c1.q1} ${t('leg.units')} (${t('leg.left')}: ${money(c1.cashLeftAfterLeg1)})`;
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
    document.getElementById('outNetM2').textContent = money(d.netM2, false, 4);
    document.getElementById('outQ2').textContent = `${c1.q2} ${t('leg.units')} (Steam ${t('leg.left')}: ${money(c1.steamWallet)})`;
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

  // Track cycle button
  document.getElementById('trackCycleBtn')?.addEventListener('click', () => {
    app.createTrackedCycleFromCalculator();
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
