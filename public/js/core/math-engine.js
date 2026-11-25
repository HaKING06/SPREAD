/**
 * SPREAD (spread.haking.tr) — Quantitative CS2 Arbitrage Math Engine
 *
 * Key upgrades over basic calculators:
 *  1. Exact Valve cent-by-cent Steam Community Market fee solver (5% Steam min $0.01 + 10% CS2 min $0.01)
 *  2. True cash-equivalent portfolio valuation (cashWallet + steamWallet * M2)
 *  3. Optional marketplace withdrawal/payout fee modeling
 *  4. 2D Spread Sensitivity Heatmap (Steam hold drop vs Leg 2 cashout shift)
 *  5. Anti-manipulation Auto-Pair Finder (uses liquidity depth & 24h vs 7d stability)
 */

/**
 * Exact Valve Steam Community Market integer-cent fee solver.
 * Given a buyer listing price in USD, returns exact seller proceeds and fee breakdown.
 */
export function calcExactValveSteamFee(buyerUsd) {
  const buyerCents = Math.max(0, Math.round((Number(buyerUsd) || 0) * 100));
  if (buyerCents < 3) {
    return {
      buyerUsd: buyerCents / 100,
      netUsd: 0,
      steamFeeUsd: 0,
      cs2FeeUsd: 0,
      totalFeeUsd: buyerCents / 100,
      effectiveFeePct: buyerCents > 0 ? 100 : 0,
      isMinFeeTrap: buyerCents > 0
    };
  }

  const totalForSeller = (r) => {
    const steamFee = Math.max(1, Math.floor(r * 0.05));
    const cs2Fee = Math.max(1, Math.floor(r * 0.10));
    return { total: r + steamFee + cs2Fee, steamFee, cs2Fee };
  };

  let r = Math.max(1, Math.floor(buyerCents / 1.15));
  while (totalForSeller(r + 1).total <= buyerCents) r += 1;
  while (r > 1 && totalForSeller(r).total > buyerCents) r -= 1;

  const { steamFee, cs2Fee } = totalForSeller(r);
  const totalFeeCents = buyerCents - r;
  const effectiveFeePct = (totalFeeCents / buyerCents) * 100;

  return {
    buyerUsd: buyerCents / 100,
    netUsd: r / 100,
    steamFeeUsd: steamFee / 100,
    cs2FeeUsd: cs2Fee / 100,
    totalFeeUsd: totalFeeCents / 100,
    effectiveFeePct,
    isMinFeeTrap: buyerCents <= 25 || effectiveFeePct > 14.5
  };
}

/**
 * Calculates net Steam proceeds per unit (in USD) using selected fee mode.
 */
export function calcNetSteamUsd(grossSteamUsd, steamFeeMode = 'EXACT_VALVE', customFeePct = 13.04) {
  const p = Math.max(0, Number(grossSteamUsd) || 0);
  if (p <= 0) return 0;
  if (steamFeeMode === 'EXACT_VALVE') {
    return calcExactValveSteamFee(p).netUsd;
  }
  if (steamFeeMode === 'DIV_115') {
    return p / 1.15;
  }
  const fee = Math.max(0, Math.min(99, Number(customFeePct) || 0));
  return p * (1 - fee / 100);
}

/**
 * Effective unit cost on external marketplace (CSFloat / Youpin898) including buy fee.
 */
export function calcEffectiveBuyUsd(grossMarketUsd, buyFeePct = 0) {
  const p = Math.max(0, Number(grossMarketUsd) || 0);
  const fee = Math.max(0, Math.min(50, Number(buyFeePct) || 0));
  return p * (1 + fee / 100);
}

/**
 * Net cash returned per unit on external marketplace after sell fee + optional withdrawal fee.
 */
export function calcNetSellUsd(grossMarketUsd, sellFeePct = 2.0, withdrawFeePct = 0) {
  const p = Math.max(0, Number(grossMarketUsd) || 0);
  const sFee = Math.max(0, Math.min(50, Number(sellFeePct) || 0));
  const wFee = Math.max(0, Math.min(50, Number(withdrawFeePct) || 0));
  return p * (1 - sFee / 100) * (1 - wFee / 100);
}

/**
 * Quick item-level arbitrage metrics for Scanner & Ticker.
 */
