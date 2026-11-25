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
