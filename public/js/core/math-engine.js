/**
 * SPREAD (spread.haking.tr) — Quantitative CS2 Arbitrage, Sales Velocity & Confidence Engine
 *
 * V2 Quant Upgrades:
 *  1. Exact Valve cent-by-cent Steam fee solver ($0.01 + $0.01 min fee trap detector)
 *  2. True cash-equivalent portfolio valuation (cashWallet + steamWallet * M2)
 *  3. Real Sales Velocity Profiler (24h/7d/30d Skinport + Market.CSGO + CSFloat Bid/Ask)
 *  4. Pattern/Float Overpay Anomaly Guard (Doppler/Crimson Web/Fade/Case Hardened + 30d cap)
 *  5. Pair Confidence Score (0-100%) + Honest Dynamic Tagging + Bilingual (EN/TR) Insights
 */

import { isTr } from './i18n.js';

const PATTERN_SENSITIVE_RE =
  /\b(Crimson Web|Case Hardened|Doppler|Gamma Doppler|Marble Fade|Slaughter|Blue Phosphor|Fade|Tiger Tooth)\b/i;

const bi = (en, tr) => (isTr() ? tr : en);

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

export function calcNetSteamUsd(grossSteamUsd, steamFeeMode = 'EXACT_VALVE', customFeePct = 13.04) {
  const p = Math.max(0, Number(grossSteamUsd) || 0);
  if (p <= 0) return 0;
  if (steamFeeMode === 'EXACT_VALVE') return calcExactValveSteamFee(p).netUsd;
  if (steamFeeMode === 'DIV_115') return p / 1.15;
  const fee = Math.max(0, Math.min(99, Number(customFeePct) || 0));
  return p * (1 - fee / 100);
}

export function calcEffectiveBuyUsd(grossMarketUsd, buyFeePct = 0) {
  const p = Math.max(0, Number(grossMarketUsd) || 0);
  const fee = Math.max(0, Math.min(50, Number(buyFeePct) || 0));
  return p * (1 + fee / 100);
}

export function calcNetSellUsd(grossMarketUsd, sellFeePct = 2.0, withdrawFeePct = 0) {
  const p = Math.max(0, Number(grossMarketUsd) || 0);
  const sFee = Math.max(0, Math.min(50, Number(sellFeePct) || 0));
  const wFee = Math.max(0, Math.min(50, Number(withdrawFeePct) || 0));
  return p * (1 - sFee / 100) * (1 - wFee / 100);
}

/**
 * Real-World Sales Velocity, Dollar Liquidity & Quantity-Relative Fill-Time Profiler (V3)
 */