export function evaluateItemMetrics(item, opts) {
  const {
    marketplace = 'CSFLOAT',
    buyFeePct = 0,
    sellFeePct = 2.0,
    withdrawFeePct = 0,
    steamFeeMode = 'EXACT_VALVE',
    steamCustomFeePct = 13.04,
    useBuyOrderForLeg2 = false,
    conservativeSteamPrice = true
  } = opts;

  const steamRaw = Number(item.s) || 0;
  const steam7 = Number(item.s7) || steamRaw;
  const steamUsd = conservativeSteamPrice && steam7 > 0 ? Math.min(steamRaw, steam7) : steamRaw;

  const marketBuyUsd = marketplace === 'YOUPIN' ? Number(item.yp) || 0 : Number(item.cf) || 0;
  const marketSellUsd =
    marketplace === 'YOUPIN'
      ? Number(item.yp) || 0
      : useBuyOrderForLeg2 && item.cfo > 0
      ? Number(item.cfo)
      : Number(item.cf) || 0;

  const effBuy = calcEffectiveBuyUsd(marketBuyUsd, buyFeePct);
  const netSteam = calcNetSteamUsd(steamUsd, steamFeeMode, steamCustomFeePct);
  const m1 = effBuy > 0 && netSteam > 0 ? netSteam / effBuy : 0;
  const leg1ProfitPct = m1 > 0 ? (m1 - 1) * 100 : -100;

  const netSell = calcNetSellUsd(marketSellUsd, sellFeePct, withdrawFeePct);
  const m2 = steamUsd > 0 && netSell > 0 ? netSell / steamUsd : 0;
  const leg2LossPct = m2 > 0 ? (1 - m2) * 100 : 100;

  // Stability ratio (24h vs 30d) to flag spiky/manipulated prices
  const steam30 = Number(item.s30) || steamUsd;
  const spikeRatio = steam30 > 0 ? (steamRaw - steam30) / steam30 : 0;
  const isSpiky = spikeRatio > 0.22 || spikeRatio < -0.22;

  return {
    steamUsd,
    steamRaw,
    marketBuyUsd,
    marketSellUsd,
    effBuy,
    netSteam,
    netSell,
    m1,
    leg1ProfitPct,
    m2,
    leg2LossPct,
    spikeRatio,
    isSpiky,
    hasValidMarket: marketBuyUsd > 0 && steamUsd > 0
  };
}

/**
 * Full 2-Leg Arbitrage + 12-Cycle Compounding Engine (all internal calculations in USD).
 */
export function computeLoopMetrics(params) {
  const {
    capitalUsd = 200,
    pM1Usd = 0,
    pS1Usd = 0,
    pS2Usd = 0,
    pM2Usd = 0,
    buyFeePct = 0,
    sellFeePct = 2.0,
    withdrawFeePct = 0,
    steamFeeMode = 'EXACT_VALVE',
    steamCustomFeePct = 13.04
  } = params;

  const cap0 = Math.max(0, Number(capitalUsd) || 0);
  const effPM1 = calcEffectiveBuyUsd(pM1Usd, buyFeePct);
  const netS1 = calcNetSteamUsd(pS1Usd, steamFeeMode, steamCustomFeePct);
  const exactSteamDetail = calcExactValveSteamFee(pS1Usd);

  const m1 = effPM1 > 0 ? netS1 / effPM1 : 0;
  const leg1ProfitPct = effPM1 > 0 ? (m1 - 1) * 100 : 0;

  const netM2 = calcNetSellUsd(pM2Usd, sellFeePct, withdrawFeePct);
  const m2 = pS2Usd > 0 ? netM2 / pS2Usd : 0;
  const conversionLossPct = pS2Usd > 0 ? (1 - m2) * 100 : 0;

  const mCycle = m1 * m2;
  const netCycleRoiPct = (mCycle - 1) * 100;
  const breakEvenLossLimitPct = m1 > 0 ? (1 - 1 / m1) * 100 : 0;
  const marginOfSafetyPct = breakEvenLossLimitPct - conversionLossPct;

  // 12-Cycle Realistic Integer Wallet Simulation
  let cashWallet = cap0;
  let steamWallet = 0;
  const realisticCycles = [];

  for (let k = 1; k <= 12; k++) {
    const q1 = effPM1 > 0 ? Math.floor(cashWallet / effPM1) : 0;
    const spentM1 = q1 * effPM1;
    cashWallet -= spentM1;
    const cashLeftAfterLeg1 = cashWallet;

    steamWallet += q1 * netS1;
    const steamAfterLeg1 = steamWallet;

    const q2 = pS2Usd > 0 ? Math.floor(steamWallet / pS2Usd) : 0;
    const spentS2 = q2 * pS2Usd;
    steamWallet -= spentS2;

    const cashReturnM2 = q2 * netM2;
    cashWallet += cashReturnM2;

    // TRUE Cash-Equivalent Portfolio: discounts remaining Steam balance by M2
    const steamCashEquiv = steamWallet * (m2 > 0 ? m2 : 0);
    const cashEquivPortfolio = cashWallet + steamCashEquiv;
    const nominalPortfolio = cashWallet + steamWallet;

    const netProfit = cashEquivPortfolio - cap0;
    const netRoiPct = cap0 > 0 ? (netProfit / cap0) * 100 : 0;

    const theoMult = Math.pow(Math.max(0, mCycle), k);
    const theoPortfolio = cap0 * theoMult;

    realisticCycles.push({
      cycle: k,
      days: k * 14,
      weeks: k * 2,
      q1,
      spentM1,
      cashLeftAfterLeg1,
      steamAfterLeg1,
      q2,
      spentS2,
      cashReturnM2,
      cashWallet,
      steamWallet,
      steamCashEquiv,
      cashEquivPortfolio,
      nominalPortfolio,
      netProfit,
      netRoiPct,
      theoMult,
      theoPortfolio,
      theoProfit: theoPortfolio - cap0,
      theoRoiPct: cap0 > 0 ? ((theoPortfolio - cap0) / cap0) * 100 : 0
    });
  }

  return {
    capitalUsd: cap0,
    pM1Usd,
    effPM1,
    pS1Usd,
    netS1,
    exactSteamDetail,
    m1,
    leg1ProfitPct,
    pS2Usd,
    pM2Usd,
    netM2,
    m2,
    conversionLossPct,
    mCycle,
    netCycleRoiPct,
    breakEvenLossLimitPct,
    marginOfSafetyPct,
    firstCycle: realisticCycles[0],
    realisticCycles
  };
}

