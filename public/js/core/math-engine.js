/**
 * SPREAD (spread.haking.tr) — Quantitative CS2 Arbitrage, Sales Velocity & Smart Strategy Engine
 *
 * Capabilities:
 *  1. Exact Valve cent-by-cent Steam Community Market fee solver
 *  2. True cash-equivalent portfolio valuation (cashWallet + steamWallet * M2)
 *  3. Real Sales Velocity & Liquidity Profiler (Skinport 24h/7d/30d + Market.CSGO + CSFloat Bid/Ask)
 *  4. Execution Reality & Realistic Cycle Duration Estimator (slot limits, depth absorption, sell velocity)
 *  5. Filterable Multi-Strategy Capital Advisor (up to 6 distinct, named, realistic strategies)
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
 * Real-World Sales Velocity & Liquidity Profiler.
 * Separates genuinely fast-selling skins/cases from illiquid trade-up/collector traps
 * (like P2000 Turf FN, old Autograph Capsules, or slow StatTrak skins).
 */
export function computeVelocityProfile(item) {
  if (!item) {
    return {
      tier: 'C',
      score: 45,
      label: 'Bilinmiyor',
      shortLabel: 'Belirsiz',
      pillCls: 'pill-muted',
      sold24h: 0,
      sold7d: 0,
      sold30d: 0,
      mktVol: 0,
      bidAskPct: 0,
      estWeeklyCap: 20,
      extraSellDays: 2,
      slowWarning: ''
    };
  }

  const v24 = Number(item.v24) || 0;
  const v7 = Number(item.v7) || 0;
  const v30 = Number(item.v30) || 0;
  const mv = Number(item.mv) || 0;
  const cf = Number(item.cf) || 0;
  const cfo = Number(item.cfo) || 0;
  const steamUsd = Number(item.s) || 0;
  const bidAskPct = cf > 0 && cfo > 0 ? (cfo / cf) * 100 : 0;

  // Smoothed weekly sales (real observed Skinport 7d + 30d/4.3 baseline)
  const sp7 = Math.max(v7, Math.round(v30 / 4.3));
  const isKnifeOrGlove = item.c === 'Knives' || item.c === 'Gloves';
  const isCapsule = item.c === 'Capsule';
  const isStatTrak = Boolean(item.st);
  const isSouvenir = Boolean(item.sv);

  // Composite sales speed score (0-100)
  let score = 0;
  score += Math.min(48, Math.log10(sp7 + 1) * 26);
  score += Math.min(34, Math.log10(mv + 1) * 14);
  if (v24 >= 5) score += 8;
  else if (v24 >= 1) score += 4;
  if (bidAskPct >= 92) score += 10;
  else if (bidAskPct >= 86) score += 6;
  else if (bidAskPct > 0 && bidAskPct < 78) score -= 18;

  // Structural slow-mover penalties (real CS2 market behavior)
  if (isCapsule && sp7 < 25) score -= 30;
  if (isSouvenir && sp7 < 20) score -= 28;
  if (isStatTrak && sp7 < 15 && mv < 90) score -= 22;
  if (isKnifeOrGlove && sp7 < 5) score -= 14;
  if (steamUsd >= 200 && sp7 < 4) score -= 10;

  score = Math.max(0, Math.min(100, Math.round(score)));

  // Tier classification
  let tier = 'D';
  let label = 'Zor Satılır';
  let shortLabel = 'Yavaş';
  let pillCls = 'pill-crimson';
  let extraSellDays = 8;
  let slowWarning = '';

  if (score >= 76 && (sp7 >= 20 || mv >= 240) && mv >= 40 && !isKnifeOrGlove) {
    tier = 'A';
    label = 'Çok Hızlı';
    shortLabel = 'Çok Hızlı';
    pillCls = 'pill-mint';
    extraSellDays = 0;
  } else if (score >= 58 && (sp7 >= 8 || mv >= 75) && mv >= 35) {
    tier = 'B';
    label = isKnifeOrGlove ? 'Orta-Hızlı' : 'Hızlı';
    shortLabel = isKnifeOrGlove ? 'Orta-Hızlı' : 'Hızlı';
    pillCls = isKnifeOrGlove ? 'pill-amber' : 'pill-ice';
    extraSellDays = isKnifeOrGlove ? 3 : 1;
    if (isKnifeOrGlove) {
      slowWarning = `7g: ${v7} satış • İyi kâr ancak bıçak/eldiven Steam satışı birkaç gün uzayabilir`;
    }
  } else if (score >= 38 && (sp7 >= 3 || mv >= 25)) {
    tier = 'C';
    label = 'Orta Hız';
    shortLabel = 'Orta';
    pillCls = 'pill-amber';
    extraSellDays = isKnifeOrGlove || steamUsd >= 180 ? 6 : 4;
    slowWarning = isKnifeOrGlove
      ? `7g: ${v7} satış • İyi kâr ancak bıçak/eldiven Steam satışı uzun sürebilir`
      : `7g: ${v7} satış • Satış hızı orta, birkaç gün bekletebilir`;
  } else {
    tier = 'D';
    label = 'Zor Satılır';
    shortLabel = 'Tuzak';
    pillCls = 'pill-crimson';
    extraSellDays = 14;
    slowWarning = `7g: ${v7} satış • Çok düşük talep, elinde kalma riski yüksek`;
  }

  // Estimated weekly Steam absorption capacity (Steam market typically moves ~5-12x Skinport volume)
  const estWeeklyCap = Math.max(
    4,
    Math.round(sp7 * 6 + mv * 0.45 + (item.c === 'Case' && mv > 500 ? mv * 0.5 : 0))
  );

  // Clean concise telemetry string for UI chips
  const volText =
    v24 > 0
      ? `24s: ${v24} • 7g: ${v7} satış`
      : v7 > 0
      ? `7g: ${v7} • 30g: ${v30} satış`
      : mv > 0
      ? `Hacim: ${mv} • 30g: ${v30}`
      : 'Düşük hacim';

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
    bidAskPct,
    estWeeklyCap,
    extraSellDays,
    slowWarning,
    volText,
    isKnifeOrGlove
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

  const steam30 = Number(item.s30) || steamUsd;
  const spikeRatio = steam30 > 0 ? (steamRaw - steam30) / steam30 : 0;
  const isSpiky = spikeRatio > 0.22 || spikeRatio < -0.22;

  const velocity = computeVelocityProfile(item);

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
      badge: 'Mikro Bütçe',
      rangeLabel: '< $75',
      advice: 'Düşük bütçede hızlı satılan $0.40–$5 arası kasa/skinler + $4–$20 popüler skinlerle içeride bakiye bırakmadan dönün.',
      minL1Price: 0.28,
      maxL1Price: Math.max(c * 0.85, 10),
      minL2Price: 2.5,
      maxL2Price: Math.max(c * 0.75, 22),
      defaultMaxQ1: 120,
      splitPlan: [
        { pct: 100, role: 'Tek Hızlı Likit Çift', note: 'Sermayeyi bölmeden yüksek tam-sayı verimi.' }
      ]
    };
  }
  if (c < 400) {
    return {
      id: 'STARTER',
      badge: 'Büyüme Bütçesi',
      rangeLabel: '$75 – $400',
      advice: 'En akıcı aralık: ister 1–10 adet hızlı üst skinle düşük eforlu dönün, ister yüksek hacimli kasalarla Steam bakiyesini büyütün.',
      minL1Price: 0.4,
      maxL1Price: c,
      minL2Price: 6,
      maxL2Price: Math.min(c * 0.65, 140),
      defaultMaxQ1: 180,
      splitPlan: [
        { pct: 70, role: 'Ana Hızlı Spread Eşyası', note: 'Yüksek 7g satış hacmiyle hızlı Steam çıkışı.' },
        { pct: 30, role: 'İkinci Likit Eşya', note: '7G hold fiyat oynaklık riskini dengeler.' }
      ]
    };
  }
  if (c < 1500) {
    return {
      id: 'PRO',
      badge: 'Orta-Üst Bütçe',
      rangeLabel: '$400 – $1.500',
      advice: 'Yüzlerce ucuz eşya yerine $5+ hızlı satılan skinler ve $30–$220 likit tüfeklerle az işlemde 14–16 gün içinde temiz döngü kurun.',
      minL1Price: Math.max(2, c / 160),
      maxL1Price: c,
      minL2Price: 18,
      maxL2Price: Math.min(c * 0.5, 360),
      defaultMaxQ1: 150,
      splitPlan: [
        { pct: 50, role: 'Ana Likit Skin / Kasa', note: 'Düşük adetle hızlı listeleme.' },
        { pct: 35, role: 'Popüler Tüfek / AWP Hattı', note: 'Yüksek CSFloat Bid/Ask ile anında nakit.' },
        { pct: 15, role: 'Nakit Fırsat Tamponu', note: 'Küsurat tamamlama & anlık fırsatlar.' }
      ]
    };
  }
  return {
    id: 'WHALE',
    badge: 'Yüksek Sermaye',
    rangeLabel: '$1.500+',
    advice: 'Yüksek sermayede binlerce ucuz kasa 1.000 slot sınırını aşar. $20+ yüksek hacimli popüler skinler ve likit bıçaklarla az parça, temiz likidite çalışın.',
    minL1Price: Math.max(10, c / 100),
    maxL1Price: c,
    minL2Price: 50,
    maxL2Price: Math.min(c * 0.45, 1100),
    defaultMaxQ1: 100,
    splitPlan: [
      { pct: 45, role: 'Hızlı Üst Bant Skin ($20+)', note: 'Az parça, yüksek 7g satış hacmi.' },
      { pct: 40, role: 'Likit Covert / Bıçak Hattı', note: 'Büyük bakiye taşıma gücü.' },
      { pct: 15, role: 'Buy-Order & Risk Tamponu', note: 'Volatilite ve hızlı çıkış rezervi.' }
    ]
  };
}