export function computeVelocityProfile(item) {
  if (!item) {
    return {
      tier: 'C',
      score: 45,
      label: bi('Unknown', 'Bilinmiyor'),
      shortLabel: bi('Unknown', 'Belirsiz'),
      pillCls: 'pill-muted',
      sold24h: 0,
      sold7d: 0,
      sold30d: 0,
      mktVol: 0,
      weeklyUsd: 0,
      estDailySales: 0.5,
      bidAskPct: 0,
      estWeeklyCap: 20,
      extraSellDays: 2,
      slowWarning: '',
      volText: bi('No volume data', 'Hacim verisi yok'),
      isKnifeOrGlove: false,
      isPatternSensitive: false,
      isLiquidHighTicket: false
    };
  }

  const v24 = Number(item.v24) || 0;
  const v7 = Number(item.v7) || 0;
  const v30 = Number(item.v30) || 0;
  const mv = Number(item.mv) || 0;
  const q = Number(item.q) || 0;
  const cf = Number(item.cf) || 0;
  const cfo = Number(item.cfo) || 0;
  const steamUsd = Number(item.s) || 0;
  const priceRef = Math.max(cf, steamUsd);
  const bidAskPct = cf > 0 && cfo > 0 ? (cfo / cf) * 100 : 0;

  const sp7 = Math.max(v7, Math.round(v30 / 4.3));
  const weeklyUsd = Math.round(sp7 * priceRef);

  // V5 Bayesian Winsorized Multi-Window True Daily Volume:
  // Prevents a single noisy 24h spike from outweighing stronger 7d/30d + order-book depth.
  const rate30 = v30 / 30;
  const rate7 = v7 / 7;
  const rate24Capped = Math.min(v24, Math.max(rate7, rate30, 0.5) * 1.65 + 1);
  const spDaily = rate30 * 0.45 + rate7 * 0.40 + rate24Capped * 0.15;
  const depthDaily = q > 0 ? (q / 25) * (bidAskPct >= 92 ? 1.0 : bidAskPct >= 88 ? 0.65 : 0.25) : 0;
  const estDailySales = Math.max(0.08, Math.round((spDaily * 1.9 + (mv / 14) * 0.45 + depthDaily * 0.3) * 100) / 100);

  const isKnifeOrGlove = item.c === 'Knives' || item.c === 'Gloves';
  const isCapsule = item.c === 'Capsule';
  const isStatTrak = Boolean(item.st);
  const isSouvenir = Boolean(item.sv);
  const isPatternSensitive = PATTERN_SENSITIVE_RE.test(item.n || '');

  // High-ticket liquid asset (e.g. popular $100-$500 rifles, knives, gloves selling ~1+/day with deep CSFloat book)
  const isLiquidHighTicket =
    priceRef >= 60 &&
    (sp7 >= 5 || v30 >= 22) &&
    q >= 40 &&
    (bidAskPct === 0 || bidAskPct >= 88);

  let score = 0;
  // Unit velocity (logarithmic)
  score += Math.min(42, Math.log10(sp7 + 1) * 25);
  score += Math.min(26, Math.log10(mv + 1) * 12);
  // Dollar liquidity bonus (critical for $60-$500 liquid rifles, knives & gloves)
  if (weeklyUsd >= 3000) score += 18;
  else if (weeklyUsd >= 1200) score += 14;
  else if (weeklyUsd >= 500) score += 9;
  else if (weeklyUsd >= 150) score += 4;
  // Order-book depth & active 24h pulse
  if (q >= 150) score += 8;
  else if (q >= 60) score += 5;
  else if (q >= 25) score += 2;
  if (v24 >= 5) score += 6;
  else if (v24 >= 1) score += 3;
  // CSFloat Bid/Ask tightness
  if (bidAskPct >= 92) score += 8;
  else if (bidAskPct >= 88) score += 5;
  else if (bidAskPct > 0 && bidAskPct < 80) score -= 18;

  // Penalize truly illiquid traps
  if (isCapsule && sp7 < 25) score -= 30;
  if (isSouvenir && sp7 < 20) score -= 28;
  if (isStatTrak && sp7 < 15 && mv < 90) score -= 22;
  if (isKnifeOrGlove && sp7 < 4) score -= 16;
  if (steamUsd >= 200 && sp7 < 3 && q < 25) score -= 14;

  score = Math.max(0, Math.min(100, Math.round(score)));

  let tier = 'D';
  let label = bi('Illiquid', 'Zor Satılır');
  let shortLabel = bi('Slow', 'Yavaş');
  let pillCls = 'pill-crimson';
  let extraSellDays = 8;
  let slowWarning = '';

  if (!isKnifeOrGlove && score >= 76 && (sp7 >= 18 || mv >= 200) && (mv >= 30 || weeklyUsd >= 800)) {
    tier = 'A';
    label = bi('Sells Instantly', 'Çok Hızlı');
    shortLabel = bi('Ultra Fast', 'Çok Hızlı');
    pillCls = 'pill-mint';
    extraSellDays = 0;
  } else if (
    (score >= 58 && (sp7 >= 7 || mv >= 65) && (mv >= 25 || weeklyUsd >= 450)) ||
    (isLiquidHighTicket && score >= 60)
  ) {
    tier = 'B';
    label = bi('Fast', 'Hızlı');
    shortLabel = bi('Fast', 'Hızlı');
    pillCls = 'pill-ice';
    extraSellDays = isKnifeOrGlove ? 1 : 1;
    if (isKnifeOrGlove && sp7 < 7) {
      slowWarning = bi(
        `7d: ${v7} sales (~${estDailySales.toFixed(1)}/day) • Liquid knife/glove; 1 unit typically sells in 1–3 days`,
        `7g: ${v7} satış (günde ~${estDailySales.toFixed(1)}) • Popüler bıçak/eldiven; 1 adet genelde 1–3 günde satılır`
      );
    }
  } else if (score >= 38 && (sp7 >= 3 || mv >= 25 || (isKnifeOrGlove && sp7 >= 2 && q >= 25))) {
    tier = 'C';
    label = bi('Moderate', 'Orta Hız');
    shortLabel = bi('Moderate', 'Orta');
    pillCls = 'pill-amber';
    extraSellDays = isKnifeOrGlove || steamUsd >= 180 ? 5 : 3;
    slowWarning = isKnifeOrGlove
      ? bi(
          `7d: ${v7} sales • High margin, but selling on Steam may take a few extra days`,
          `7g: ${v7} satış • Yüksek kâr, ancak Steam satışı birkaç gün uzayabilir`
        )
      : bi(
          `7d: ${v7} sales • Moderate demand; allow a few extra days to sell`,
          `7g: ${v7} satış • Satış hızı orta, birkaç gün bekletebilir`
        );
  } else {
    tier = 'D';
    label = bi('Illiquid', 'Zor Satılır');
    shortLabel = bi('Trap', 'Tuzak');
    pillCls = 'pill-crimson';
    extraSellDays = 14;
    slowWarning = bi(
      `7d: ${v7} sales • Very low demand, high risk of getting stuck`,
      `7g: ${v7} satış • Çok düşük talep, elinde kalma riski yüksek`
    );
  }

  const estWeeklyCap = Math.max(
    4,
    Math.round(sp7 * 3.5 + mv * 0.45 + (item.c === 'Case' && mv > 500 ? mv * 0.5 : 0))
  );

  const volText =
    v24 > 0
      ? bi(`24h: ${v24} • 7d: ${v7} sold`, `24s: ${v24} • 7g: ${v7} satış`)
      : v7 > 0
      ? bi(`7d: ${v7} • 30d: ${v30} sold`, `7g: ${v7} • 30g: ${v30} satış`)
      : mv > 0
      ? bi(`Vol: ${mv} • 30d: ${v30}`, `Hacim: ${mv} • 30g: ${v30}`)
      : bi('Low volume', 'Düşük hacim');

  return {
    tier,
    score,
    label,
    shortLabel,
    pillCls,
    sold24h: v24,
    sold7d: v7,
    sold30d: v30,
    mktVol: mv,
    weeklyUsd,
    estDailySales,
    bidAskPct,
    estWeeklyCap,
    extraSellDays,
    slowWarning,
    volText,
    isKnifeOrGlove,
    isPatternSensitive,
    isLiquidHighTicket
  };
}

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
  const steam30 = Number(item.s30) || steam7;
  const steam90 = Number(item.s90) || steam30;

  // V4 Anti-Manipulation Price Guard: min(24h, 7d, 30d * 1.12) eliminates artificial spikes
  let steamUsd = steamRaw;
  if (conservativeSteamPrice) {
    const candidates = [steamRaw];
    if (steam7 > 0) candidates.push(steam7);
    if (steam30 > 0) candidates.push(steam30 * 1.12);
    steamUsd = Math.min(...candidates);
  }

  const marketBuyUsd = marketplace === 'YOUPIN' ? Number(item.yp) || 0 : Number(item.cf) || 0;
  const marketSellUsd =
    marketplace === 'YOUPIN'
      ? Number(item.yp) || 0
      : useBuyOrderForLeg2 && item.cfo > 0
      ? Number(item.cfo)
      : Number(item.cf) || 0;

  // Buff163 Global Cash Anchor (undervalued vs global benchmark detection)
  const buff163Usd = Number(item.b) || 0;
  const buff163OrderUsd = Number(item.bo) || 0;
  const vsBuffPct = buff163Usd > 0 && marketBuyUsd > 0 ? ((marketBuyUsd - buff163Usd) / buff163Usd) * 100 : null;
  const isBelowBuff = vsBuffPct !== null && vsBuffPct <= 2.5;
  const isOverBuff = vsBuffPct !== null && vsBuffPct > 12;

  // 90d -> 30d -> 7d Trend Momentum & Crash-Trap Shield
  const trendPct30 = steam30 > 0 ? ((steam7 - steam30) / steam30) * 100 : 0;
  const trendPct90 = steam90 > 0 ? ((steam30 - steam90) / steam90) * 100 : 0;
  let trendStatus = 'STABLE';
  if (trendPct30 < -11 || (trendPct30 < -7 && trendPct90 < -14)) {
    trendStatus = 'FALLING';
  } else if (trendPct30 > 20) {
    trendStatus = 'SPIKING';
  } else if (trendPct30 > 7) {
    trendStatus = 'RISING';
  }

  const effBuy = calcEffectiveBuyUsd(marketBuyUsd, buyFeePct);
  const netSteam = calcNetSteamUsd(steamUsd, steamFeeMode, steamCustomFeePct);
  const m1 = effBuy > 0 && netSteam > 0 ? netSteam / effBuy : 0;
  const leg1ProfitPct = m1 > 0 ? (m1 - 1) * 100 : -100;

  const netSell = calcNetSellUsd(marketSellUsd, sellFeePct, withdrawFeePct);
  const m2 = steamUsd > 0 && netSell > 0 ? netSell / steamUsd : 0;
  const leg2LossPct = m2 > 0 ? (1 - m2) * 100 : 100;

  const spikeRatio = steam30 > 0 ? (steamRaw - steam30) / steam30 : 0;
  const stability30 = Math.abs(spikeRatio);
  const isSpiky = stability30 > 0.22;

  const velocity = computeVelocityProfile(item);
  // Real structural spreads have steady 30d pricing, deep CSFloat books (45+ listings), and tight Bid/Ask (>=88%)
  const isStableDeepBook =
    (Number(item.q) || 0) >= 45 &&
    (velocity.bidAskPct === 0 || velocity.bidAskPct >= 88) &&
    stability30 <= 0.14 &&
    velocity.sold7d >= 5;

  const isAnomalySpread =
    leg1ProfitPct > 65 ||
    (leg1ProfitPct > 44 && !isStableDeepBook) ||
    (velocity.isPatternSensitive && leg1ProfitPct > 38 && !isStableDeepBook);

  return {
    steamUsd,
    steamRaw,
    marketBuyUsd,
    marketSellUsd,
    buff163Usd,
    buff163OrderUsd,
    vsBuffPct,
    isBelowBuff,
    isOverBuff,
    trendPct30,
    trendStatus,
    effBuy,
    netSteam,
    netSell,
    m1,
    leg1ProfitPct,
    m2,
    leg2LossPct,
    spikeRatio,
    stability30,
    isSpiky,
    isStableDeepBook,
    isAnomalySpread,
    velocity,
    hasValidMarket: marketBuyUsd > 0 && steamUsd > 0
  };
}

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
      row.push({ s1Shift, m2Shift, roiPct, isCenter: s1Shift === 0 && m2Shift === 0 });
    }
    grid.push(row);
  }

  return { shifts, grid };
}