/**
 * 5x5 Sensitivity Heatmap: How Net Cycle ROI behaves if prices shift during the 7+7 day hold.
 * Rows = Leg 1 Steam Sale Price Shift (%)
 * Cols = Leg 2 External Sell Price Shift (%)
 */
export function computeSensitivityMatrix(baseParams) {
  const shifts = [-8, -4, 0, 4, 8];
  const grid = [];

  for (const s1Shift of shifts) {
    const row = [];
    for (const m2Shift of shifts) {
      const adjPS1 = baseParams.pS1Usd * (1 + s1Shift / 100);
      const adjPM2 = baseParams.pM2Usd * (1 + m2Shift / 100);
      const effPM1 = calcEffectiveBuyUsd(baseParams.pM1Usd, baseParams.buyFeePct);
      const netS1 = calcNetSteamUsd(adjPS1, baseParams.steamFeeMode, baseParams.steamCustomFeePct);
      const netM2 = calcNetSellUsd(adjPM2, baseParams.sellFeePct, baseParams.withdrawFeePct);

      const m1 = effPM1 > 0 ? netS1 / effPM1 : 0;
      const m2 = baseParams.pS2Usd > 0 ? netM2 / baseParams.pS2Usd : 0;
      const roiPct = (m1 * m2 - 1) * 100;
      row.push({
        s1Shift,
        m2Shift,
        roiPct,
        isCenter: s1Shift === 0 && m2Shift === 0
      });
    }
    grid.push(row);
  }

  return { shifts, grid };
}

/**
 * Auto-Pair Finder: Selects top liquid, non-manipulated Leg 1 + Leg 2 combinations.
 */
