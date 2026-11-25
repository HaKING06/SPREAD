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
 * Real-World Sales Velocity, Liquidity & Pattern-Anomaly Profiler
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
      bidAskPct: 0,
      estWeeklyCap: 20,
      extraSellDays: 2,
      slowWarning: '',
      volText: bi('No volume data', 'Hacim verisi yok'),
      isKnifeOrGlove: false,
      isPatternSensitive: false
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

  const sp7 = Math.max(v7, Math.round(v30 / 4.3));
  const isKnifeOrGlove = item.c === 'Knives' || item.c === 'Gloves';
  const isCapsule = item.c === 'Capsule';
  const isStatTrak = Boolean(item.st);
  const isSouvenir = Boolean(item.sv);
  const isPatternSensitive = PATTERN_SENSITIVE_RE.test(item.n || '');

  let score = 0;
  score += Math.min(48, Math.log10(sp7 + 1) * 26);
  score += Math.min(34, Math.log10(mv + 1) * 14);
  if (v24 >= 5) score += 8;
  else if (v24 >= 1) score += 4;
  if (bidAskPct >= 92) score += 10;
  else if (bidAskPct >= 86) score += 6;
  else if (bidAskPct > 0 && bidAskPct < 78) score -= 18;

  if (isCapsule && sp7 < 25) score -= 30;
  if (isSouvenir && sp7 < 20) score -= 28;
  if (isStatTrak && sp7 < 15 && mv < 90) score -= 22;
  if (isKnifeOrGlove && sp7 < 6) score -= 14;
  if (steamUsd >= 200 && sp7 < 5) score -= 10;

  score = Math.max(0, Math.min(100, Math.round(score)));

  let tier = 'D';
  let label = bi('Illiquid', 'Zor Satılır');
  let shortLabel = bi('Slow', 'Yavaş');
  let pillCls = 'pill-crimson';
  let extraSellDays = 8;
  let slowWarning = '';

  if (score >= 76 && (sp7 >= 20 || mv >= 240) && mv >= 40 && !isKnifeOrGlove) {
    tier = 'A';
    label = bi('Ultra Fast', 'Çok Hızlı');
    shortLabel = bi('Ultra Fast', 'Çok Hızlı');
    pillCls = 'pill-mint';
    extraSellDays = 0;
  } else if (score >= 58 && (sp7 >= 8 || mv >= 75) && mv >= 35) {
    tier = 'B';
    label = isKnifeOrGlove ? bi('Med-Fast', 'Orta-Hızlı') : bi('Fast', 'Hızlı');
    shortLabel = isKnifeOrGlove ? bi('Med-Fast', 'Orta-Hızlı') : bi('Fast', 'Hızlı');
    pillCls = isKnifeOrGlove ? 'pill-amber' : 'pill-ice';
    extraSellDays = isKnifeOrGlove ? 3 : 1;
    if (isKnifeOrGlove) {
      slowWarning = bi(
        `7d: ${v7} sales • Solid margin, but knives/gloves can take extra days on Steam`,
        `7g: ${v7} satış • İyi kâr ancak bıçak/eldiven Steam satışı birkaç gün uzayabilir`
      );
    }
  } else if (score >= 38 && (sp7 >= 3 || mv >= 25)) {
    tier = 'C';
    label = bi('Moderate', 'Orta Hız');
    shortLabel = bi('Moderate', 'Orta');
    pillCls = 'pill-amber';
    extraSellDays = isKnifeOrGlove || steamUsd >= 180 ? 6 : 4;
    slowWarning = isKnifeOrGlove
      ? bi(
          `7d: ${v7} sales • High profit, but selling knives/gloves on Steam takes patience`,
          `7g: ${v7} satış • İyi kâr ancak bıçak/eldiven Steam satışı uzun sürebilir`
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
    Math.round(sp7 * 6 + mv * 0.45 + (item.c === 'Case' && mv > 500 ? mv * 0.5 : 0))
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
    bidAskPct,
    estWeeklyCap,
    extraSellDays,
    slowWarning,
    volText,
    isKnifeOrGlove,
    isPatternSensitive
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

  // V2 Anti-Manipulation Price Guard: min(24h, 7d, 30d * 1.12) eliminates 7-day pump/pattern spikes
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

  const effBuy = calcEffectiveBuyUsd(marketBuyUsd, buyFeePct);
  const netSteam = calcNetSteamUsd(steamUsd, steamFeeMode, steamCustomFeePct);
  const m1 = effBuy > 0 && netSteam > 0 ? netSteam / effBuy : 0;
  const leg1ProfitPct = m1 > 0 ? (m1 - 1) * 100 : -100;

  const netSell = calcNetSellUsd(marketSellUsd, sellFeePct, withdrawFeePct);
  const m2 = steamUsd > 0 && netSell > 0 ? netSell / steamUsd : 0;
  const leg2LossPct = m2 > 0 ? (1 - m2) * 100 : 100;

  const spikeRatio = steam30 > 0 ? (steamRaw - steam30) / steam30 : 0;
  const isSpiky = spikeRatio > 0.22 || spikeRatio < -0.22;

  const velocity = computeVelocityProfile(item);
  const isAnomalySpread = (leg1ProfitPct > 42 && velocity.sold7d < 20) || (velocity.isPatternSensitive && leg1ProfitPct > 35);

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

  let extraBuyDays = 0;
  let extraSellSteamDays = vel1.extraSellDays;
  let extraCashoutDays = opts.useBuyOrderForLeg2 ? 0 : vel2.extraSellDays;
  const reasons = [];

  if (item1 && (vel1.tier === 'D' || vel1.tier === 'C')) {
    reasons.push(
      bi(
        `Leg 1 (${item1.n}): ${vel1.slowWarning || 'Low sales velocity may delay Steam exit.'}`,
        `1. Yön (${item1.n}): ${vel1.slowWarning || 'Satış hacmi düşük, Steam çıkışı uzayabilir.'}`
      )
    );
  }
  if (item2 && (vel2.tier === 'D' || vel2.tier === 'C')) {
    reasons.push(
      bi(
        `Leg 2 (${item2.n}): ${vel2.slowWarning || 'Cashout exit may sell slowly.'}`,
        `2. Yön (${item2.n}): ${vel2.slowWarning || 'Nakit dönüş satışı yavaş olabilir.'}`
      )
    );
  }

  if (item1 && q1 > vel1.estWeeklyCap && q1 > 10) {
    const weeksNeeded = Math.min(8, Math.ceil(q1 / Math.max(1, vel1.estWeeklyCap)));
    extraSellSteamDays += weeksNeeded * 3;
    reasons.push(
      bi(
        `Buying ${q1.toLocaleString('en-US')} units exceeds weekly market absorption (~${vel1.estWeeklyCap}/wk); selling will take longer.`,
        `1. Yönde ${q1.toLocaleString('tr-TR')} adet almak haftalık satış temposunun (~${vel1.estWeeklyCap} ad/hf) üzerinde; satış süresi uzar.`
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
          `Leg 1 count (${q1.toLocaleString('en-US')}) exceeds active CSFloat listings (${depth1}) — price slippage guaranteed.`,
          `1. Yön adet (${q1.toLocaleString('tr-TR')}) mevcut CSFloat ilan derinliğinden (${depth1}) fazla — fiyat kayması (slippage) oluşur.`
        )
      );
    } else if (bookRatio1 > 45) {
      extraBuyDays += 2;
    }
  }

  const totalExtra = extraBuyDays + extraSellSteamDays + extraCashoutDays;
  const minDays = 14 + Math.floor(totalExtra * 0.55);
  const maxDays = 14 + Math.max(totalExtra, 1);

  let level = 'smooth';
  let label = bi('Smooth (~14–15 Days)', 'Akıcı (~14–15 Gün)');
  let pillCls = 'pill-mint';

  if (q1 > 1500 || bookRatio1 > 120 || vel1.tier === 'D' || vel2.tier === 'D' || maxDays >= 28) {
    level = 'impractical';
    label = bi(`Impractical (~${minDays}–${maxDays}+ Days)`, `Pratik Değil (~${minDays}–${maxDays}+ Gün)`);
    pillCls = 'pill-crimson';
  } else if (q1 > 400 || vel1.tier === 'C' || vel2.tier === 'C' || maxDays >= 19) {
    level = 'slow';
    label = bi(`Extended (~${minDays}–${maxDays} Days)`, `Süre Uzar (~${minDays}–${maxDays} Gün)`);
    pillCls = 'pill-amber';
  } else if (totalExtra >= 2) {
    level = 'moderate';
    label = bi(`Moderate (~${minDays}–${maxDays} Days)`, `Orta Efor (~${minDays}–${maxDays} Gün)`);
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
 * Computes an honest 0-100% Quant Confidence Score for a candidate pair.
 */
function computePairConfidence(l1, l2, c1, reality) {
  let conf = 100;
  // Velocity confidence
  const avgVel = (l1.vel.score + l2.vel.score) / 2;
  if (avgVel < 80) conf -= Math.round((80 - avgVel) * 0.45);

  // Pattern / float / high-spread anomaly penalties
  if (l1.m.isAnomalySpread) conf -= 18;
  if (l1.vel.isPatternSensitive) conf -= 9;
  if (l2.vel.isPatternSensitive) conf -= 8;
  if (l2.m.leg2LossPct < 2.5 && l2.vel.tier !== 'A') conf -= 14;

  // Bid/Ask tightness on Leg 2 cashout
  if (l2.vel.bidAskPct > 0 && l2.vel.bidAskPct < 88) conf -= 8;

  // Absorption & extra duration penalties
  if (reality.extraDays > 2) conf -= Math.min(18, reality.extraDays * 2);
  if (c1.q1 > l1.vel.estWeeklyCap * 0.6) conf -= 7;

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

    // Leg 1 eligibility (guard against pattern-inflated phantom >45% spreads in FAST mode)
    const passCategoryL1 = style === 'CASES' ? item.c === 'Case' : true;
    const passAnomalyL1 = minSpeed === 'MODERATE' ? true : !m.isAnomalySpread;
    if (
      passCategoryL1 &&
      passAnomalyL1 &&
      m.effBuy >= 0.25 &&
      m.effBuy <= cap &&
      m.leg1ProfitPct >= 2.0 &&
      m.leg1ProfitPct <= 58
    ) {
      const q1Est = Math.floor(cap / m.effBuy);
      const bookOk = !isCSFloat || q1Est <= Math.max(8, qty * 0.6);
      const velCapOk = q1Est <= Math.max(10, vel.estWeeklyCap * 1.4);
      if (q1Est >= 1 && q1Est <= effectiveMaxQ1 && bookOk && velCapOk) {
        leg1Pool.push({ item, m, vel, qty, q1Est });
      }
    }

    // Leg 2 eligibility: strictly eliminate thin-book FN float-overpay anomalies & excessive losses
    const bidAskOk = !isCSFloat || vel.bidAskPct === 0 || vel.bidAskPct >= 83;
    const l2AllowedTier = minSpeed === 'MODERATE' ? allowedTiers.has(vel.tier) : vel.tier === 'A' || vel.tier === 'B';
    const l2MinPrice = Math.max(tier.minL2Price, cap / 45);
    const l2MinVol = minSpeed === 'MODERATE' || cap >= 1500 ? 18 : 45;
    const maxL2Loss = cap >= 1500 || minSpeed === 'MODERATE' ? 23 : 14.5;
    const l2NotAnomaly = m.leg2LossPct >= 3.0 || (vel.tier === 'A' && vel.mktVol >= 150 && m.leg2LossPct >= 0.5);

    if (
      l2AllowedTier &&
      bidAskOk &&
      l2NotAnomaly &&
      vel.mktVol >= l2MinVol &&
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
      const hasSlowLeg =
        l1.vel.tier === 'C' || l2.vel.tier === 'C' || l1.vel.isKnifeOrGlove || l2.vel.isKnifeOrGlove;
      const confidenceScore = computePairConfidence(l1, l2, c1, reality);

      evaluatedPairs.push({
        leg1: l1,
        leg2: l2,
        sim,
        c1,
        reality,
        utilizedPct,
        speedScore,
        roiPer14d,
        hasSlowLeg,
        confidenceScore
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

  const addStrategy = (id, tagFn, tagClsFn, titleFn, pair) => {
    if (!pair) return;
    usedL1.add(pair.leg1.item.n);
    usedL2Counts.set(pair.leg2.item.n, (usedL2Counts.get(pair.leg2.item.n) || 0) + 1);
    usedPairs.add(`${pair.leg1.item.n}|${pair.leg2.item.n}`);

    let note = pair.leg1.vel.slowWarning || pair.leg2.vel.slowWarning || '';
    if (!note && (pair.leg1.m.isAnomalySpread || pair.leg1.vel.isPatternSensitive)) {
      note = bi(
        'Pattern/float sensitive skin — verify lowest clean listing before buying',
        'Pattern/float duyarlı skin — almadan önce en ucuz temiz ilanı kontrol et'
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

  // 1. Low-Count Precision Strike (HONEST dynamic label: Fast vs Patient!)
  addStrategy(
    'LOW_QTY_STRIKE',
    (p) => (p.hasSlowLeg ? bi('LOW-COUNT · PATIENT', 'AZ İŞLEM · SABIRLI') : bi('LOW-COUNT · FAST', 'AZ İŞLEM · HIZLI')),
    (p) => (p.hasSlowLeg ? 'pill-amber' : 'pill-gold'),
    bi('Minimal Clicks, Clean Cycle', 'Az Eşya, Zahmetsiz Döngü'),
    pickBest(
      (p) => p.c1.q1 <= 10 && (!p.hasSlowLeg || minSpeed === 'MODERATE'),
      (p) => p.roiPer14d * 1.05 + p.confidenceScore * 0.25 + (p.c1.q1 <= 5 ? 5 : 0)
    )
  );

  // 2. Max Realistic Profit (speed & confidence weighted)
  addStrategy(
    'MAX_PROFIT',
    bi('MAX NET PROFIT', 'MAKSİMUM KÂR'),
    'pill-mint',
    bi('Highest Realistic 14d Return', 'En Yüksek Gerçekçi Net Kâr'),
    pickBest(
      (p) => !p.hasSlowLeg || minSpeed === 'MODERATE',
      (p) => p.roiPer14d + p.confidenceScore * 0.14 + p.utilizedPct * 0.05
    )
  );

  // 3. Fastest Liquid Cash Flow (strictly fast Tier A+B only!)
  addStrategy(
    'ULTRA_FAST',
    bi('FASTEST LIQUID', 'EN HIZLI NAKİT'),
    'pill-ice',
    bi('Top Sales Velocity Pair', 'En Hızlı Satılan Çift'),
    pickBest(
      (p) => !p.hasSlowLeg && p.speedScore >= 68,
      (p) => p.speedScore * 0.8 + p.roiPer14d * 0.85 + p.confidenceScore * 0.2
    )
  );

  // 4. Highest Capital Efficiency
  addStrategy(
    'MAX_EFF',
    bi('HIGH EFFICIENCY', 'YÜKSEK VERİM'),
    'pill-gold',
    bi('Minimal Trapped Steam Balance', 'En Az Atıl Steam Bakiyesi'),
    pickBest(
      (p) => p.utilizedPct >= 88 && (!p.hasSlowLeg || minSpeed === 'MODERATE'),
      (p) => p.utilizedPct * 1.3 + p.roiPer14d * 0.75 + p.confidenceScore * 0.15
    )
  );

  // 5. Active Liquid Cases Engine
  addStrategy(
    'LIQUID_CASES',
    bi('CASE ENGINE', 'KASA MOTORU'),
    'pill-mint',
    bi('High-Volume CS2 Cases', 'Hızlı CS2 Kasa Motoru'),
    pickBest(
      (p) => p.leg1.item.c === 'Case' && p.leg1.vel.score >= 65,
      (p) => p.roiPer14d + p.leg1.vel.score * 0.2
    )
  );

  // 6. High Margin / Alternative Best
  addStrategy(
    'ALT_TOP',
    (p) => (p.hasSlowLeg ? bi('PATIENT · HIGH MARGIN', 'SABIRLI · YÜKSEK MARJ') : bi('BALANCED ALT', 'ALTERNATİF EN İYİ')),
    (p) => (p.hasSlowLeg ? 'pill-amber' : 'pill-muted'),
    (p) => (p.hasSlowLeg ? bi('Higher Profit (Allow Extra Time)', 'Yüksek Kâr (Satış Uzayabilir)') : bi('Balanced Alternative Lane', 'Alternatif Dengeli Çift')),
    pickBest(
      () => true,
      (p) => (minSpeed === 'MODERATE' ? p.c1.netRoiPct + p.confidenceScore * 0.15 : p.roiPer14d + p.confidenceScore * 0.22)
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