export function findOptimalPairs(items, opts, capitalUsd = 200) {
  const advisor = analyzeCapitalStrategies(items, opts, capitalUsd, {
    style: 'ALL',
    maxQty: 0,
    minSpeed: 'FAST',
    cleanOnly: true
  });
  return advisor.strategies.slice(0, 3).map((s) => ({
    leg1: s.pair.leg1,
    leg2: s.pair.leg2,
    mCycle: s.pair.sim.mCycle,
    roiPct: s.pair.c1.netRoiPct
  }));
}

export function getCapitalTierInfo(capitalUsd) {
  const c = Math.max(0, Number(capitalUsd) || 0);
  if (c < 75) {
    return {
      id: 'MICRO',
      badge: bi('Micro Budget', 'Mikro Bütçe'),
      rangeLabel: '< $75',
      advice: bi(
        'Use fast $0.40–$5 cases/skins + $4–$20 liquid exit skins so minimal balance gets stuck in Steam Wallet.',
        'Düşük bütçede hızlı satılan $0.40–$5 kasa/skinler + $4–$20 popüler skinlerle içeride bakiye bırakmadan dönün.'
      ),
      minL1Price: 0.28,
      maxL1Price: Math.max(c * 0.85, 10),
      minL2Price: 2.5,
      maxL2Price: Math.max(c * 0.75, 22),
      defaultMaxQ1: 120,
      splitPlan: [
        {
          pct: 100,
          role: bi('Focused Liquid Pair', 'Tek Hızlı Likit Çift'),
          note: bi('Avoids splitting small capital into awkward leftover cents.', 'Sermayeyi bölmeden yüksek tam-sayı verimi.')
        }
      ]
    };
  }
  if (c < 400) {
    return {
      id: 'STARTER',
      badge: bi('Growth Budget', 'Büyüme Bütçesi'),
      rangeLabel: '$75 – $400',
      advice: bi(
        'Sweet spot for CS2 arbitrage: either run 1–10 high-liquidity skins for minimal clicks or active cases for faster Steam growth.',
        'En akıcı aralık: ister 1–10 adet hızlı üst skinle düşük eforlu dönün, ister aktif kasalarla Steam bakiyesini büyütün.'
      ),
      minL1Price: 0.4,
      maxL1Price: c,
      minL2Price: 6,
      maxL2Price: Math.min(c * 0.65, 140),
      defaultMaxQ1: 180,
      splitPlan: [
        {
          pct: 70,
          role: bi('Primary Fast Spread', 'Ana Hızlı Spread'),
          note: bi('Strong 7-day sales volume for reliable Steam exit.', 'Yüksek 7g satış hacmiyle hızlı Steam çıkışı.')
        },
        {
          pct: 30,
          role: bi('Secondary Liquid Hedge', 'İkinci Likit Eşya'),
          note: bi('Diversifies 7-day hold price movement risk.', '7G hold fiyat oynaklık riskini dengeler.')
        }
      ]
    };
  }
  if (c < 1500) {
    return {
      id: 'PRO',
      badge: bi('Mid-High Budget', 'Orta-Üst Bütçe'),
      rangeLabel: '$400 – $1,500',
      advice: bi(
        'Skip hundreds of tiny cases — $5+ liquid rifles and $30–$220 exit skins clear cleanly in 14–16 days without inventory clutter.',
        'Yüzlerce ucuz eşya yerine $5+ hızlı satılan skinler ve $30–$220 likit tüfeklerle az işlemde 14–16 günde temiz döngü kurun.'
      ),
      minL1Price: Math.max(2, c / 160),
      maxL1Price: c,
      minL2Price: 18,
      maxL2Price: Math.min(c * 0.5, 360),
      defaultMaxQ1: 150,
      splitPlan: [
        {
          pct: 50,
          role: bi('Core Liquid Skin / Case', 'Ana Likit Skin / Kasa'),
          note: bi('Low unit count with fast Steam turnover.', 'Düşük adetle hızlı listeleme.')
        },
        {
          pct: 35,
          role: bi('Popular Rifle / AWP Lane', 'Popüler Tüfek / AWP'),
          note: bi('Tight CSFloat Bid/Ask for rapid cashout.', 'Yüksek CSFloat Bid/Ask ile hızlı nakit.')
        },
        {
          pct: 15,
          role: bi('Cash Reserve', 'Nakit Tampon'),
          note: bi('Covers leftover rounding & dip buys.', 'Küsurat tamamlama & anlık fırsatlar.')
        }
      ]
    };
  }
  return {
    id: 'WHALE',
    badge: bi('Pro Desk Capital', 'Yüksek Sermaye'),
    rangeLabel: '$1,500+',
    advice: bi(
      'Buying thousands of cheap cases breaks CS2’s 1,000-slot limit and drains books. Trade $20+ liquid rifles, knives & gloves across split lanes.',
      'Yüksek sermayede binlerce ucuz kasa 1.000 slot sınırını aşar. $20+ yüksek hacimli popüler skinler ve likit bıçaklarla az parça çalışın.'
    ),
    minL1Price: Math.max(10, c / 100),
    maxL1Price: c,
    minL2Price: 50,
    maxL2Price: Math.min(c * 0.45, 1100),
    defaultMaxQ1: 100,
    splitPlan: [
      {
        pct: 45,
        role: bi('High-Tier Liquid Skins ($20+)', 'Üst Bant Likit Skin ($20+)'),
        note: bi('Low trade count with strong 7d volume.', 'Az parça, yüksek 7g satış hacmi.')
      },
      {
        pct: 40,
        role: bi('Covert / Liquid Knife Lane', 'Covert / Bıçak Hattı'),
        note: bi('High capital density per trade.', 'Büyük bakiye taşıma gücü.')
      },
      {
        pct: 15,
        role: bi('Buy-Order & Risk Buffer', 'Buy-Order & Risk Tamponu'),
        note: bi('Absorbs hold volatility & instant exits.', 'Volatilite ve hızlı çıkış rezervi.')
      }
    ]
  };
}