export function findOptimalPairs(items, opts, capitalUsd = 200) {
  const minQty = opts.marketplace === 'YOUPIN' ? 0 : 20;

  const leg1Candidates = [];
  const leg2Candidates = [];

  for (const item of items) {
    if (opts.marketplace === 'CSFLOAT' && (item.q || 0) < minQty) continue;
    const m = evaluateItemMetrics(item, opts);
    if (!m.hasValidMarket || m.isSpiky) continue;

    // Leg 1: Affordable within capital, healthy liquidity, real positive gain (cap out absurd >65% data glitches)
    if (
      m.effBuy > 0.12 &&
      m.effBuy <= Math.max(capitalUsd * 0.65, 25) &&
      m.leg1ProfitPct >= 4 &&
      m.leg1ProfitPct <= 65
    ) {
      leg1Candidates.push({ item, m });
    }

    // Leg 2: Liquid skin ($3 .. max capital*1.2) with low cashout loss (avoid negative-loss pricing anomalies < -4%)
    if (
      m.steamUsd >= 3 &&
      m.steamUsd <= Math.max(capitalUsd * 1.15, 120) &&
      m.leg2LossPct >= -4 &&
      m.leg2LossPct <= 14
    ) {
      leg2Candidates.push({ item, m });
    }
  }

  leg1Candidates.sort((a, b) => b.m.leg1ProfitPct - a.m.leg1ProfitPct);
  leg2Candidates.sort((a, b) => a.m.leg2LossPct - b.m.leg2LossPct);

  const topL1 = leg1Candidates.slice(0, 6);
  const topL2 = leg2Candidates.slice(0, 6);

  const pairs = [];
  const usedL1 = new Set();

  for (const l1 of topL1) {
    for (const l2 of topL2) {
      if (l1.item.n === l2.item.n) continue;
      const mCycle = l1.m.m1 * l2.m.m2;
      const roiPct = (mCycle - 1) * 100;
      if (roiPct > 0) {
        pairs.push({
          leg1: l1,
          leg2: l2,
          mCycle,
          roiPct
        });
      }
    }
  }

  pairs.sort((a, b) => b.roiPct - a.roiPct);

  // Pick 3 diverse pairs (distinct Leg 1 items where possible)
  const diverse = [];
  for (const p of pairs) {
    if (diverse.length >= 3) break;
    if (!usedL1.has(p.leg1.item.n) || pairs.length < 3) {
      usedL1.add(p.leg1.item.n);
      diverse.push(p);
    }
  }

  return diverse;
}

/**
 * Quant Capital Advisor Engine:
 * Evaluates thousands of real CS2 combinations specifically simulated at the user's
 * exact capital (integer Q1, Q2, leftover Steam trap, CS2 1,000-slot inventory limit,
 * liquidity depth, and volatility) to produce tailored, actionable strategies.
 */
export function getCapitalTierInfo(capitalUsd) {
  const c = Math.max(0, Number(capitalUsd) || 0);
  if (c < 75) {
    return {
      id: 'MICRO',
      badge: 'Mikro Bütçe',
      rangeLabel: '< $75',
      advice:
        'Düşük sermayede pahalı dönüş skinleri Steam bakiyesini içeride kilitler. $0.35–$2.50 likit kasalar + $4–$18 hızlı skinler en verimli sonucu verir.',
      maxL1Price: Math.max(c * 0.5, 4),
      minL1Price: 0.28,
      minL2Price: 2.5,
      maxL2Price: Math.max(c * 0.65, 18),
      maxQ1: 180,
      splitPlan: [
        { pct: 100, role: 'Tek Likit Çift', note: 'Sermayeyi bölmeden yüksek tam-sayı verimi.' }
      ]
    };
  }
  if (c < 400) {
    return {
      id: 'STARTER',
      badge: 'Büyüme Bütçesi',
      rangeLabel: '$75 – $400',
      advice:
        'En akıcı aralık: yüksek makaslı kasalarla Steam bakiyesini büyütüp $15–$60 likit tüfek skinleriyle %92+ verimle nakde dönün.',
      maxL1Price: Math.min(c * 0.28, 45),
      minL1Price: 0.4,
      minL2Price: 10,
      maxL2Price: Math.min(c * 0.45, 95),
      maxQ1: 260,
      splitPlan: [
        { pct: 70, role: 'Ana Kasa / Yüksek Spread', note: 'Güçlü 1. Yön getirisi.' },
        { pct: 30, role: 'İkinci Likit Eşya', note: '7G hold fiyat riskini dengeler.' }
      ]
    };
  }
  if (c < 1500) {
    return {
      id: 'PRO',
      badge: 'Orta-Üst Bütçe',
      rangeLabel: '$400 – $1.500',
      advice:
        'Ucuz kasalardan yüzlerce almak satış süresini uzatır. $2+ birim fiyatlı likit eşyalar ve $45–$240 skinler 14–16 gün içinde rahatça döner.',
      maxL1Price: Math.min(c * 0.25, 220),
      minL1Price: Math.max(1.5, c / 220),
      minL2Price: 25,
      maxL2Price: Math.min(c * 0.4, 300),
      maxQ1: 220,
      splitPlan: [
        { pct: 50, role: 'Orta Bant Yüksek Spread', note: 'Düşük adetle hızlı listeleme.' },
        { pct: 35, role: 'Likit Tüfek / AWP Hattı', note: 'Hızlı Steam likiditesi.' },
        { pct: 15, role: 'Nakit Tampon', note: 'Fırsat ve küsurat tamamlama.' }
      ]
    };
  }
  return {
    id: 'WHALE',
    badge: 'Yüksek Sermaye',
    rangeLabel: '$1.500+',
    advice:
      'Yüksek bütçede binlerce ucuz kasa almak hem 1.000 slot sınırını aşar hem döngüyü haftalarca uzatır. $15+ yüksek hacimli skin, bıçak ve eldivenlerle düşük adetli çalışın.',
    maxL1Price: Math.min(c * 0.25, 800),
    minL1Price: Math.max(8, c / 120),
    minL2Price: 70,
    maxL2Price: Math.min(c * 0.35, 1100),
    maxQ1: 120,
    splitPlan: [
      { pct: 45, role: 'Üst Bant Likit Skin ($15+)', note: 'Az işlem adedi, hızlı çıkış.' },
      { pct: 40, role: 'Bıçak / Eldiven / Covert', note: 'Büyük bakiye taşıma kapasitesi.' },
      { pct: 15, role: 'Buy-Order & Risk Tamponu', note: 'Volatilite ve anlık alım rezervi.' }
    ]
  };
}

