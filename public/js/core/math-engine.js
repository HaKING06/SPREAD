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
        'Bu bütçede pahalı dönüş skinleri Steam cüzdanında yüksek küsurat bırakır. $0.40–$2.50 arası likit kasalar + $4–$18 hızlı skinler en yüksek sermaye verimini sağlar.',
      maxL1Price: Math.max(c * 0.5, 4),
      minL1Price: 0.28, // avoid $0.01+$0.01 min fee traps
      minL2Price: 2.5,
      maxL2Price: Math.max(c * 0.65, 18),
      maxSlots: 300,
      splitPlan: [
        { pct: 100, role: 'Tek Odaklı Likit Çift', note: 'Düşük sermayeyi bölmeden maksimum tam sayı adet (Q₁, Q₂) yakalayın.' }
      ]
    };
  }
  if (c < 400) {
    return {
      id: 'STARTER',
      badge: 'Büyüme Bütçesi',
      rangeLabel: '$75 – $400',
      advice:
        'Arbitraj için en akıcı aralık! Yüksek makaslı CS2 kasalarıyla Steam bakiyesini büyütüp $15–$55 arası çok likit tüfek skinleriyle (Redline, Printstream vb.) %92+ sermaye verimiyle nakde dönebilirsiniz.',
      maxL1Price: Math.min(c * 0.25, 40),
      minL1Price: 0.35,
      minL2Price: 8,
      maxL2Price: Math.min(c * 0.45, 90),
      maxSlots: 600,
      splitPlan: [
        { pct: 70, role: 'Ana Kasa / Yüksek Makas', note: 'En güçlü 1. Yön spread getirisini yakalar.' },
        { pct: 30, role: 'İkinci Likit Eşya', note: 'Tek eşyanın 7G hold fiyat düşüş riskini dengeler.' }
      ]
    };
  }
  if (c < 1500) {
    return {
      id: 'PRO',
      badge: 'Orta-Üst Bütçe',
      rangeLabel: '$400 – $1.500',
      advice:
        'Bu sermayede çok ucuz kasalar 1.000 envanter slot sınırına dayanır ve satışı yavaşlatır. Birim fiyatı $1.20+ kasa/skinler ile $45–$220 arası yüksek hacimli skinler hem hızlı hem slot dostudur.',
      maxL1Price: Math.min(c * 0.22, 180),
      minL1Price: 0.8,
      minL2Price: 25,
      maxL2Price: Math.min(c * 0.35, 280),
      maxSlots: 650,
      splitPlan: [
        { pct: 50, role: 'Ana Yüksek Makas Sepeti', note: 'Envanter dostu ($1+ birim fiyatlı) yüksek hacimli kasalar.' },
        { pct: 35, role: 'Orta Bant Likit Skin', note: 'Hızlı Steam satışı ve düşük listeleme eforu.' },
        { pct: 15, role: 'Nakit Fırsat Tamponu', note: 'Ani düşüşlerde (snipe) veya 2. yön küsurat tamamlamada kullanılır.' }
      ]
    };
  }
  return {
    id: 'WHALE',
    badge: 'Yüksek Sermaye / Desk',
    rangeLabel: '$1.500+',
    advice:
      'Yüksek sermayede tek bir ucuz eşyaya girmek hem 1.000 CS2 slot sınırını aşar hem emir defterini bozar. Sermayeyi 3 farklı likit banda (orta-üst skin, bıçak/eldiven, premium kasa) bölün.',
    maxL1Price: Math.min(c * 0.2, 600),
    minL1Price: Math.max(2.0, c / 600),
    minL2Price: 60,
    maxL2Price: Math.min(c * 0.35, 900),
    maxSlots: 550,
    splitPlan: [
      { pct: 45, role: 'Yüksek Hacimli Premium Kasa / Skin', note: 'Slot limitini aşmayan $3–$50 arası likit eşyalar.' },
      { pct: 40, role: 'Bıçak / Covert Likit Nakit Hattı', note: 'Az işlem adediyle büyük bakiye taşıma.' },
      { pct: 15, role: 'Risk Tamponu & Buy Order', note: 'Volatilite ve anlık fırsat rezervi.' }
    ]
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

    // Leg 1 candidates adapted to capital tier
    if (
      m.effBuy >= tier.minL1Price &&
      m.effBuy <= Math.max(tier.maxL1Price, cap * 0.5) &&
      m.leg1ProfitPct >= 3 &&
      m.leg1ProfitPct <= 62
    ) {
      const q1Est = Math.floor(cap / m.effBuy);
      if (q1Est >= 1 && q1Est <= 950) {
        leg1Pool.push({ item, m, qty, q1Est });
      }
    }

    // Leg 2 candidates adapted to capital tier
    if (
      m.steamUsd >= tier.minL2Price &&
      m.steamUsd <= Math.max(tier.maxL2Price, cap * 0.95) &&
      m.leg2LossPct >= -3 &&
      m.leg2LossPct <= 14.5
    ) {
      leg2Pool.push({ item, m, qty });
    }
  }

  // Fallback relaxation if strict tier filters produced too few candidates
  if (leg1Pool.length < 3 || leg2Pool.length < 3) {
    for (const item of items) {
      const qty = Number(item.q) || 0;
      if (isCSFloat && qty < 8) continue;
      const m = evaluateItemMetrics(item, opts);
      if (!m.hasValidMarket || m.isSpiky) continue;
      if (leg1Pool.length < 10 && m.effBuy >= 0.2 && m.effBuy <= cap && m.leg1ProfitPct > 1 && m.leg1ProfitPct <= 65) {
        if (!leg1Pool.some((x) => x.item.n === item.n)) {
          leg1Pool.push({ item, m, qty, q1Est: Math.floor(cap / m.effBuy) });
        }
      }
      if (leg2Pool.length < 10 && m.steamUsd >= 1 && m.steamUsd <= cap * 1.1 && m.leg2LossPct <= 16) {
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

  // Also grab ultra-liquid candidates for the Fast/Safe strategy
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

      const utilizedPct = c1.steamAfterLeg1 > 0 ? ((c1.steamAfterLeg1 - c1.steamWallet) / c1.steamAfterLeg1) * 100 : 0;
      const minDepth = isCSFloat ? Math.min(l1.qty, l2.qty) : 80;
      const slotSafe = c1.q1 <= tier.maxSlots;
      const liquidityScore = Math.min(100, Math.round(Math.log10(Math.max(10, minDepth)) * 36));

      evaluatedPairs.push({
        leg1: l1,
        leg2: l2,
        sim,
        c1,
        utilizedPct,
        minDepth,
        slotSafe,
        liquidityScore
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

  // Strategy 1: Max Realistic Profit (with slot safety penalty)
  const maxProfit = pickBest(
    (p) => p.c1.netRoiPct * (p.slotSafe ? 1 : 0.72) + p.utilizedPct * 0.08,
    usedKeys
  );
  if (maxProfit) {
    usedKeys.add(`${maxProfit.leg1.item.n}|${maxProfit.leg2.item.n}`);
    strategies.push({
      id: 'MAX_PROFIT',
      tag: 'MAKSİMUM KÂR',
      tagCls: 'pill-mint',
      title: 'En Yüksek 14 Günlük Net Getiri',
      reason: `Bu bütçede 1. döngüde en yüksek nakit eşdeğeri kârı (${maxProfit.c1.q1}x → ${maxProfit.c1.q2}x) üreten kombinasyon.`,
      pair: maxProfit
    });
  }

  // Strategy 2: Fast & Ultra-Liquid (Safest Execution)
  const fastSafe = pickBest(
    (p) =>
      p.liquidityScore * 0.45 +
      p.c1.netRoiPct * 0.9 +
      (p.c1.q1 <= 260 ? 12 : 0) +
      (p.utilizedPct >= 88 ? 8 : 0),
    usedKeys
  );
  if (fastSafe) {
    usedKeys.add(`${fastSafe.leg1.item.n}|${fastSafe.leg2.item.n}`);
    strategies.push({
      id: 'FAST_SAFE',
      tag: 'HIZLI & GÜVENLİ',
      tagCls: 'pill-ice',
      title: 'Yüksek Likidite & Hızlı Satış',
      reason: `En az ${fastSafe.minDepth} aktif ilan derinliği ve düşük listeleme yükü (${fastSafe.c1.q1} adet) ile güvenli nakit dönüş.`,
      pair: fastSafe
    });
  }

  // Strategy 3: Highest Capital Efficiency (Minimal Steam Leftover)
  const maxEff = pickBest(
    (p) => p.utilizedPct * 1.4 + p.c1.netRoiPct * 0.75 + (p.slotSafe ? 10 : 0),
    usedKeys
  );
  if (maxEff) {
    usedKeys.add(`${maxEff.leg1.item.n}|${maxEff.leg2.item.n}`);
    strategies.push({
      id: 'MAX_EFFICIENCY',
      tag: 'DENGELİ VERİM',
      tagCls: 'pill-gold',
      title: 'En Az Atıl Steam Bakiyesi',
      reason: `Steam bakiyenizin %${maxEff.utilizedPct.toFixed(1)}'ini anında 2. yöne çevirerek içeride kilitli bakiye bırakmaz.`,
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
 * Generates real-time actionable diagnostics comparing user's current Desk selection
 * against real CS2 operational constraints & the budget's optimal benchmark.
 */
export function diagnoseCurrentSetup(metrics, advisorResult) {
  const c1 = metrics.firstCycle;
  const alerts = [];

  if (c1.q1 === 0) {
    return [
      {
        level: 'danger',
        text: 'Başlangıç sermayesi 1 adet 1. yön eşyası almaya yetmiyor. Bütçenize uygun önerilen stratejilerden birini tek tıkla yükleyebilirsiniz.'
      }
    ];
  }

  if (c1.q1 > 950) {
    alerts.push({
      level: 'danger',
      text: `Envanter Limiti Uyarısı: ${c1.q1} adet eşya CS2'nin 1.000 slotluk envanter sınırını aşıyor. Birim fiyatı daha yüksek bir 1. yön eşyası seçin.`
    });
  } else if (c1.q1 > 450) {
    alerts.push({
      level: 'warn',
      text: `Yüksek İşlem Yükü: ${c1.q1} adet eşyayı tek tek Steam'de listelemek zaman alır. Bütçeniz için daha az adetli üst bant eşyalar daha pratiktir.`
    });
  }

  const trappedSteamPct = c1.steamAfterLeg1 > 0 ? (c1.steamWallet / c1.steamAfterLeg1) * 100 : 0;
  if (c1.q2 === 0) {
    alerts.push({
      level: 'danger',
      text: '1. yön sonunda oluşan Steam bakiyesi 2. yön dönüş eşyasından 1 adet bile almaya yetmiyor. Daha uygun fiyatlı bir 2. yön skini seçin.'
    });
  } else if (trappedSteamPct > 18) {
    alerts.push({
      level: 'warn',
      text: `Atıl Bakiye Uyarısı: Steam bakiyenizin %${trappedSteamPct.toFixed(1)}'i dönüş eşyasına yetmediği için içeride kilitli kalıyor. Birim fiyatı daha düşük bir 2. yön skini verimi artırır.`
    });
  }

  if (metrics.netCycleRoiPct <= 0) {
    alerts.push({
      level: 'danger',
      text: 'Bu eşleşme mevcut komisyonlarla kâr üretmiyor (M₁ × M₂ ≤ 1.00). Aşağıdaki bütçenize özel stratejilerden birini seçin.'
    });
  } else if (advisorResult?.bestBenchmark) {
    const diff = advisorResult.bestBenchmark.c1.netProfit - c1.netProfit;
    if (diff > Math.max(2, metrics.capitalUsd * 0.03)) {
      alerts.push({
        level: 'info',
        text: `Fırsat İpucu: Aynı sermayeyle "${advisorResult.bestBenchmark.leg1.item.n} → ${advisorResult.bestBenchmark.leg2.item.n}" stratejisi 1. döngüde tahmini +$${diff.toFixed(2)} daha fazla kâr potansiyeli sunuyor.`
      });
    } else if (alerts.length === 0) {
      alerts.push({
        level: 'good',
        text: `Optimize Kurulum: Sermayenizin %${(100 - trappedSteamPct).toFixed(1)}'i aktif dönüyor ve bütçe katmanınız (${advisorResult.tier.badge}) için güçlü verim bandındasınız.`
      });
    }
  }

  return alerts;
}