export function estimateExecutionReality(metrics, item1, item2, opts = {}) {
  const c1 = metrics.firstCycle;
  const q1 = c1.q1 || 0;
  const q2 = c1.q2 || 0;
  const depth1 = Number(item1?.q) || 0;
  const isCSFloat = opts.marketplace !== 'YOUPIN';

  const vel1 = computeVelocityProfile(item1);
  const vel2 = computeVelocityProfile(item2);

  // Quantity-relative fill-time model using V5 multi-window cross-market daily volume
  const estFillDays1 =
    q1 <= 0 ? 0 : Math.min(18, Math.max(0, Math.ceil(q1 / Math.max(0.25, vel1.estDailySales * 0.85)) - 1));
  const estFillDays2 =
    opts.useBuyOrderForLeg2 || q2 <= 0
      ? 0
      : Math.min(14, Math.max(0, Math.ceil(q2 / Math.max(0.35, vel2.estDailySales * 0.95)) - 1));

  let extraBuyDays = 0;
  let extraSellSteamDays = Math.max(vel1.extraSellDays, estFillDays1);
  let extraCashoutDays = opts.useBuyOrderForLeg2 ? 0 : Math.max(vel2.extraSellDays, estFillDays2);
  const reasons = [];

  if (item1 && (vel1.tier === 'D' || vel1.tier === 'C')) {
    reasons.push(
      bi(
        `Step 1 (${item1.n}): ${vel1.slowWarning || 'Low sales speed may delay Steam exit.'}`,
        `1. Adım (${item1.n}): ${vel1.slowWarning || 'Satış hacmi düşük, Steam çıkışı uzayabilir.'}`
      )
    );
  }
  if (item2 && (vel2.tier === 'D' || vel2.tier === 'C')) {
    reasons.push(
      bi(
        `Step 2 (${item2.n}): ${vel2.slowWarning || 'Cashout exit may sell slowly.'}`,
        `2. Adım (${item2.n}): ${vel2.slowWarning || 'Nakit dönüş satışı yavaş olabilir.'}`
      )
    );
  }

  if (item1 && q1 > vel1.estWeeklyCap && q1 > 10) {
    const weeksNeeded = Math.min(8, Math.ceil(q1 / Math.max(1, vel1.estWeeklyCap)));
    extraSellSteamDays += weeksNeeded * 3;
    reasons.push(
      bi(
        `Buying ${q1.toLocaleString('en-US')} units exceeds weekly market absorption (~${vel1.estWeeklyCap}/wk); selling will take longer.`,
        `1. Adımda ${q1.toLocaleString('tr-TR')} adet almak haftalık satış temposunun (~${vel1.estWeeklyCap} ad/hf) üzerinde; satış süresi uzar.`
      )
    );
  }

  const storageUnits = q1 > 1000 ? Math.ceil((q1 - 950) / 1000) : 0;
  if (q1 > 2000) {
    extraBuyDays += Math.min(14, Math.ceil(q1 / 600));
    extraSellSteamDays += Math.min(20, Math.ceil(q1 / 450));
    reasons.push(
      bi(
        `${q1.toLocaleString('en-US')} items cannot be cycled in 14 days: requires ${storageUnits} Storage Units and sweeps thin books.`,
        `${q1.toLocaleString('tr-TR')} adet eşya tek seferde dönmez: ${storageUnits} Storage Unit gerekir ve döngü haftalarca uzar.`
      )
    );
  } else if (q1 > 950) {
    extraBuyDays += 3;
    extraSellSteamDays += 5;
    reasons.push(
      bi(
        `${q1.toLocaleString('en-US')} items exceed CS2’s 1,000-slot inventory limit (${storageUnits} Storage Units needed).`,
        `${q1.toLocaleString('tr-TR')} adet CS2'nin 1.000 envanter slot sınırını aşıyor (${storageUnits} Storage Unit gerekir).`
      )
    );
  } else if (q1 > 300) {
    extraBuyDays += 1;
    extraSellSteamDays += 2;
  }

  let bookRatio1 = 0;
  if (isCSFloat && depth1 > 0 && q1 > 0) {
    bookRatio1 = (q1 / depth1) * 100;
    if (bookRatio1 > 100) {
      extraBuyDays += Math.min(10, Math.ceil(q1 / Math.max(20, depth1)) * 2);
      reasons.push(
        bi(
          `Step 1 count (${q1.toLocaleString('en-US')}) exceeds active CSFloat listings (${depth1}) — price slippage guaranteed.`,
          `1. Adım adet (${q1.toLocaleString('tr-TR')}) mevcut CSFloat ilan derinliğinden (${depth1}) fazla — fiyat kayması (slippage) oluşur.`
        )
      );
    } else if (bookRatio1 > 45) {
      extraBuyDays += 2;
    }
  }

  const totalExtra = extraBuyDays + extraSellSteamDays + extraCashoutDays;
  const minDays = 14 + Math.floor(totalExtra * 0.5);
  const maxDays = 14 + Math.max(totalExtra, 1);

  let level = 'smooth';
  let label = bi('Smooth (~14–15 Days)', 'Akıcı (~14–15 Gün)');
  let pillCls = 'pill-mint';

  if (q1 > 1500 || bookRatio1 > 120 || vel1.tier === 'D' || vel2.tier === 'D' || maxDays >= 28) {
    level = 'impractical';
    label = bi(`Impractical (~${minDays}–${maxDays}+ Days)`, `Pratik Değil (~${minDays}–${maxDays}+ Gün)`);
    pillCls = 'pill-crimson';
  } else if (q1 > 400 || vel1.tier === 'C' || vel2.tier === 'C' || maxDays >= 20) {
    level = 'slow';
    label = bi(`Extended (~${minDays}–${maxDays} Days)`, `Süre Uzar (~${minDays}–${maxDays} Gün)`);
    pillCls = 'pill-amber';
  } else if (totalExtra >= 2) {
    level = 'moderate';
    label = bi(`Smooth+ (~${minDays}–${maxDays} Days)`, `Akıcı (~${minDays}–${maxDays} Gün)`);
    pillCls = 'pill-gold';
  }

  return {
    level,
    label,
    pillCls,
    minDays,
    maxDays,
    extraDays: totalExtra,
    estFillDays1,
    estFillDays2,
    storageUnits,
    bookRatio1,
    vel1,
    vel2,
    reasons,
    needsUpperTierSuggestion: level === 'impractical' || level === 'slow'
  };
}

/**
 * Computes an honest 35-99% Quant Confidence Score V3 using quantity-relative fill time,
 * 30d price stability, order-book depth, and true anomaly guards.
 */
function computePairConfidence(l1, l2, c1, reality) {
  let conf = 94;

  // Bonuses for institutional-grade depth, Buff163 fair value, trend safety & 30d stability
  if (l1.m.stability30 <= 0.07) conf += 3;
  if (l1.m.isBelowBuff) conf += 4;
  if (l1.m.isOverBuff) conf -= 7;
  if (l1.m.trendStatus === 'FALLING') conf -= 9;
  else if (l1.m.trendStatus === 'STABLE' || l1.m.trendStatus === 'RISING') conf += 2;
  if (l2.m.trendStatus === 'FALLING') conf -= 6;
  if (l1.vel.bidAskPct >= 91) conf += 2;
  if (l2.vel.bidAskPct >= 91) conf += 2;
  if (l1.vel.tier === 'A' && l2.vel.tier === 'A') conf += 3;

  // Velocity & fill-time risk
  const avgVel = (l1.vel.score + l2.vel.score) / 2;
  if (avgVel < 78) conf -= Math.round((78 - avgVel) * 0.42);
  if (reality.extraDays > 2) conf -= Math.min(18, (reality.extraDays - 1) * 2);

  // Genuine anomaly vs modest pattern/high-ticket realism adjustment
  if (l1.m.isAnomalySpread) conf -= 20;
  if (l1.vel.isKnifeOrGlove) conf -= 4;
  if (l1.vel.isPatternSensitive) conf -= l1.m.isStableDeepBook ? 6 : 14;
  if (l2.vel.isPatternSensitive) conf -= l2.m.isStableDeepBook ? 4 : 10;
  if (l2.m.leg2LossPct < 2.5 && l2.vel.tier !== 'A') conf -= 12;

  // Wide Bid/Ask on cashout exit
  if (l2.vel.bidAskPct > 0 && l2.vel.bidAskPct < 88) conf -= 8;

  // Buying a large share of weekly market supply
  if (c1.q1 > 3 && c1.q1 > l1.vel.estWeeklyCap * 0.65) conf -= 8;

  return Math.max(35, Math.min(99, Math.round(conf)));
}