/**
 * Estimates real-world execution feasibility, order-book absorption, inventory
 * slot burden, and realistic cycle duration (beyond ideal 14 days).
 */
export function estimateExecutionReality(metrics, item1, item2, opts = {}) {
  const c1 = metrics.firstCycle;
  const q1 = c1.q1 || 0;
  const q2 = c1.q2 || 0;
  const depth1 = Number(item1?.q) || 0;
  const depth2 = Number(item2?.q) || 0;
  const isCSFloat = opts.marketplace !== 'YOUPIN';

  let extraBuyDays = 0;
  let extraSellSteamDays = 0;
  let extraCashoutDays = 0;
  const reasons = [];

  // 1. Extreme quantity / Steam 1,000-slot inventory & listing workload
  const storageUnits = q1 > 1000 ? Math.ceil((q1 - 950) / 1000) : 0;
  if (q1 > 2000) {
    extraBuyDays += Math.min(14, Math.ceil(q1 / 600));
    extraSellSteamDays += Math.min(20, Math.ceil(q1 / 450));
    reasons.push(
      `${q1.toLocaleString('tr-TR')} adet eşya tek seferde alınamaz/satılamaz: ${storageUnits} Storage Unit gerekir, emir defteri taşar ve döngü haftalarca uzar.`
    );
  } else if (q1 > 950) {
    extraBuyDays += 3;
    extraSellSteamDays += 5;
    reasons.push(
      `${q1.toLocaleString('tr-TR')} adet eşya CS2'nin 1.000 envanter slot sınırını aşıyor (${storageUnits} Storage Unit ve parçalı işlem gerekir).`
    );
  } else if (q1 > 350) {
    extraBuyDays += 1;
    extraSellSteamDays += 2;
    reasons.push(
      `${q1.toLocaleString('tr-TR')} adet listeleme yüksek operasyon eforu gerektirir; satış süresi 2–3 gün uzayabilir.`
    );
  } else if (q1 > 120) {
    extraSellSteamDays += 1;
  }

  // 2. Market Order-Book Depth Absorption (Slippage & accumulation time)
  let bookRatio1 = 0;
  if (isCSFloat && depth1 > 0 && q1 > 0) {
    bookRatio1 = (q1 / depth1) * 100;
    if (bookRatio1 > 100) {
      extraBuyDays += Math.min(12, Math.ceil(q1 / Math.max(20, depth1)) * 2);
      reasons.push(
        `1. Yön adet (${q1.toLocaleString('tr-TR')}) mevcut CSFloat ilan derinliğinin (${depth1}) üzerinde! Taban fiyattan alım mümkün değil, fiyat kayması (slippage) yaşanır.`
      );
    } else if (bookRatio1 > 40) {
      extraBuyDays += 2;
      reasons.push(
        `1. Yönde mevcut ilanların %${bookRatio1.toFixed(0)}'ini süpürüyorsunuz; ortalama alış maliyetiniz yükselebilir.`
      );
    }
  }

  // 3. Leg 2 Exit Liquidity & Cashout Speed
  if (opts.useBuyOrderForLeg2) {
    extraCashoutDays += 0;
  } else if (q2 > 25) {
    extraCashoutDays += Math.min(6, Math.ceil(q2 / 15));
    reasons.push(`2. Yönde ${q2} adet skinin nakit pazarda satılması birkaç gün ek süre gerektirebilir.`);
  } else if (isCSFloat && depth2 > 0 && depth2 < 20) {
    extraCashoutDays += 3;
    reasons.push(`2. Yön eşyasının piyasa derinliği düşük (${depth2} ilan); nakde dönüş uzayabilir.`);
  } else if (q2 > 0) {
    extraCashoutDays += 1;
  }

  const totalExtra = extraBuyDays + extraSellSteamDays + extraCashoutDays;
  const minDays = 14 + Math.floor(totalExtra * 0.6);
  const maxDays = 14 + Math.max(totalExtra, 1);

  let level = 'smooth'; // 'smooth' | 'moderate' | 'slow' | 'impractical'
  let label = 'Akıcı (~14–15 Gün)';
  let pillCls = 'pill-mint';

  if (q1 > 1500 || bookRatio1 > 120 || maxDays >= 28) {
    level = 'impractical';
    label = `Pratik Değil (~${minDays}–${maxDays}+ Gün)`;
    pillCls = 'pill-crimson';
  } else if (q1 > 500 || bookRatio1 > 50 || maxDays >= 20) {
    level = 'slow';
    label = `Süre Uzar (~${minDays}–${maxDays} Gün)`;
    pillCls = 'pill-amber';
  } else if (totalExtra >= 2) {
    level = 'moderate';
    label = `Orta Efor (~${minDays}–${maxDays} Gün)`;
    pillCls = 'pill-gold';
  }

  return {
    level,
    label,
    pillCls,
    minDays,
    maxDays,
    extraDays: totalExtra,
    storageUnits,
    bookRatio1,
    reasons,
    needsUpperTierSuggestion: level === 'impractical' || level === 'slow'
  };
}