/**
 * Estimates real-world execution feasibility, sales velocity bottleneck,
 * order-book absorption, inventory slot burden, and realistic cycle duration.
 */
export function estimateExecutionReality(metrics, item1, item2, opts = {}) {
  const c1 = metrics.firstCycle;
  const q1 = c1.q1 || 0;
  const q2 = c1.q2 || 0;
  const depth1 = Number(item1?.q) || 0;
  const isCSFloat = opts.marketplace !== 'YOUPIN';

  const vel1 = computeVelocityProfile(item1);
  const vel2 = computeVelocityProfile(item2);

  let extraBuyDays = 0;
  let extraSellSteamDays = vel1.extraSellDays;
  let extraCashoutDays = opts.useBuyOrderForLeg2 ? 0 : vel2.extraSellDays;
  const reasons = [];

  // 1. Real Sales Velocity warnings (slow-selling items like Karambit or P2000 Turf)
  if (item1 && (vel1.tier === 'D' || vel1.tier === 'C')) {
    reasons.push(`1. Yön (${item1.n}): ${vel1.slowWarning || 'Satış hacmi düşük, Steam çıkışı uzayabilir.'}`);
  }
  if (item2 && (vel2.tier === 'D' || vel2.tier === 'C')) {
    reasons.push(`2. Yön (${item2.n}): ${vel2.slowWarning || 'Nakit dönüş satışı yavaş olabilir.'}`);
  }

  // 2. Quantity vs Weekly Market Absorption
  if (item1 && q1 > vel1.estWeeklyCap && q1 > 10) {
    const weeksNeeded = Math.min(8, Math.ceil(q1 / Math.max(1, vel1.estWeeklyCap)));
    extraSellSteamDays += weeksNeeded * 3;
    reasons.push(
      `1. Yönde ${q1.toLocaleString('tr-TR')} adet almak, bu eşyanın haftalık satış temposunun (~${vel1.estWeeklyCap} ad/hf) üzerinde; satış süresi uzar.`
    );
  }

  // 3. Extreme quantity / Steam 1,000-slot inventory & listing workload
  const storageUnits = q1 > 1000 ? Math.ceil((q1 - 950) / 1000) : 0;
  if (q1 > 2000) {
    extraBuyDays += Math.min(14, Math.ceil(q1 / 600));
    extraSellSteamDays += Math.min(20, Math.ceil(q1 / 450));
    reasons.push(
      `${q1.toLocaleString('tr-TR')} adet eşya tek seferde alınamaz/satılamaz: ${storageUnits} Storage Unit gerekir ve döngü haftalarca uzar.`
    );
  } else if (q1 > 950) {
    extraBuyDays += 3;
    extraSellSteamDays += 5;
    reasons.push(
      `${q1.toLocaleString('tr-TR')} adet CS2'nin 1.000 envanter slot sınırını aşıyor (${storageUnits} Storage Unit gerekir).`
    );
  } else if (q1 > 300) {
    extraBuyDays += 1;
    extraSellSteamDays += 2;
  }

  // 4. CSFloat Order-Book Absorption
  let bookRatio1 = 0;
  if (isCSFloat && depth1 > 0 && q1 > 0) {
    bookRatio1 = (q1 / depth1) * 100;
    if (bookRatio1 > 100) {
      extraBuyDays += Math.min(10, Math.ceil(q1 / Math.max(20, depth1)) * 2);
      reasons.push(
        `1. Yön adet (${q1.toLocaleString('tr-TR')}) mevcut CSFloat ilan derinliğinden (${depth1}) fazla — fiyat kayması (slippage) oluşur.`
      );
    } else if (bookRatio1 > 45) {
      extraBuyDays += 2;
    }
  }

  const totalExtra = extraBuyDays + extraSellSteamDays + extraCashoutDays;
  const minDays = 14 + Math.floor(totalExtra * 0.55);
  const maxDays = 14 + Math.max(totalExtra, 1);

  let level = 'smooth';
  let label = 'Akıcı (~14–15 Gün)';
  let pillCls = 'pill-mint';

  if (q1 > 1500 || bookRatio1 > 120 || vel1.tier === 'D' || vel2.tier === 'D' || maxDays >= 28) {
    level = 'impractical';
    label = `Pratik Değil (~${minDays}–${maxDays}+ Gün)`;
    pillCls = 'pill-crimson';
  } else if (q1 > 400 || vel1.tier === 'C' || vel2.tier === 'C' || maxDays >= 19) {
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
    vel1,
    vel2,
    reasons,
    needsUpperTierSuggestion: level === 'impractical' || level === 'slow'
  };
}