export function analyzeCapitalStrategies(items, opts, capitalUsd = 200, filters = {}) {
  const cap = Math.max(5, Number(capitalUsd) || 200);
  const tier = getCapitalTierInfo(cap);
  const isCSFloat = opts.marketplace === 'CSFLOAT';

  const style = filters.style || 'ALL';
  const cleanOnly = filters.cleanOnly !== false;
  let minSpeed = filters.minSpeed || 'FAST';
  if (style === 'FAST') minSpeed = 'ULTRA';
  if (style === 'PATIENT') minSpeed = 'MODERATE';

  const allowedTiers =
    minSpeed === 'ULTRA'
      ? new Set(['A'])
      : minSpeed === 'MODERATE'
      ? new Set(['A', 'B', 'C'])
      : new Set(['A', 'B']);

  const userMaxQty = Number(filters.maxQty) || 0;
  const effectiveMaxQ1 =
    style === 'LOW_QTY'
      ? Math.min(userMaxQty > 0 ? userMaxQty : 10, 10)
      : userMaxQty > 0
      ? userMaxQty
      : tier.defaultMaxQ1;

  const leg1Pool = [];
  const leg2Pool = [];

  for (const item of items) {
    const qty = Number(item.q) || 0;
    if (isCSFloat && qty < 12) continue;

    if (cleanOnly) {
      if (item.st || item.sv) continue;
      if (item.c === 'Capsule' && (item.v7 || 0) < 35) continue;
    }

    const m = evaluateItemMetrics(item, opts);
    if (!m.hasValidMarket || m.isSpiky) continue;

    const vel = m.velocity;
    if (!allowedTiers.has(vel.tier)) continue;

    // Leg 1 eligibility (V3: allows deep-book structural spreads & liquid 1-3x knives/gloves in FAST mode!)
    const passCategoryL1 = style === 'CASES' ? item.c === 'Case' : true;
    const passAnomalyL1 = minSpeed === 'MODERATE' ? true : !m.isAnomalySpread;
    if (
      passCategoryL1 &&
      passAnomalyL1 &&
      m.effBuy >= 0.25 &&
      m.effBuy <= cap &&
      m.leg1ProfitPct >= 2.0 &&
      m.leg1ProfitPct <= 64
    ) {
      const q1Est = Math.floor(cap / m.effBuy);
      const bookOk = !isCSFloat || q1Est <= Math.max(8, qty * 0.6);
      const velCapOk = q1Est <= Math.max(10, vel.estWeeklyCap * 1.4);
      if (q1Est >= 1 && q1Est <= effectiveMaxQ1 && bookOk && velCapOk) {
        leg1Pool.push({ item, m, vel, qty, q1Est });
      }
    }

    // Leg 2 eligibility: strictly eliminate thin-book FN float-overpay anomalies & avoid knives as exit skins under $1,500
    const bidAskOk = !isCSFloat || vel.bidAskPct === 0 || vel.bidAskPct >= 83;
    const l2AllowedTier = minSpeed === 'MODERATE' ? allowedTiers.has(vel.tier) : vel.tier === 'A' || vel.tier === 'B';
    const l2NoKnifeExit = !vel.isKnifeOrGlove || (cap >= 1500 && vel.sold7d >= 8 && qty >= 60);
    const l2MinPrice = Math.max(tier.minL2Price, cap / 45);
    const l2MinVol = minSpeed === 'MODERATE' || cap >= 1500 ? 15 : 35;
    const maxL2Loss = cap >= 1500 || minSpeed === 'MODERATE' ? 23 : 14.5;
    const l2NotAnomaly = m.leg2LossPct >= 3.0 || (vel.tier === 'A' && vel.mktVol >= 150 && m.leg2LossPct >= 0.5);

    if (
      l2AllowedTier &&
      l2NoKnifeExit &&
      bidAskOk &&
      l2NotAnomaly &&
      (vel.mktVol >= l2MinVol || vel.weeklyUsd >= 600) &&
      m.steamUsd >= Math.min(l2MinPrice, cap * 0.45) &&
      m.steamUsd <= Math.max(tier.maxL2Price, cap * 1.25, 1900) &&
      m.leg2LossPct >= 0 &&
      m.leg2LossPct <= maxL2Loss
    ) {
      leg2Pool.push({ item, m, vel, qty });
    }
  }

  // Gentle fallback for strict narrow filter combos
  if (leg1Pool.length < 2) {
    for (const item of items) {
      if (cleanOnly && (item.st || item.sv || item.c === 'Capsule')) continue;
      if (style === 'CASES' && item.c !== 'Case') continue;
      const m = evaluateItemMetrics(item, opts);
      if (!m.hasValidMarket || m.isSpiky || m.velocity.tier === 'D') continue;
      const q1Est = m.effBuy > 0 ? Math.floor(cap / m.effBuy) : 0;
      if (q1Est >= 1 && q1Est <= effectiveMaxQ1 && m.leg1ProfitPct >= 0.5 && m.leg1ProfitPct <= 58) {
        if (!leg1Pool.some((x) => x.item.n === item.n)) {
          leg1Pool.push({ item, m, vel: m.velocity, qty: item.q || 0, q1Est });
        }
      }
    }
  }

  if (leg2Pool.length < 3) {
    for (const item of items) {
      if (cleanOnly && (item.st || item.sv || item.c === 'Capsule')) continue;
      const m = evaluateItemMetrics(item, opts);
      if (!m.hasValidMarket || m.isSpiky || m.velocity.tier === 'D') continue;
      if (m.steamUsd >= 1 && m.steamUsd <= cap * 1.35 && m.leg2LossPct >= 0 && m.leg2LossPct <= 14.5) {
        if (!leg2Pool.some((x) => x.item.n === item.n)) {
          leg2Pool.push({ item, m, vel: m.velocity, qty: item.q || 0 });
        }
      }
    }
  }

  // V5 Expanded Multi-Bracket Candidate Pools (zero blind spots across price tiers)
  const l1ByProfit = [...leg1Pool].sort((a, b) => b.m.leg1ProfitPct - a.m.leg1ProfitPct).slice(0, 22);
  const l1BySpeed = [...leg1Pool].sort((a, b) => b.vel.score - a.vel.score || b.m.leg1ProfitPct - a.m.leg1ProfitPct).slice(0, 14);
  const l1LowQty = [...leg1Pool].filter((x) => x.q1Est <= 10).sort((a, b) => b.m.leg1ProfitPct - a.m.leg1ProfitPct).slice(0, 16);
  const l1Cases = [...leg1Pool].filter((x) => x.item.c === 'Case').sort((a, b) => b.m.leg1ProfitPct - a.m.leg1ProfitPct).slice(0, 10);

  const l2ByLoss = [...leg2Pool].sort((a, b) => a.m.leg2LossPct - b.m.leg2LossPct).slice(0, 22);
  const l2BySpeed = [...leg2Pool].sort((a, b) => b.vel.score - a.vel.score || a.m.leg2LossPct - b.m.leg2LossPct).slice(0, 16);
  const l2ByOrder = [...leg2Pool]
    .filter((x) => x.vel.bidAskPct >= 92)
    .sort((a, b) => a.m.leg2LossPct - b.m.leg2LossPct)
    .slice(0, 12);

  const l1Candidates = Array.from(
    new Map([...l1ByProfit, ...l1BySpeed, ...l1LowQty, ...l1Cases].map((x) => [x.item.n, x])).values()
  );
  const l2Candidates = Array.from(
    new Map([...l2ByLoss, ...l2BySpeed, ...l2ByOrder].map((x) => [x.item.n, x])).values()
  );

  const rawEvaluatedPairs = [];

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

      const maxRealisticQ2 = Math.min(
        Math.max(20, Math.floor(l2.vel.estWeeklyCap * 1.2)),
        isCSFloat && l2.qty > 0 ? Math.max(12, Math.floor(l2.qty * 0.8)) : 60,
        style === 'LOW_QTY' ? Math.max(15, effectiveMaxQ1 * 2) : cap >= 1500 ? 60 : 38
      );
      if (c1.q2 > maxRealisticQ2) continue;

      const reality = estimateExecutionReality(sim, l1.item, l2.item, opts);
      const utilizedPct = c1.steamAfterLeg1 > 0 ? ((c1.steamAfterLeg1 - c1.steamWallet) / c1.steamAfterLeg1) * 100 : 0;
      const speedScore = Math.round((l1.vel.score + l2.vel.score) / 2);
      const avgDays = (reality.minDays + reality.maxDays) / 2;

      // V5 Square-Root Order-Book Market Impact / Slippage Model
      const slip1Pct = c1.q1 <= 1 ? 0 : Math.min(4.5, 1.8 * Math.sqrt(c1.q1 / Math.max(15, l1.qty || 30)));
      const slip2Pct =
        c1.q2 <= 1 || opts.useBuyOrderForLeg2 ? 0 : Math.min(4.5, 1.5 * Math.sqrt(c1.q2 / Math.max(15, l2.qty || 30)));
      const estSlippagePct = Math.round((slip1Pct + slip2Pct) * 100) / 100;
      const slippageAdjProfit = c1.netProfit - c1.spentM1 * (slip1Pct / 100) - c1.cashReturnM2 * (slip2Pct / 100);
      const slippageAdjRoi = cap > 0 ? (slippageAdjProfit / cap) * 100 : 0;

      // V5 Instant Buy-Order Guaranteed Downside Floor (0-second dump into CSFloat highest_order)
      const instantSellPrice = isCSFloat && l2.item.cfo > 0 ? l2.item.cfo : l2.m.marketSellUsd;
      const instantNetM2 = calcNetSellUsd(instantSellPrice, opts.sellFeePct, opts.withdrawFeePct);
      const instantM2 = l2.m.steamUsd > 0 ? instantNetM2 / l2.m.steamUsd : 0;
      const instantFloorEnd = c1.cashLeftAfterLeg1 + c1.q2 * instantNetM2 + c1.steamWallet * instantM2;
      const instantFloorProfit = Math.round((instantFloorEnd - cap) * 100) / 100;
      const instantFloorRoi = cap > 0 ? (instantFloorProfit / cap) * 100 : 0;

      const roiPer14d = slippageAdjRoi * (14 / Math.max(14, avgDays));
      const roiPerDay = c1.netRoiPct / Math.max(14, avgDays);

      // Quantity-aware slow check: 1-3x liquid Tier B knife/glove (~1+ sale/day) is NOT slow!
      const slowDayLimit = cap >= 1500 ? 27 : 21;
      const hasSlowLeg =
        l1.vel.tier === 'C' ||
        l2.vel.tier === 'C' ||
        (l1.vel.isKnifeOrGlove && (l1.vel.tier !== 'B' || c1.q1 > (cap >= 1500 ? 8 : 3))) ||
        (l2.vel.isKnifeOrGlove && (l2.vel.tier !== 'B' || c1.q2 > 5)) ||
        reality.maxDays >= slowDayLimit;
      const confidenceScore = computePairConfidence(l1, l2, c1, reality);
      const buffBonus = l1.m.isBelowBuff ? 3.5 : l1.m.isOverBuff ? -4 : 0;
      const trendBonus = l1.m.trendStatus === 'FALLING' ? -6 : l1.m.trendStatus === 'STABLE' ? 1.5 : 0;
      const floorBonus = instantFloorProfit > 0 ? Math.min(3.5, instantFloorRoi * 0.14) : -3;
      const q2EffortPenalty = c1.q2 > 18 ? (c1.q2 - 18) * 0.08 : 0;
      const agentScore =
        Math.round(
          (roiPer14d * 1.45 + confidenceScore * 0.25 + utilizedPct * 0.08 + buffBonus + trendBonus + floorBonus - q2EffortPenalty) *
            10
        ) / 10;

      rawEvaluatedPairs.push({
        leg1: l1,
        leg2: l2,
        sim,
        c1,
        reality,
        utilizedPct,
        speedScore,
        avgDays,
        estSlippagePct,
        slippageAdjProfit,
        slippageAdjRoi,
        instantFloorProfit,
        instantFloorRoi,
        roiPer14d,
        roiPerDay,
        hasSlowLeg,
        confidenceScore,
        agentScore
      });
    }
  }

  // V5 STRICT PER-LEG-1 PARETO FRONTIER PRUNING:
  // Mathematically guarantees that for any Leg 1 item, a strictly dominated Leg 2 exit
  // (lower profit AND slower/equal days AND higher/equal item count AND lower/equal trust) can NEVER be chosen!
  const byLeg1 = new Map();
  for (const p of rawEvaluatedPairs) {
    if (p.c1.netProfit <= 0) continue;
    const k = p.leg1.item.n;
    if (!byLeg1.has(k)) byLeg1.set(k, []);
    byLeg1.get(k).push(p);
  }

  const evaluatedPairs = [];
  for (const group of byLeg1.values()) {
    for (let i = 0; i < group.length; i++) {
      const a = group[i];
      let dominated = false;
      for (let j = 0; j < group.length; j++) {
        if (i === j) continue;
        const b = group[j];
        const betterOrEqAll =
          b.c1.netProfit >= a.c1.netProfit - 0.01 &&
          b.reality.maxDays <= a.reality.maxDays &&
          b.c1.q2 <= a.c1.q2 &&
          b.confidenceScore >= a.confidenceScore - 1;
        const strictlyBetterOne =
          b.c1.netProfit > a.c1.netProfit + 0.25 ||
          b.reality.maxDays < a.reality.maxDays ||
          b.c1.q2 < a.c1.q2 ||
          b.confidenceScore > a.confidenceScore + 1;
        if (betterOrEqAll && strictlyBetterOne) {
          dominated = true;
          break;
        }
      }
      if (!dominated) evaluatedPairs.push(a);
    }
  }

  const usedL1 = new Set();
  const usedL2Counts = new Map();
  const usedPairs = new Set();
  const strategies = [];

  const pickBest = (predicate, scorer, optsPick = {}) => {
    const { requireUniqueL1 = true, l2PenaltyWeight = 0.6 } = optsPick;
    let best = null;
    let bestScore = -Infinity;
    for (const p of evaluatedPairs) {
      if (p.c1.netProfit <= 0) continue;
      if (!predicate(p)) continue;
      const pk = `${p.leg1.item.n}|${p.leg2.item.n}`;
      if (usedPairs.has(pk)) continue;
      if (requireUniqueL1 && usedL1.has(p.leg1.item.n)) continue;
      const l2RepeatPenalty = (usedL2Counts.get(p.leg2.item.n) || 0) * l2PenaltyWeight;
      const sc = scorer(p) - l2RepeatPenalty;
      if (sc > bestScore) {
        bestScore = sc;
        best = p;
      }
    }
    if (!best && requireUniqueL1) {
      return pickBest(predicate, scorer, { requireUniqueL1: false, l2PenaltyWeight });
    }
    return best;
  };

  const addStrategy = (id, tagFn, tagClsFn, titleFn, pair) => {
    if (!pair) return;
    usedL1.add(pair.leg1.item.n);
    usedL2Counts.set(pair.leg2.item.n, (usedL2Counts.get(pair.leg2.item.n) || 0) + 1);
    usedPairs.add(`${pair.leg1.item.n}|${pair.leg2.item.n}`);

    let note = pair.leg1.vel.slowWarning || pair.leg2.vel.slowWarning || '';
    if (!note && (pair.leg1.m.isAnomalySpread || pair.leg1.vel.isPatternSensitive)) {
      note = bi(
        `Pattern/float sensitive (${pair.leg1.vel.sold7d} sold/7d) — buy clean lowest listing & check Steam median`,
        `Desen/float duyarlı (7g: ${pair.leg1.vel.sold7d} satış) — alırken en ucuz temiz ilanı & Steam medyanını kontrol et`
      );
    }

    strategies.push({
      id,
      tag: typeof tagFn === 'function' ? tagFn(pair) : tagFn,
      tagCls: typeof tagClsFn === 'function' ? tagClsFn(pair) : tagClsFn,
      title: typeof titleFn === 'function' ? titleFn(pair) : titleFn,
      actionLine: bi(
        `Buy ${pair.c1.q1}x → Sell on Steam → Cash out via ${pair.c1.q2}x`,
        `${pair.c1.q1}x al → Steam'de sat → ${pair.c1.q2}x ile nakde dön`
      ),
      cautionNote: note,
      pair
    });
  };

  // 1. TOP NET PROFIT (Zero artificial L2 penalty — ALWAYS picks the mathematically optimal exit!)
  addStrategy(
    'MAX_PROFIT',
    (p) => (p.hasSlowLeg ? bi('TOP PROFIT · PATIENT', 'EN YÜKSEK KÂR · SABIRLI') : bi('TOP NET PROFIT', 'EN YÜKSEK KÂR')),
    (p) => (p.hasSlowLeg ? 'pill-amber' : 'pill-mint'),
    bi('Highest Realistic 14d Return', 'En Yüksek Gerçekçi Net Kâr'),
    pickBest(
      (p) => (!p.hasSlowLeg || minSpeed === 'MODERATE') && p.confidenceScore >= 65,
      (p) => p.agentScore,
      { l2PenaltyWeight: 0 }
    )
  );

  // 2. Low-Count Precision Strike (≤10 items, clean & fast, zero L2 sabotage!)
  addStrategy(
    'LOW_QTY_STRIKE',
    (p) => (p.hasSlowLeg ? bi('FEW ITEMS · PATIENT', 'AZ İŞLEM · SABIRLI') : bi('FEW ITEMS · FAST', 'AZ İŞLEM · HIZLI')),
    (p) => (p.hasSlowLeg ? 'pill-amber' : 'pill-gold'),
    bi('Minimal Clicks, Clean Cycle', 'Az Eşya, Zahmetsiz Döngü'),
    pickBest(
      (p) => p.c1.q1 <= 10 && (!p.hasSlowLeg || minSpeed === 'MODERATE'),
      (p) => p.roiPer14d * 1.15 + p.confidenceScore * 0.24 + (p.c1.q1 <= 5 ? 5 : 0) - p.c1.q2 * 0.08,
      { l2PenaltyWeight: 0 }
    )
  );

  // 3. Fastest Instant-Liquidity Cash Flow (strictly Tier A instant-sellers!)
  addStrategy(
    'ULTRA_FAST',
    bi('FASTEST CASH', 'EN HIZLI NAKİT'),
    'pill-ice',
    bi('Instant-Sell High Volume Pair', 'Anında Satılan Çift'),
    pickBest(
      (p) => !p.hasSlowLeg && p.leg1.vel.tier === 'A' && p.speedScore >= 72,
      (p) => p.speedScore * 0.7 + p.roiPer14d * 0.95 + p.confidenceScore * 0.2,
      { l2PenaltyWeight: 0.4 }
    )
  );

  // 4. Highest Capital Efficiency
  addStrategy(
    'MAX_EFF',
    bi('HIGH EFFICIENCY', 'YÜKSEK VERİM'),
    'pill-gold',
    bi('Minimal Leftover Steam Balance', 'En Az Atıl Steam Bakiyesi'),
    pickBest(
      (p) => p.utilizedPct >= 88 && (!p.hasSlowLeg || minSpeed === 'MODERATE'),
      (p) => p.utilizedPct * 1.1 + p.roiPer14d * 1.0 + p.confidenceScore * 0.15,
      { l2PenaltyWeight: 0.5 }
    )
  );

  // 5. Active Liquid Cases Engine
  addStrategy(
    'LIQUID_CASES',
    bi('CASES ONLY', 'KASA MOTORU'),
    'pill-mint',
    bi('High-Volume CS2 Cases', 'Hızlı CS2 Kasa Motoru'),
    pickBest(
      (p) => p.leg1.item.c === 'Case' && p.leg1.vel.score >= 65,
      (p) => p.roiPer14d + p.leg1.vel.score * 0.2,
      { l2PenaltyWeight: 0.5 }
    )
  );

  // 6. High-Alpha Alternative (2nd highest distinct profit opportunity)
  addStrategy(
    'ALT_TOP',
    (p) => (p.hasSlowLeg ? bi('PATIENT · HIGH PROFIT', 'SABIRLI · YÜKSEK KÂR') : bi('HIGH ALPHA ALT', 'ALTERNATİF FIRSAT')),
    (p) => (p.hasSlowLeg ? 'pill-amber' : 'pill-muted'),
    (p) => (p.hasSlowLeg ? bi('Higher Profit (Allow Extra Time)', 'Yüksek Kâr (Satış Uzayabilir)') : bi('Strong Alternative Lane', 'Güçlü Alternatif Fırsat')),
    pickBest(
      () => true,
      (p) => (minSpeed === 'MODERATE' ? p.c1.netRoiPct + p.confidenceScore * 0.15 : p.agentScore),
      { l2PenaltyWeight: 0.6 }
    )
  );

  const finalStrategies = strategies.slice(0, 6);

  // SPREAD Agent V5 Executive Briefing + Automatic 2-Lane Knapsack Idle-Cash Optimizer!
  let agentBrief = null;
  if (finalStrategies.length > 0) {
    const ranked = [...finalStrategies].sort((a, b) => (b.pair.agentScore || 0) - (a.pair.agentScore || 0));
    const topStrat = ranked[0];
    const p = topStrat.pair;
    const altFast = finalStrategies.find(
      (s) => s !== topStrat && (s.id === 'ULTRA_FAST' || s.id === 'LIQUID_CASES' || s.pair.leg1.vel.tier === 'A')
    );
    const reasons = [];

    reasons.push(
      bi(
        `+${p.roiPerDay.toFixed(2)}%/day (~${p.reality.minDays}–${p.reality.maxDays}d)`,
        `Günde +%${p.roiPerDay.toFixed(2)} (~${p.reality.minDays}–${p.reality.maxDays}g)`
      )
    );

    if (p.instantFloorProfit > 0) {
      reasons.push(
        bi(
          `Instant Buy-Order Floor: +$${p.instantFloorProfit.toFixed(0)}`,
          `Anında Satış Tabanı: +$${p.instantFloorProfit.toFixed(0)}`
        )
      );
    }

    if (p.leg1.m.vsBuffPct !== null) {
      if (p.leg1.m.vsBuffPct <= 0) {
        reasons.push(
          bi(
            `${Math.abs(p.leg1.m.vsBuffPct).toFixed(1)}% below Buff163`,
            `Buff163'ten %${Math.abs(p.leg1.m.vsBuffPct).toFixed(1)} ucuz`
          )
        );
      } else if (p.leg1.m.vsBuffPct <= 3.5) {
        reasons.push(bi('Matches Buff163 cash price', 'Buff163 küresel fiyatında'));
      }
    }

    if (p.leg1.m.trendStatus === 'FALLING') {
      reasons.push(bi('Caution: 30d downtrend', 'Dikkat: 30g düşüş trendi'));
    } else if (p.leg1.m.trendStatus === 'STABLE') {
      reasons.push(bi('Stable 30d trend', 'Stabil 30g trend'));
    } else if (p.leg1.m.trendStatus === 'RISING') {
      reasons.push(bi('Healthy uptrend', 'Sağlıklı yükseliş'));
    }

    if (p.estSlippagePct > 0.1) {
      reasons.push(
        bi(`Est. slippage ${p.estSlippagePct.toFixed(1)}%`, `Tahmini kayma %${p.estSlippagePct.toFixed(1)}`)
      );
    }

    // V5 KNAPSACK IDLE-CASH OPTIMIZER:
    // If buying q1 leaves >= $25 AND >= 12% of budget sitting idle, find the best Lane 2 to deploy it!
    let knapsackLane2 = null;
    const idleCash = p.c1.cashLeftAfterLeg1 || 0;
    if (!filters._isSubKnapsack && idleCash >= 25 && idleCash >= cap * 0.12) {
      const subItems = items.filter((it) => it.n !== p.leg1.item.n);
      const subRes = analyzeCapitalStrategies(subItems, opts, idleCash, {
        style: 'ALL',
        maxQty: Math.min(25, effectiveMaxQ1),
        minSpeed: 'FAST',
        cleanOnly,
        _isSubKnapsack: true
      });
      const subBest = subRes.strategies[0]?.pair;
      if (subBest && subBest.c1.netProfit >= 4 && subBest.confidenceScore >= 75) {
        const totalProfit = p.c1.netProfit + subBest.c1.netProfit;
        const totalRoiPct = (totalProfit / cap) * 100;
        const totalDeployedPct = ((p.c1.spentM1 + subBest.c1.spentM1) / cap) * 100;
        knapsackLane2 = {
          idleCashUsd: idleCash,
          pair: subBest,
          combinedProfitUsd: totalProfit,
          combinedRoiPct: totalRoiPct,
          deployedPct: Math.min(100, totalDeployedPct)
        };
      }
    }

    let splitHint = '';
    if (!knapsackLane2 && cap >= 350 && altFast && altFast.pair.leg1.item.n !== p.leg1.item.n) {
      splitHint = bi(
        `Pro Split: 65% in ${p.leg1.item.n} (top profit) + 35% in ${altFast.pair.leg1.item.n} (instant liquidity).`,
        `Akıllı Dağılım: %65 ${p.leg1.item.n} (yüksek kâr) + %35 ${altFast.pair.leg1.item.n} (anında likidite).`
      );
    }

    agentBrief = {
      strategy: topStrat,
      pair: p,
      headline: bi(
        `Buy ${p.c1.q1}x ${p.leg1.item.n} → cash out via ${p.c1.q2}x ${p.leg2.item.n}`,
        `${p.c1.q1}x ${p.leg1.item.n} al → Steam'de sat → ${p.c1.q2}x ${p.leg2.item.n} ile nakde dön`
      ),
      reasons: reasons.slice(0, 5),
      knapsackLane2,
      splitHint
    };
  }

  return {
    tier,
    effectiveMaxQ1,
    totalCandidates: evaluatedPairs.length,
    strategies: finalStrategies,
    agentBrief,
    bestBenchmark: agentBrief?.pair || finalStrategies[0]?.pair || null
  };
}