export function analyzeCapitalStrategies(items, opts, capitalUsd = 200) {
  const cap = Math.max(5, Number(capitalUsd) || 200);
  const tier = getCapitalTierInfo(cap);
  const isCSFloat = opts.marketplace === 'CSFLOAT';

  const leg1Pool = [];
  const leg2Pool = [];

  for (const item of items) {
    const qty = Number(item.q) || 0;
    if (isCSFloat && qty < 18) continue;

    const m = evaluateItemMetrics(item, opts);
    if (!m.hasValidMarket || m.isSpiky) continue;

    // Leg 1: strictly realistic executable quantities & order-book depth guard
    if (
      m.effBuy >= tier.minL1Price &&
      m.effBuy <= Math.max(tier.maxL1Price, cap * 0.5) &&
      m.leg1ProfitPct >= 2.5 &&
      m.leg1ProfitPct <= 62
    ) {
      const q1Est = Math.floor(cap / m.effBuy);
      const bookOk = !isCSFloat || q1Est <= Math.max(15, qty * 0.55);
      if (q1Est >= 1 && q1Est <= tier.maxQ1 && bookOk) {
        leg1Pool.push({ item, m, qty, q1Est });
      }
    }

    // Leg 2: liquid exit skin matched to budget
    if (
      m.steamUsd >= tier.minL2Price &&
      m.steamUsd <= Math.max(tier.maxL2Price, cap * 0.95) &&
      m.leg2LossPct >= -3 &&
      m.leg2LossPct <= 14.5
    ) {
      leg2Pool.push({ item, m, qty });
    }
  }

  // Graceful fallback if high budget has few narrow matches
  if (leg1Pool.length < 3 || leg2Pool.length < 3) {
    for (const item of items) {
      const qty = Number(item.q) || 0;
      if (isCSFloat && qty < 8) continue;
      const m = evaluateItemMetrics(item, opts);
      if (!m.hasValidMarket || m.isSpiky) continue;
      const q1Est = m.effBuy > 0 ? Math.floor(cap / m.effBuy) : 0;
      if (
        leg1Pool.length < 12 &&
        m.effBuy >= Math.max(0.25, cap / 450) &&
        m.effBuy <= cap &&
        q1Est >= 1 &&
        q1Est <= 450 &&
        m.leg1ProfitPct > 1 &&
        m.leg1ProfitPct <= 65
      ) {
        if (!leg1Pool.some((x) => x.item.n === item.n)) {
          leg1Pool.push({ item, m, qty, q1Est });
        }
      }
      if (leg2Pool.length < 12 && m.steamUsd >= 1 && m.steamUsd <= cap * 1.1 && m.leg2LossPct <= 16) {
        if (!leg2Pool.some((x) => x.item.n === item.n)) {
          leg2Pool.push({ item, m, qty });
        }
      }
    }
  }

  leg1Pool.sort((a, b) => b.m.leg1ProfitPct - a.m.leg1ProfitPct);
  leg2Pool.sort((a, b) => a.m.leg2LossPct - b.m.leg2LossPct);

  const topL1 = leg1Pool.slice(0, 14);
  const topL2 = leg2Pool.slice(0, 14);
  const liquidL1 = [...leg1Pool].sort((a, b) => b.qty - a.qty).slice(0, 10);
  const liquidL2 = [...leg2Pool].sort((a, b) => b.qty - a.qty).slice(0, 10);

  const l1Candidates = Array.from(new Map([...topL1, ...liquidL1].map((x) => [x.item.n, x])).values());
  const l2Candidates = Array.from(new Map([...topL2, ...liquidL2].map((x) => [x.item.n, x])).values());

  const evaluatedPairs = [];

  for (const l1 of l1Candidates) {
    for (const l2 of l2Candidates) {
      if (l1.item.n === l2.item.n) continue;

      const sim = computeLoopMetrics({
        capitalUsd: cap,
        pM1Usd: l1.m.marketBuyUsd,
        pS1Usd: l1.m.steamUsd,
        pS2Usd: l2.m.steamUsd,
        pM2Usd: l2.m.marketSellUsd,
        buyFeePct: opts.buyFeePct,
        sellFeePct: opts.sellFeePct,
        withdrawFeePct: opts.withdrawFeePct,
        steamFeeMode: opts.steamFeeMode,
        steamCustomFeePct: opts.steamCustomFeePct
      });

      const c1 = sim.firstCycle;
      if (c1.q1 <= 0 || c1.q2 <= 0) continue;

      const reality = estimateExecutionReality(sim, l1.item, l2.item, opts);
      const utilizedPct = c1.steamAfterLeg1 > 0 ? ((c1.steamAfterLeg1 - c1.steamWallet) / c1.steamAfterLeg1) * 100 : 0;
      const minDepth = isCSFloat ? Math.min(l1.qty, l2.qty) : 80;
      const liquidityScore = Math.min(100, Math.round(Math.log10(Math.max(10, minDepth)) * 36));
      // Daily annualized speed metric: ROI normalized by realistic days!
      const roiPer14d = c1.netRoiPct * (14 / Math.max(14, reality.maxDays));

      evaluatedPairs.push({
        leg1: l1,
        leg2: l2,
        sim,
        c1,
        reality,
        utilizedPct,
        minDepth,
        liquidityScore,
        roiPer14d
      });
    }
  }

  const pickBest = (scorer, excludeNames = new Set()) => {
    let best = null;
    let bestScore = -Infinity;
    for (const p of evaluatedPairs) {
      if (p.c1.netProfit <= 0) continue;
      const key = `${p.leg1.item.n}|${p.leg2.item.n}`;
      if (excludeNames.has(key)) continue;
      const score = scorer(p);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  };

  const usedKeys = new Set();
  const strategies = [];

  // Strategy 1: Max Speed-Adjusted Realistic Net Profit
  const maxProfit = pickBest(
    (p) => p.roiPer14d + p.utilizedPct * 0.08 - (p.reality.level === 'impractical' ? 40 : 0),
    usedKeys
  );
  if (maxProfit) {
    usedKeys.add(`${maxProfit.leg1.item.n}|${maxProfit.leg2.item.n}`);
    strategies.push({
      id: 'MAX_PROFIT',
      tag: 'MAKSİMUM KÂR',
      tagCls: 'pill-mint',
      title: 'En Yüksek Gerçekçi Getiri',
      reason: `~${maxProfit.reality.minDays}–${maxProfit.reality.maxDays} günde ${maxProfit.c1.q1}x → ${maxProfit.c1.q2}x gerçekçi işlemle en yüksek net kâr.`,
      pair: maxProfit
    });
  }

  // Strategy 2: Fast & Ultra-Liquid (Lowest Effort)
  const fastSafe = pickBest(
    (p) =>
      p.liquidityScore * 0.5 +
      p.roiPer14d * 0.85 -
      p.reality.extraDays * 2.5 +
      (p.c1.q1 <= 80 ? 14 : 0),
    usedKeys
  );
  if (fastSafe) {
    usedKeys.add(`${fastSafe.leg1.item.n}|${fastSafe.leg2.item.n}`);
    strategies.push({
      id: 'FAST_SAFE',
      tag: 'HIZLI & KOLAY',
      tagCls: 'pill-ice',
      title: 'En Az Efor & Yüksek Likidite',
      reason: `Sadece ${fastSafe.c1.q1} adet alım + ${fastSafe.minDepth}+ ilan derinliği ile ~${fastSafe.reality.minDays}–${fastSafe.reality.maxDays} günde akıcı döngü.`,
      pair: fastSafe
    });
  }

  // Strategy 3: Highest Capital Efficiency (Minimal Steam Leftover)
  const maxEff = pickBest(
    (p) => p.utilizedPct * 1.45 + p.roiPer14d * 0.7 - p.reality.extraDays * 1.5,
    usedKeys
  );
  if (maxEff) {
    usedKeys.add(`${maxEff.leg1.item.n}|${maxEff.leg2.item.n}`);
    strategies.push({
      id: 'MAX_EFFICIENCY',
      tag: 'YÜKSEK VERİM',
      tagCls: 'pill-gold',
      title: 'En Az Atıl Steam Bakiyesi',
      reason: `Steam bakiyesinin %${maxEff.utilizedPct.toFixed(1)}'i anında nakde döner; içeride bakiye kilitlenmez.`,
      pair: maxEff
    });
  }

  return {
    tier,
    strategies,
    bestBenchmark: maxProfit || fastSafe || maxEff || null
  };
}

/**
 * Generates real-time operational & financial diagnostics comparing user's desk
 * setup against real execution limits, order-book depth, and budget optimal benchmark.
 */
export function diagnoseCurrentSetup(metrics, advisorResult, reality) {
  const c1 = metrics.firstCycle;
  const alerts = [];

  if (c1.q1 === 0) {
    return [
      {
        level: 'danger',
        text: 'Başlangıç sermayesi 1 adet 1. yön eşyası almaya yetmiyor. Bütçene uygun stratejilerden birini tek tıkla uygula.'
      }
    ];
  }

  if (reality && reality.reasons.length > 0) {
    for (const reason of reality.reasons) {
      alerts.push({
        level: reality.level === 'impractical' ? 'danger' : 'warn',
        text: reason
      });
    }
  }

  const trappedSteamPct = c1.steamAfterLeg1 > 0 ? (c1.steamWallet / c1.steamAfterLeg1) * 100 : 0;
  if (c1.q2 === 0) {
    alerts.push({
      level: 'danger',
      text: 'Steam bakiyesi 2. yön eşyasından 1 adet almaya yetmiyor. Daha uygun fiyatlı bir dönüş skini seç.'
    });
  } else if (trappedSteamPct > 18) {
    alerts.push({
      level: 'warn',
      text: `Steam bakiyenin %${trappedSteamPct.toFixed(1)}'i dönüş eşyasına yetmediği için içeride kalıyor. Birim fiyatı daha uygun bir 2. yön skini verimi artırır.`
    });
  }

  if (metrics.netCycleRoiPct <= 0) {
    alerts.push({
      level: 'danger',
      text: 'Mevcut komisyonlarla bu çift kâr üretmiyor (M₁ × M₂ ≤ 1.00). Önerilen stratejilerden birini seç.'
    });
  } else if (advisorResult?.bestBenchmark && alerts.length === 0) {
    const diff = advisorResult.bestBenchmark.c1.netProfit - c1.netProfit;
    if (diff > Math.max(2, metrics.capitalUsd * 0.035)) {
      alerts.push({
        level: 'info',
        text: `Bütçe İpucu: "${advisorResult.bestBenchmark.leg1.item.n} → ${advisorResult.bestBenchmark.leg2.item.n}" ile aynı sermayede +$${diff.toFixed(2)} daha fazla gerçekçi kâr mümkün.`
      });
    } else {
      alerts.push({
        level: 'good',
        text: `Gerçekçi & Optimize: %${(100 - trappedSteamPct).toFixed(1)} aktif sermaye verimi, tahmini süre ${reality?.minDays || 14}–${reality?.maxDays || 15} gün.`
      });
    }
  }

  return alerts;
}