/**
 * Advanced Velocity-Aware, User-Filterable Multi-Strategy Capital Advisor
 *
 * filters:
 *  - style: 'ALL' | 'LOW_QTY' | 'FAST' | 'CASES' | 'PATIENT'
 *  - maxQty: 0 (auto) | 5 | 10 | 25 | 50 | 150
 *  - minSpeed: 'ULTRA' (A) | 'FAST' (A+B) | 'MODERATE' (A+B+C)
 *  - cleanOnly: true (exclude StatTrak, Souvenir, low-vol Capsules) | false
 */
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

    // Clean liquid filter eliminates slow traps (StatTrak, Souvenir, dead collector Capsules)
    if (cleanOnly) {
      if (item.st || item.sv) continue;
      if (item.c === 'Capsule' && (item.v7 || 0) < 35) continue;
    }

    const m = evaluateItemMetrics(item, opts);
    if (!m.hasValidMarket || m.isSpiky) continue;

    const vel = m.velocity;
    if (!allowedTiers.has(vel.tier)) continue;

    // Leg 1 eligibility
    const passCategoryL1 = style === 'CASES' ? item.c === 'Case' : true;
    if (
      passCategoryL1 &&
      m.effBuy >= 0.25 &&
      m.effBuy <= cap &&
      m.leg1ProfitPct >= 2.0 &&
      m.leg1ProfitPct <= 60
    ) {
      const q1Est = Math.floor(cap / m.effBuy);
      const bookOk = !isCSFloat || q1Est <= Math.max(8, qty * 0.6);
      const velCapOk = q1Est <= Math.max(10, vel.estWeeklyCap * 1.4);
      if (q1Est >= 1 && q1Est <= effectiveMaxQ1 && bookOk && velCapOk) {
        leg1Pool.push({ item, m, vel, qty, q1Est });
      }
    }

    // Leg 2 eligibility (cashout requires strong real velocity + healthy Bid/Ask + no illiquid price anomalies)
    const bidAskOk = !isCSFloat || vel.bidAskPct === 0 || vel.bidAskPct >= 82;
    const l2AllowedTier = minSpeed === 'MODERATE' ? allowedTiers.has(vel.tier) : vel.tier === 'A' || vel.tier === 'B';
    const l2MinPrice = Math.max(tier.minL2Price, cap / 45);
    const l2MinVol = minSpeed === 'MODERATE' || cap >= 1500 ? 15 : 45;
    const maxL2Loss = cap >= 1500 || minSpeed === 'MODERATE' ? 24 : 16;
    // Reject anomalous negative-loss items unless ultra-liquid (prevents low-volume trade-up float traps)
    const l2NotAnomaly = m.leg2LossPct >= 0.8 || (vel.tier === 'A' && vel.mktVol >= 150);
    if (
      l2AllowedTier &&
      bidAskOk &&
      l2NotAnomaly &&
      vel.mktVol >= l2MinVol &&
      m.steamUsd >= Math.min(l2MinPrice, cap * 0.45) &&
      m.steamUsd <= Math.max(tier.maxL2Price, cap * 1.25, 1900) &&
      m.leg2LossPct >= -1.5 &&
      m.leg2LossPct <= maxL2Loss
    ) {
      leg2Pool.push({ item, m, vel, qty });
    }
  }

  // Soft relaxation if user picked a strict filter (e.g., ULTRA + <= 5 qty on small budget)
  if (leg1Pool.length < 2) {
    for (const item of items) {
      if (cleanOnly && (item.st || item.sv || item.c === 'Capsule')) continue;
      if (style === 'CASES' && item.c !== 'Case') continue;
      const m = evaluateItemMetrics(item, opts);
      if (!m.hasValidMarket || m.isSpiky) continue;
      if (m.velocity.tier === 'D') continue;
      const q1Est = m.effBuy > 0 ? Math.floor(cap / m.effBuy) : 0;
      if (q1Est >= 1 && q1Est <= effectiveMaxQ1 && m.leg1ProfitPct >= 0.5 && m.leg1ProfitPct <= 60) {
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
      if (m.steamUsd >= 1 && m.steamUsd <= cap * 1.35 && m.leg2LossPct <= 15.5) {
        if (!leg2Pool.some((x) => x.item.n === item.n)) {
          leg2Pool.push({ item, m, vel: m.velocity, qty: item.q || 0 });
        }
      }
    }
  }

  // Diverse candidate selection: top profit, top velocity, AND low-quantity high-unit items!
  const l1ByProfit = [...leg1Pool].sort((a, b) => b.m.leg1ProfitPct - a.m.leg1ProfitPct).slice(0, 14);
  const l1BySpeed = [...leg1Pool].sort((a, b) => b.vel.score - a.vel.score || b.m.leg1ProfitPct - a.m.leg1ProfitPct).slice(0, 12);
  const l1LowQty = [...leg1Pool].filter((x) => x.q1Est <= 10).sort((a, b) => b.m.leg1ProfitPct - a.m.leg1ProfitPct).slice(0, 12);
  const l1Cases = [...leg1Pool].filter((x) => x.item.c === 'Case').sort((a, b) => b.m.leg1ProfitPct - a.m.leg1ProfitPct).slice(0, 8);

  const l2ByLoss = [...leg2Pool].sort((a, b) => a.m.leg2LossPct - b.m.leg2LossPct).slice(0, 14);
  const l2BySpeed = [...leg2Pool].sort((a, b) => b.vel.score - a.vel.score || a.m.leg2LossPct - b.m.leg2LossPct).slice(0, 12);

  const l1Candidates = Array.from(
    new Map([...l1ByProfit, ...l1BySpeed, ...l1LowQty, ...l1Cases].map((x) => [x.item.n, x])).values()
  );
  const l2Candidates = Array.from(new Map([...l2ByLoss, ...l2BySpeed].map((x) => [x.item.n, x])).values());

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

      // Enforce realistic Leg 2 cashout quantity limits (never buy 280x of an item that sells 15/wk!)
      const maxRealisticQ2 = Math.min(
        Math.max(20, Math.floor(l2.vel.estWeeklyCap * 1.2)),
        isCSFloat && l2.qty > 0 ? Math.max(12, Math.floor(l2.qty * 0.8)) : 60,
        style === 'LOW_QTY' ? Math.max(15, effectiveMaxQ1 * 2) : cap >= 1500 ? 60 : 35
      );
      if (c1.q2 > maxRealisticQ2) continue;

      const reality = estimateExecutionReality(sim, l1.item, l2.item, opts);
      const utilizedPct = c1.steamAfterLeg1 > 0 ? ((c1.steamAfterLeg1 - c1.steamWallet) / c1.steamAfterLeg1) * 100 : 0;
      const speedScore = Math.round((l1.vel.score + l2.vel.score) / 2);
      const roiPer14d = c1.netRoiPct * (14 / Math.max(14, reality.maxDays));
      const hasSlowLeg = l1.vel.tier === 'C' || l2.vel.tier === 'C' || l1.vel.isKnifeOrGlove || l2.vel.isKnifeOrGlove;

      evaluatedPairs.push({
        leg1: l1,
        leg2: l2,
        sim,
        c1,
        reality,
        utilizedPct,
        speedScore,
        roiPer14d,
        hasSlowLeg
      });
    }
  }

  const usedL1 = new Set();
  const usedL2Counts = new Map();
  const usedPairs = new Set();
  const strategies = [];

  const pickBest = (predicate, scorer, requireUniqueL1 = true) => {
    let best = null;
    let bestScore = -Infinity;
    for (const p of evaluatedPairs) {
      if (p.c1.netProfit <= 0) continue;
      if (!predicate(p)) continue;
      const pk = `${p.leg1.item.n}|${p.leg2.item.n}`;
      if (usedPairs.has(pk)) continue;
      if (requireUniqueL1 && usedL1.has(p.leg1.item.n)) continue;
      // Gently diversify Leg 2 across cards so user sees varied cashout skins
      const l2RepeatPenalty = (usedL2Counts.get(p.leg2.item.n) || 0) * 4.5;
      const sc = scorer(p) - l2RepeatPenalty;
      if (sc > bestScore) {
        bestScore = sc;
        best = p;
      }
    }
    if (!best && requireUniqueL1) {
      return pickBest(predicate, scorer, false);
    }
    return best;
  };

  const addStrategy = (id, tag, tagCls, title, reasonFn, pair) => {
    if (!pair) return;
    usedL1.add(pair.leg1.item.n);
    usedL2Counts.set(pair.leg2.item.n, (usedL2Counts.get(pair.leg2.item.n) || 0) + 1);
    usedPairs.add(`${pair.leg1.item.n}|${pair.leg2.item.n}`);
    const note = pair.leg1.vel.slowWarning || pair.leg2.vel.slowWarning || '';
    strategies.push({
      id,
      tag,
      tagCls,
      title,
      actionLine: `${pair.c1.q1}x al → Steam'de sat → ${pair.c1.q2}x ile nakde dön`,
      reason: reasonFn(pair),
      cautionNote: note,
      pair
    });
  };

  // Archetype 1: Low-Qty Precision Strike (1-10 fast items!)
  addStrategy(
    'LOW_QTY_STRIKE',
    'AZ PARÇA · HIZLI',
    'pill-gold',
    'Az Eşya, Zahmetsiz Döngü',
    (p) => `Sadece ${p.c1.q1} adet alım + ${p.c1.q2} adet dönüşle hızlı ve pratik nakit akışı.`,
    pickBest(
      (p) => p.c1.q1 <= 10 && p.leg1.vel.tier !== 'D',
      (p) => p.roiPer14d * 1.1 + p.speedScore * 0.25 + (p.c1.q1 <= 5 ? 6 : 0)
    )
  );

  // Archetype 2: Max Realistic Profit (speed-adjusted)
  addStrategy(
    'MAX_PROFIT',
    'MAKSİMUM KÂR',
    'pill-mint',
    'En Yüksek Gerçekçi Net Kâr',
    (p) => `Hız ve komisyon sonrası ~${p.reality.minDays}–${p.reality.maxDays} günde en yüksek net getiri.`,
    pickBest(
      (p) => !p.hasSlowLeg || minSpeed === 'MODERATE',
      (p) => p.roiPer14d + p.utilizedPct * 0.06
    )
  );

  // Archetype 3: Ultra-Fast Liquid Flow
  addStrategy(
    'ULTRA_FAST',
    'SÜPER LİKİT',
    'pill-ice',
    'En Hızlı Satılan Çift',
    (p) => `Her iki bacakta da yüksek 7g satış temposu (${p.speedScore}/100 hız skoru).`,
    pickBest(
      (p) => p.speedScore >= 68,
      (p) => p.speedScore * 0.8 + p.roiPer14d * 0.9 - p.reality.extraDays * 2
    )
  );

  // Archetype 4: Highest Capital Utilization (No Trapped Steam)
  addStrategy(
    'MAX_EFF',
    'YÜKSEK VERİM',
    'pill-gold',
    'En Az Atıl Steam Bakiyesi',
    (p) => `Steam bakiyesinin %${p.utilizedPct.toFixed(1)}'i anında nakde döner.`,
    pickBest(
      (p) => p.utilizedPct >= 88,
      (p) => p.utilizedPct * 1.3 + p.roiPer14d * 0.75 + p.speedScore * 0.15
    )
  );

  // Archetype 5: Active Liquid Cases Engine
  addStrategy(
    'LIQUID_CASES',
    'LİKİT KASA',
    'pill-mint',
    'Hızlı CS2 Kasa Motoru',
    (p) => `Yüksek haftalık kasa hacmiyle (${p.leg1.vel.volText}) güçlü Steam bakiye büyümesi.`,
    pickBest(
      (p) => p.leg1.item.c === 'Case' && p.leg1.vel.score >= 65,
      (p) => p.roiPer14d + p.leg1.vel.score * 0.2
    )
  );

  // Archetype 6: Patient High-Margin (Knives / Mid-Speed / Alternative Top ROI)
  addStrategy(
    'ALT_TOP',
    minSpeed === 'MODERATE' ? 'SABIRLI · YÜKSEK MARJ' : 'ALTERNATİF EN İYİ',
    minSpeed === 'MODERATE' ? 'pill-amber' : 'pill-muted',
    minSpeed === 'MODERATE' ? 'Yüksek Kâr (Satış Uzayabilir)' : 'Alternatif Dengeli Çift',
    (p) =>
      p.hasSlowLeg
        ? `Yüksek kâr potansiyeli — satış hızı orta olduğu için ~${p.reality.minDays}–${p.reality.maxDays} gün sürebilir.`
        : `Farklı eşya ile %${p.utilizedPct.toFixed(0)} verimli alternatif arbitraj hattı.`,
    pickBest(
      () => true,
      (p) => (minSpeed === 'MODERATE' ? p.c1.netRoiPct : p.roiPer14d + p.speedScore * 0.2)
    )
  );

  return {
    tier,
    effectiveMaxQ1,
    totalCandidates: evaluatedPairs.length,
    strategies: strategies.slice(0, 6),
    bestBenchmark: strategies[0]?.pair || null
  };
}