export function diagnoseCurrentSetup(metrics, advisorResult, reality) {
  const c1 = metrics.firstCycle;
  const alerts = [];

  if (c1.q1 === 0) {
    return [
      {
        level: 'danger',
        text: bi(
          'Starting capital is below 1 unit of your Leg 1 item. Pick a budget-matched strategy below.',
          'Başlangıç sermayesi 1 adet 1. yön eşyası almaya yetmiyor. Aşağıdan bütçene uygun bir strateji seç.'
        )
      }
    ];
  }

  if (reality && reality.reasons.length > 0) {
    for (const reason of reality.reasons.slice(0, 2)) {
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
      text: bi(
        'Net Steam balance after Leg 1 cannot buy 1 unit of your Leg 2 exit skin. Choose a lower-priced exit skin.',
        'Steam bakiyesi 2. yön eşyasından 1 adet almaya yetmiyor. Daha uygun fiyatlı bir dönüş skini seç.'
      )
    });
  } else if (trappedSteamPct > 18) {
    alerts.push({
      level: 'warn',
      text: bi(
        `${trappedSteamPct.toFixed(1)}% of your Steam balance stays leftover after Leg 2. Pick a smaller exit skin to boost efficiency.`,
        `Steam bakiyenin %${trappedSteamPct.toFixed(1)}'i dönüş eşyasına yetmediği için içeride kalıyor.`
      )
    });
  }

  if (metrics.netCycleRoiPct <= 0) {
    alerts.push({
      level: 'danger',
      text: bi(
        'This pair is unprofitable after current fees (M₁ × M₂ ≤ 1.00). Pick a recommended strategy below.',
        'Bu eşleşme mevcut komisyonlarla kâr üretmiyor (M₁ × M₂ ≤ 1.00).'
      )
    });
  } else if (alerts.length === 0) {
    alerts.push({
      level: 'good',
      text: bi(
        `Fast & Optimized: ${(100 - trappedSteamPct).toFixed(1)}% active capital utilization • Est. ${reality?.minDays || 14}–${reality?.maxDays || 15} days.`,
        `Hızlı & Optimize: %${(100 - trappedSteamPct).toFixed(1)} aktif sermaye verimi • Tahmini süre ${reality?.minDays || 14}–${reality?.maxDays || 15} gün.`
      )
    });
  }

  return alerts;
}