export function diagnoseCurrentSetup(metrics, advisorResult, reality) {
  const c1 = metrics.firstCycle;
  const alerts = [];

  if (c1.q1 === 0) {
    return [
      {
        level: 'danger',
        text: 'Başlangıç sermayesi 1 adet 1. yön eşyası almaya yetmiyor. Aşağıdan bütçene uygun bir strateji seç.'
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
      text: 'Steam bakiyesi 2. yön eşyasından 1 adet almaya yetmiyor. Daha uygun fiyatlı bir dönüş skini seç.'
    });
  } else if (trappedSteamPct > 18) {
    alerts.push({
      level: 'warn',
      text: `Steam bakiyenin %${trappedSteamPct.toFixed(1)}'i dönüş eşyasına yetmediği için içeride kalıyor.`
    });
  }

  if (metrics.netCycleRoiPct <= 0) {
    alerts.push({
      level: 'danger',
      text: 'Bu eşleşme mevcut komisyonlarla kâr üretmiyor (M₁ × M₂ ≤ 1.00).'
    });
  } else if (alerts.length === 0) {
    alerts.push({
      level: 'good',
      text: `Hızlı & Optimize: %${(100 - trappedSteamPct).toFixed(1)} aktif sermaye verimi • Tahmini süre ${reality?.minDays || 14}–${reality?.maxDays || 15} gün.`
    });
  }

  return alerts;
}
