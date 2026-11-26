/**
 * SPREAD (spread.haking.tr) — SPREAD Agent V6 Multi-Asset Portfolio & Basket Optimizer
 *
 * Institutional Quantitative Execution Engine:
 *  1. Historical Multi-Horizon Volatility (sigma7d / sigma14d) & Exact Probability of Profit (PoP %)
 *  2. Almgren-Chriss Concave Square-Root Market Impact (Slippage) per Asset
 *  3. Parallel Order-Book Queue Clearing (Splitting 30x single skin -> 2-4 parallel books cuts wait days!)
 *  4. Bounded Integer Knapsack Solver for Leg 1 (Deploys idle cash automatically up to 97-99%!)
 *  5. Marginal-Utility Allocator for Leg 2 (Smart unequal splits e.g. 17x + 12x based on speed, margin & floor)
 *  6. Auto-Count Advisory (Tells user when 2 exits strictly dominate 3 exits, with exact dollar & speed proof)
 */

import { isTr } from './i18n.js';
import {
  calcEffectiveBuyUsd,
  calcExactValveSteamFee,
  calcNetSellUsd,
  calcNetSteamUsd,
  computeLoopMetrics,
  computeVelocityProfile,
  estimateExecutionReality,
  evaluateItemMetrics,
  getCapitalTierInfo
} from './math-engine.js';

const bi = (en, tr) => (isTr() ? tr : en);

/**
 * High-precision Standard Normal CDF (Abramowitz & Stegun 7.1.26, error < 7.5e-8)
 */
export function normalCdf(z) {
  if (!Number.isFinite(z)) return 0.5;
  if (z < -8) return 0;
  if (z > 8) return 1;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t);
  const erf = 1 - poly * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

/**
 * Estimates realistic 7-day trade-hold price volatility (sigma7d %) from 24h/7d/30d/90d history
 */
export function computeItemVolatility7d(item, metrics = null) {
  if (!item) return 4.5;
  const s = Number(item.s) || 0;
  const s7 = Number(item.s7) || s;
  const s30 = Number(item.s30) || s7;
  const s90 = Number(item.s90) || s30;

  const d7 = s7 > 0 ? Math.min(0.24, Math.abs(s - s7) / s7) : 0;
  const d30 = s30 > 0 ? Math.min(0.22, (Math.abs(s7 - s30) / s30) * 0.55) : 0;
  const d90 = s90 > 0 ? Math.min(0.18, (Math.abs(s30 - s90) / s90) * 0.35) : 0;
  const histVolPct = Math.max(d7, d30, d90) * 100;

  let basePct = 2.8;
  if (item.c === 'Knives' || item.c === 'Gloves') basePct = 4.1;
  else if (item.c === 'Case') basePct = 3.5;
  else if (item.c === 'Capsule') basePct = 5.0;

  const vel = metrics?.velocity || computeVelocityProfile(item);
  let addons = 0;
  if (vel.isPatternSensitive) addons += 1.5;
  if (metrics?.trendStatus === 'FALLING') addons += 2.2;
  if (vel.tier === 'C' || vel.tier === 'D') addons += 1.4;

  const sigma = basePct * 0.45 + histVolPct * 0.55 + addons;
  return Math.round(Math.max(2.4, Math.min(18.0, sigma)) * 100) / 100;
}

/**
 * Diversified 2-Leg Portfolio Volatility (CS2 intra-market correlation rho = 0.35)
 * + Probability of Profit (PoP %) + 10th-Percentile Downside Stress Case
 */
export function computePortfolioRisk(leg1Weights, leg2Weights, expectedRoiPct, capitalUsd = 200) {
  const RHO = 0.35;
  const calcLegSigma = (entries) => {
    if (!entries || entries.length === 0) return 4.5;
    let sumW = 0;
    for (const e of entries) sumW += Math.max(0, e.weight || 0);
    if (sumW <= 0) return 4.5;
    const norm = entries.map((e) => ({ w: Math.max(0, e.weight || 0) / sumW, s: e.sigma || 4.0 }));
    let variance = 0;
    for (let i = 0; i < norm.length; i++) {
      variance += norm[i].w * norm[i].w * norm[i].s * norm[i].s;
      for (let j = i + 1; j < norm.length; j++) {
        variance += 2 * RHO * norm[i].w * norm[j].w * norm[i].s * norm[j].s;
      }
    }
    return Math.sqrt(Math.max(0.5, variance));
  };

  const sigma1 = calcLegSigma(leg1Weights);
  const sigma2 = calcLegSigma(leg2Weights);
  const sigma14dPct = Math.round(Math.sqrt(sigma1 * sigma1 + sigma2 * sigma2) * 100) / 100;
  const z = expectedRoiPct / Math.max(1.5, sigma14dPct);
  const popPct = Math.round(Math.min(99.9, Math.max(5.0, normalCdf(z) * 100)) * 10) / 10;
  const downside10RoiPct = Math.round((expectedRoiPct - 1.28 * sigma14dPct) * 100) / 100;
  const downside10ProfitUsd = Math.round(((capitalUsd * downside10RoiPct) / 100) * 100) / 100;

  return {
    sigma1Pct: Math.round(sigma1 * 100) / 100,
    sigma2Pct: Math.round(sigma2 * 100) / 100,
    sigma14dPct,
    popPct,
    downside10RoiPct,
    downside10ProfitUsd
  };
}

/**
 * Quick risk summary for any single pair (used on standard SPREAD Agent card too!)
 */
export function computeSinglePairRisk(pair, capitalUsd) {
  const s1 = computeItemVolatility7d(pair.leg1.item, pair.leg1.m);
  const s2 = computeItemVolatility7d(pair.leg2.item, pair.leg2.m);
  return computePortfolioRisk(
    [{ weight: 1, sigma: s1 }],
    [{ weight: 1, sigma: s2 }],
    pair.slippageAdjRoi ?? pair.c1.netRoiPct,
    capitalUsd
  );
}

function estimateLeg1FillDays(item, vel, qty) {
  if (qty <= 0) return 0;
  const fill = Math.min(18, Math.max(0, Math.ceil(qty / Math.max(0.25, vel.estDailySales * 0.85)) - 1));
  return Math.max(vel.extraSellDays, fill);
}

function estimateLeg2FillDays(item, vel, qty, useBuyOrder = false) {
  if (useBuyOrder || qty <= 0) return 0;
  const queueEff =
    vel.turnover30Pct > 0 && vel.turnover30Pct < 15 && (Number(item?.q) || 0) >= 250
      ? 0.6
      : vel.turnover30Pct > 0 && vel.turnover30Pct < 22 && (Number(item?.q) || 0) >= 250
        ? 0.78
        : 0.95;
  const fill = Math.min(14, Math.max(0, Math.ceil(qty / Math.max(0.35, vel.estDailySales * queueEff)) - 1));
  return Math.max(vel.extraSellDays, fill);
}

function calcSlipPct(qty, depth, coeff) {
  if (qty <= 1) return 0;
  return Math.min(4.5, coeff * Math.sqrt(qty / Math.max(15, depth || 30)));
}

function buildLeg1Line(cand, qty, opts) {
  const spentUsd = qty * cand.m.effBuy;
  const netSteamUsd = qty * cand.m.netSteam;
  const slipPct = calcSlipPct(qty, cand.qty, 1.8);
  const slippageUsd = spentUsd * (slipPct / 100);
  const fillDays = estimateLeg1FillDays(cand.item, cand.vel, qty);
  const sigma7d = computeItemVolatility7d(cand.item, cand.m);
  const dailyPace = cand.item?.stHist
    ? Math.max(0.08, (Number(cand.item.st7) || 0) / 7 * 0.65 + (Number(cand.item.st30) || 0) / 30 * 0.35)
    : cand.item?.st24Checked
      ? Math.max(0.15, Number(cand.item.st24) || 0)
      : Math.max(0.25, cand.vel?.estDailySales || 0.5);
  const daysOfVol = Math.round((qty / dailyPace) * 10) / 10;
  return {
    item: cand.item,
    m: cand.m,
    vel: cand.vel,
    qty,
    unitBuyUsd: cand.m.marketBuyUsd,
    unitEffBuyUsd: cand.m.effBuy,
    unitSteamUsd: cand.m.steamSellUsd || cand.m.steamUsd,
    unitNetSteamUsd: cand.m.netSteam,
    spentUsd,
    netSteamUsd,
    slipPct: Math.round(slipPct * 100) / 100,
    slippageUsd,
    fillDays,
    daysOfVol,
    dailyPace: Math.round(dailyPace * 10) / 10,
    sigma7d
  };
}

function buildLeg2Line(cand, qty, opts) {
  const isCSFloat = opts.marketplace !== 'YOUPIN';
  const steamCostUsd = qty * cand.m.steamUsd;
  const cashReturnUsd = qty * cand.m.netSell;
  const slipPct = opts.useBuyOrderForLeg2 ? 0 : calcSlipPct(qty, cand.qty, 1.5);
  const slippageUsd = cashReturnUsd * (slipPct / 100);
  const instSell = isCSFloat
    ? cand.item.cfo > 0
      ? cand.item.cfo
      : cand.m.marketSellUsd
    : cand.item.ypo > 0
      ? cand.item.ypo
      : cand.m.marketSellUsd;
  const instNetUnit = calcNetSellUsd(instSell, opts.sellFeePct, opts.withdrawFeePct);
  const instantCashUsd = qty * instNetUnit;
  const fillDays = estimateLeg2FillDays(cand.item, cand.vel, qty, opts.useBuyOrderForLeg2);
  const sigma7d = computeItemVolatility7d(cand.item, cand.m);
  const dailyPace =
    isCSFloat && cand.item?.cfLive
      ? Math.max(0.35, Number(cand.item.cf24) || 0, (Number(cand.item.cf7) || 0) / 7)
      : Math.max(0.35, cand.vel?.estDailySales || 0.5, (Number(cand.vel?.sold7d) || 0) / 7);
  const daysOfVol = Math.round((qty / dailyPace) * 10) / 10;
  return {
    item: cand.item,
    m: cand.m,
    vel: cand.vel,
    qty,
    unitSteamUsd: cand.m.steamUsd,
    unitSellUsd: cand.m.marketSellUsd,
    unitNetSellUsd: cand.m.netSell,
    unitInstantSellUsd: instSell,
    unitInstantNetUsd: instNetUnit,
    steamCostUsd,
    cashReturnUsd,
    instantCashUsd,
    slipPct: Math.round(slipPct * 100) / 100,
    slippageUsd,
    fillDays,
    daysOfVol,
    dailyPace: Math.round(dailyPace * 10) / 10,
    sigma7d
  };
}

function scoreLeg1Basket(lines, cap) {
  if (!lines || lines.length === 0) return -Infinity;
  let totalSpent = 0;
  let totalNetSteam = 0;
  let totalSlip = 0;
  let maxFill = 0;
  let buffBonusSum = 0;
  let steamZeroPenSum = 0;
  for (const l of lines) {
    totalSpent += l.spentUsd;
    totalNetSteam += l.netSteamUsd;
    totalSlip += l.slippageUsd;
    if (l.fillDays > maxFill) maxFill = l.fillDays;
    const w = l.spentUsd / Math.max(1, cap);
    if (l.m.isBelowBuff) buffBonusSum += 3.2 * w;
    if (l.m.isOverBuff) buffBonusSum -= 4.0 * w;
    if (l.m.trendStatus === 'FALLING') buffBonusSum -= 5.0 * w;
    if (l.item?.stHist) {
      if ((Number(l.item.st7) || 0) <= 4 && (l.vel?.steamBidAskPct || 0) < 94) {
        steamZeroPenSum += ((Number(l.item.st7) || 0) <= 2 ? 10.5 : 8.5) * w;
      } else if (Number(l.item.st24) === 0 && (Number(l.item.st7) || 0) < 10) {
        steamZeroPenSum += 3.5 * w;
      }
      if ((l.m?.askOverSalePct || 0) >= 6) {
        steamZeroPenSum += Math.min(6, (l.m.askOverSalePct - 4) * 0.7) * w;
      }
    } else if (l.item?.st24Checked && Number(l.item.st24) === 0 && (l.vel?.steamBidAskPct || 0) < 92) {
      steamZeroPenSum += 8.0 * w;
    }
  }
  const idleCash = Math.max(0, cap - totalSpent);
  // Estimate steam-to-cash value with ~0.90 conservative M2 proxy for comparing Leg 1 baskets
  const estCashVal = idleCash + (totalNetSteam - totalSlip) * 0.9;
  const estRoi = ((estCashVal - cap) / Math.max(1, cap)) * 100;
  const timeAdj = estRoi * (14 / Math.max(14, 14 + maxFill));
  const deployBonus = (totalSpent / Math.max(1, cap)) * 3.5;
  const sigma1 = computePortfolioRisk(
    lines.map((l) => ({ weight: l.spentUsd, sigma: l.sigma7d })),
    [{ weight: 1, sigma: 3.0 }],
    estRoi,
    cap
  ).sigma1Pct;
  return timeAdj * 1.45 + deployBonus + buffBonusSum - steamZeroPenSum - sigma1 * 0.45 - Math.max(0, maxFill - 3) * 1.1;
}

function maxSafeQtyL1(cand, cap, effectiveMaxQ1, isCSFloat) {
  const byBudget = Math.floor(cap / Math.max(0.01, cand.m.effBuy));
  const byBook = isCSFloat ? Math.max(6, Math.floor(cand.qty * 0.48)) : effectiveMaxQ1;
  const byVel = Math.max(8, Math.floor(cand.vel.estWeeklyCap * 1.15));
  return Math.max(0, Math.min(byBudget, byBook, byVel, effectiveMaxQ1));
}

function solveLeg1TopForCount(cands, cap, k, opts, effectiveMaxQ1, topN = 3) {
  const isCSFloat = opts.marketplace !== 'YOUPIN';
  const top = cands.slice(0, 14);
  if (top.length < k) return [];

  const bestByKey = new Map();

  const tryLines = (rawPairs) => {
    const valid = rawPairs.filter((x) => x.qty > 0);
    if (valid.length !== k) return;
    let spent = 0;
    for (const x of valid) spent += x.qty * x.cand.m.effBuy;
    if (spent > cap + 0.01) return;
    const lines = valid.map((x) => buildLeg1Line(x.cand, x.qty, opts));
    const sc = scoreLeg1Basket(lines, cap);
    const key = lines
      .map((l) => l.item.n)
      .sort()
      .join('|');
    const prev = bestByKey.get(key);
    if (!prev || sc > prev.score) {
      bestByKey.set(key, { lines, score: sc });
    }
  };

  if (k === 1) {
    for (const c of top) {
      const q = maxSafeQtyL1(c, cap, effectiveMaxQ1, isCSFloat);
      if (q > 0) tryLines([{ cand: c, qty: q }]);
    }
  } else if (k === 2) {
    const splits = [
      [1.0, 1.0],   // Knapsack remainder: fill A first, then deploy idle cash into B!
      [0.65, 0.35], // Core + secondary diversification
      [0.5, 0.5]    // Equal risk split
    ];
    for (let i = 0; i < top.length; i++) {
      for (let j = i + 1; j < top.length; j++) {
        const a = top[i];
        const b = top[j];
        for (const [wa, wb] of splits) {
          // Order A -> B
          const capA = wa === 1.0 ? cap : cap * wa;
          let qA = maxSafeQtyL1(a, capA, effectiveMaxQ1, isCSFloat);
          if (wa === 1.0 && qA > 0 && cap - qA * a.m.effBuy < b.m.effBuy && qA > 1) {
            qA -= 1;
          }
          if (qA > 0) {
            const rem = cap - qA * a.m.effBuy;
            const qB = maxSafeQtyL1(b, rem, effectiveMaxQ1, isCSFloat);
            if (qB > 0) tryLines([{ cand: a, qty: qA }, { cand: b, qty: qB }]);
          }
          // Order B -> A for Knapsack
          if (wa === 1.0) {
            let qB2 = maxSafeQtyL1(b, cap, effectiveMaxQ1, isCSFloat);
            if (qB2 > 0 && cap - qB2 * b.m.effBuy < a.m.effBuy && qB2 > 1) qB2 -= 1;
            if (qB2 > 0) {
              const rem2 = cap - qB2 * b.m.effBuy;
              const qA2 = maxSafeQtyL1(a, rem2, effectiveMaxQ1, isCSFloat);
              if (qA2 > 0) tryLines([{ cand: b, qty: qB2 }, { cand: a, qty: qA2 }]);
            }
          }
        }
      }
    }
  } else {
    // k === 3
    const top3 = top.slice(0, 10);
    const splits3 = [
      [1.0, 1.0, 1.0],   // Knapsack cascade
      [0.5, 0.3, 0.2],   // Tiered core-satellite
      [0.34, 0.33, 0.33] // Equal diversification
    ];
    for (let i = 0; i < top3.length; i++) {
      for (let j = i + 1; j < top3.length; j++) {
        for (let m = j + 1; m < top3.length; m++) {
          const triad = [top3[i], top3[j], top3[m]];
          for (const sp of splits3) {
            let rem = cap;
            const picks = [];
            for (let idx = 0; idx < 3; idx++) {
              const c = triad[idx];
              const minFutureCost = triad.slice(idx + 1).reduce((acc, x) => acc + x.m.effBuy, 0);
              const targetBudget = sp[0] === 1.0 ? Math.max(0, rem - minFutureCost) : Math.min(rem - minFutureCost, cap * sp[idx]);
              const q = maxSafeQtyL1(c, targetBudget, effectiveMaxQ1, isCSFloat);
              if (q <= 0) break;
              picks.push({ cand: c, qty: q });
              rem -= q * c.m.effBuy;
            }
            if (picks.length === 3) {
              for (const p of picks) {
                const extraCap = maxSafeQtyL1(p.cand, rem, effectiveMaxQ1 - p.qty, isCSFloat);
                if (extraCap > 0) {
                  p.qty += extraCap;
                  rem -= extraCap * p.cand.m.effBuy;
                }
              }
              tryLines(picks);
            }
          }
        }
      }
    }
  }

  return Array.from(bestByKey.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((x) => x.lines);
}

/**
 * Marginal-Utility Integer Allocator for Leg 2 Parallel Cashout Basket:
 * Distributes Steam Wallet across subset `subset` unit-by-unit to balance:
 *   - Net Cash Return (72% Ask + 28% Instant Buy-Order Floor)
 *   - Concave Square-Root Market Impact (Almgren-Chriss)
 *   - Parallel Queue Clearing Time (keeps max(fillDays) minimized across all books!)
 *   - Concentration Guard (avoids dumping 95% into 1 skin when splitting across 2-4 skins)
 */
function allocateSteamAcrossSubset(subset, steamWalletUsd, opts, capitalUsd) {
  const k = subset.length;
  const isCSFloat = opts.marketplace !== 'YOUPIN';
  const qtys = new Array(k).fill(0);
  const maxQtys = subset.map((c) =>
    Math.max(
      1,
      Math.min(
        Math.floor(steamWalletUsd / Math.max(0.01, c.m.steamUsd)),
        isCSFloat && c.qty > 0 ? Math.max(6, Math.floor(c.qty * 0.55)) : 50,
        Math.max(8, Math.floor(c.vel.estWeeklyCap * 1.15)),
        capitalUsd >= 1500 ? 50 : 35
      )
    )
  );

  let rem = steamWalletUsd;

  // Step 1: Seed meaningful participation for every skin in the subset (prevents silly 1x 2% dust fillers!)
  const minSharePerSkin = k === 1 ? 1.0 : k === 2 ? 0.24 : k === 3 ? 0.16 : 0.12;
  for (let i = 0; i < k; i++) {
    if (rem + 0.001 < subset[i].m.steamUsd || maxQtys[i] < 1) return null;
    qtys[i] = 1;
    rem -= subset[i].m.steamUsd;
  }
  if (k >= 2) {
    for (let i = 0; i < k; i++) {
      const c = subset[i];
      const targetMinUsd = steamWalletUsd * minSharePerSkin;
      while (qtys[i] * c.m.steamUsd < targetMinUsd && qtys[i] < maxQtys[i] && c.m.steamUsd <= rem + 0.001) {
        // Don't force-seed into a skin if doing so already creates >4d queue wait
        const nextFill = estimateLeg2FillDays(c.item, c.vel, qtys[i] + 1, opts.useBuyOrderForLeg2);
        if (nextFill > 4 && qtys[i] >= 2) break;
        qtys[i] += 1;
        rem -= c.m.steamUsd;
      }
    }
  }

  // Compute helper metrics for each skin (respects active marketplace instant Buy Order!)
  const unitInstM2 = subset.map((c) => {
    const instSell = isCSFloat
      ? c.item.cfo > 0
        ? c.item.cfo
        : c.m.marketSellUsd
      : c.item.ypo > 0
        ? c.item.ypo
        : c.m.marketSellUsd;
    const instNet = calcNetSellUsd(instSell, opts.sellFeePct, opts.withdrawFeePct);
    return c.m.steamUsd > 0 ? instNet / c.m.steamUsd : 0;
  });
  const maxShareSoft = k === 1 ? 1.0 : k === 2 ? 0.64 : k === 3 ? 0.48 : 0.38;

  // Step 2: Marginal-utility unit-by-unit allocator (Almgren-Chriss + Parallel Queue Balancer)
  let guard = 0;
  while (guard < 160) {
    guard += 1;
    let curMaxFill = 0;
    for (let i = 0; i < k; i++) {
      const fd = estimateLeg2FillDays(subset[i].item, subset[i].vel, qtys[i], opts.useBuyOrderForLeg2);
      if (fd > curMaxFill) curMaxFill = fd;
    }

    let bestIdx = -1;
    let bestMarg = -Infinity;

    for (let i = 0; i < k; i++) {
      const c = subset[i];
      if (qtys[i] >= maxQtys[i]) continue;
      if (c.m.steamUsd > rem + 0.001) continue;

      const nextQ = qtys[i] + 1;
      const curSlip = opts.useBuyOrderForLeg2 ? 0 : calcSlipPct(qtys[i], c.qty, 1.5);
      const nextSlip = opts.useBuyOrderForLeg2 ? 0 : calcSlipPct(nextQ, c.qty, 1.5);
      const margSlipRate = ((nextQ * nextSlip - qtys[i] * curSlip) / 100);

      // Blended marginal return per Steam dollar (72% Ask net - slippage, 28% Instant Buy-Order Floor)
      const baseM2 = c.m.m2 * (1 - margSlipRate);
      const blendedM2 = baseM2 * 0.72 + unitInstM2[i] * 0.28;

      // Queue-bottleneck penalty: discourages overloading one skin beyond the parallel exit time
      const nextFill = estimateLeg2FillDays(c.item, c.vel, nextQ, opts.useBuyOrderForLeg2);
      const bottleneckPen = nextFill > curMaxFill ? (nextFill - curMaxFill) * 0.022 : nextFill < curMaxFill ? -0.008 : 0;

      // Concentration guard: prevents 95%/5% lopsided splits when user wants real diversification
      const nextShare = (nextQ * c.m.steamUsd) / Math.max(1, steamWalletUsd);
      const concPen = nextShare > maxShareSoft ? (nextShare - maxShareSoft) * 0.085 : 0;

      // Velocity & turnover quality tie-breaker
      const speedEdge = (c.vel.tier === 'A' ? 0.006 : 0) + (c.vel.turnover30Pct >= 22 ? 0.004 : c.vel.turnover30Pct < 14 ? -0.008 : 0);

      const margUtility = blendedM2 - bottleneckPen - concPen + speedEdge;
      if (margUtility > bestMarg) {
        bestMarg = margUtility;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) break;
    qtys[bestIdx] += 1;
    rem -= subset[bestIdx].m.steamUsd;
  }

  const lines = subset.map((c, i) => buildLeg2Line(c, qtys[i], opts));
  lines.sort((a, b) => b.steamCostUsd - a.steamCostUsd);
  return { lines, leftoverSteamUsd: Math.max(0, rem) };
}

function evaluateFullBasket(leg1Lines, leg2Alloc, capitalUsd, opts, k1Requested, k2Requested) {
  const leg2Lines = leg2Alloc.lines;
  const totalSpentUsd = leg1Lines.reduce((a, l) => a + l.spentUsd, 0);
  const idleCashUsd = Math.max(0, capitalUsd - totalSpentUsd);
  const totalNetSteamUsd = leg1Lines.reduce((a, l) => a + l.netSteamUsd, 0);
  const totalSteamUsedUsd = leg2Lines.reduce((a, l) => a + l.steamCostUsd, 0);
  const leftoverSteamUsd = Math.max(0, totalNetSteamUsd - totalSteamUsedUsd);

  const totalCashReturnUsd = leg2Lines.reduce((a, l) => a + l.cashReturnUsd, 0);
  const totalInstantCashUsd = leg2Lines.reduce((a, l) => a + l.instantCashUsd, 0);
  const weightedM2 = totalSteamUsedUsd > 0 ? totalCashReturnUsd / totalSteamUsedUsd : 0.85;
  const weightedInstantM2 = totalSteamUsedUsd > 0 ? totalInstantCashUsd / totalSteamUsedUsd : weightedM2;

  const endCashEquivUsd = idleCashUsd + totalCashReturnUsd + leftoverSteamUsd * weightedM2;
  const netProfitUsd = Math.round((endCashEquivUsd - capitalUsd) * 100) / 100;
  const netRoiPct = capitalUsd > 0 ? (netProfitUsd / capitalUsd) * 100 : 0;

  const totalSlipUsd =
    leg1Lines.reduce((a, l) => a + l.slippageUsd, 0) + leg2Lines.reduce((a, l) => a + l.slippageUsd, 0);
  const totalSlippagePct = capitalUsd > 0 ? Math.round((totalSlipUsd / capitalUsd) * 10000) / 100 : 0;
  const slippageAdjProfitUsd = Math.round((netProfitUsd - totalSlipUsd) * 100) / 100;
  const slippageAdjRoiPct = capitalUsd > 0 ? (slippageAdjProfitUsd / capitalUsd) * 100 : 0;

  const instantEndUsd = idleCashUsd + totalInstantCashUsd + leftoverSteamUsd * weightedInstantM2;
  const instantFloorProfitUsd = Math.round((instantEndUsd - capitalUsd) * 100) / 100;
  const instantFloorRoiPct = capitalUsd > 0 ? (instantFloorProfitUsd / capitalUsd) * 100 : 0;

  // PARALLEL QUEUE TIMELINE: items in the same leg sell simultaneously on separate order books!
  const extraLeg1Days = Math.max(...leg1Lines.map((l) => l.fillDays), 0);
  const extraLeg2Days = Math.max(...leg2Lines.map((l) => l.fillDays), 0);
  const totalExtra = extraLeg1Days + extraLeg2Days;
  const minDays = 14 + Math.floor(totalExtra * 0.5);
  const maxDays = 14 + Math.max(totalExtra, 1);
  const avgDays = (minDays + maxDays) / 2;

  const totalQ1 = leg1Lines.reduce((a, l) => a + l.qty, 0);
  const totalQ2 = leg2Lines.reduce((a, l) => a + l.qty, 0);
  const deployedCashPct = capitalUsd > 0 ? Math.min(100, (totalSpentUsd / capitalUsd) * 100) : 0;
  const steamUsedPct = totalNetSteamUsd > 0 ? Math.min(100, (totalSteamUsedUsd / totalNetSteamUsd) * 100) : 0;

  const risk = computePortfolioRisk(
    leg1Lines.map((l) => ({ weight: l.spentUsd, sigma: l.sigma7d })),
    leg2Lines.map((l) => ({ weight: l.steamCostUsd, sigma: l.sigma7d })),
    slippageAdjRoiPct,
    capitalUsd
  );

  // Institutional Risk-, Slippage-, Floor- & Time-Adjusted Utility Score
  const roiPer14d = slippageAdjRoiPct * (14 / Math.max(14, avgDays));
  const floorPer14d = instantFloorRoiPct * (14 / Math.max(14, avgDays));
  const blended14d = roiPer14d * 0.72 + Math.max(0, floorPer14d) * 0.28;

  const tierAShareL2 =
    leg2Lines.reduce((acc, l) => acc + (l.vel.tier === 'A' ? l.steamCostUsd : 0), 0) / Math.max(1, totalSteamUsedUsd);
  const avgTurnoverL2 =
    leg2Lines.reduce((acc, l) => acc + l.vel.turnover30Pct * l.steamCostUsd, 0) / Math.max(1, totalSteamUsedUsd);
  const l2QualityBonus = tierAShareL2 * 2.2 + (avgTurnoverL2 >= 22 ? 1.0 : avgTurnoverL2 < 14 && totalQ2 >= 12 ? -1.8 : 0);

  const riskBonus = -risk.sigma14dPct * 0.65 + (risk.popPct >= 95 ? 2.0 : 0);
  // Modest complexity hurdle so Auto only splits when splitting genuinely improves speed/risk/profit!
  const complexityCost = (leg1Lines.length - 1) * 0.9 + (leg2Lines.length - 1) * 0.75;
  const clickPen = totalQ2 > 16 ? (totalQ2 - 16) * 0.06 : 0;

  const basketScore =
    Math.round(
      (blended14d * 1.55 + steamUsedPct * 0.06 + deployedCashPct * 0.04 + l2QualityBonus + riskBonus - complexityCost - clickPen) *
      10
    ) / 10;

  // Annotate allocation % on each line
  const l1Annotated = leg1Lines.map((l) => ({
    ...l,
    sharePct: Math.round((l.spentUsd / Math.max(1, totalSpentUsd)) * 1000) / 10
  }));
  const l2Annotated = leg2Lines.map((l) => ({
    ...l,
    sharePct: Math.round((l.steamCostUsd / Math.max(1, totalSteamUsedUsd)) * 1000) / 10
  }));

  return {
    k1: l1Annotated.length,
    k2: l2Annotated.length,
    k1Requested,
    k2Requested,
    leg1Lines: l1Annotated,
    leg2Lines: l2Annotated,
    totalQ1,
    totalQ2,
    totalSpentUsd: Math.round(totalSpentUsd * 100) / 100,
    idleCashUsd: Math.round(idleCashUsd * 100) / 100,
    deployedCashPct: Math.round(deployedCashPct * 10) / 10,
    totalNetSteamUsd: Math.round(totalNetSteamUsd * 100) / 100,
    totalSteamUsedUsd: Math.round(totalSteamUsedUsd * 100) / 100,
    leftoverSteamUsd: Math.round(leftoverSteamUsd * 100) / 100,
    steamUsedPct: Math.round(steamUsedPct * 10) / 10,
    totalCashReturnUsd: Math.round(totalCashReturnUsd * 100) / 100,
    endCashEquivUsd: Math.round(endCashEquivUsd * 100) / 100,
    netProfitUsd,
    netRoiPct: Math.round(netRoiPct * 100) / 100,
    totalSlippagePct,
    slippageAdjProfitUsd,
    slippageAdjRoiPct: Math.round(slippageAdjRoiPct * 100) / 100,
    instantFloorProfitUsd,
    instantFloorRoiPct: Math.round(instantFloorRoiPct * 100) / 100,
    extraLeg1Days,
    extraLeg2Days,
    minDays,
    maxDays,
    avgDays,
    roiPerDay: Math.round((netRoiPct / Math.max(14, avgDays)) * 100) / 100,
    risk,
    basketScore
  };
}

function solveLeg2ForCount(l2Cands, leg1Lines, capitalUsd, k2, opts, k1Req, k2Req) {
  const totalNetSteamUsd = leg1Lines.reduce((a, l) => a + l.netSteamUsd, 0);
  const leg1Names = new Set(leg1Lines.map((l) => l.item.n));
  const eligible = l2Cands.filter((c) => !leg1Names.has(c.item.n) && c.m.steamUsd <= totalNetSteamUsd);
  if (eligible.length < k2) return null;

  let bestPlan = null;
  const trySubset = (subset) => {
    const alloc = allocateSteamAcrossSubset(subset, totalNetSteamUsd, opts, capitalUsd);
    if (!alloc) return;
    const plan = evaluateFullBasket(leg1Lines, alloc, capitalUsd, opts, k1Req, k2Req);
    if (plan.netProfitUsd <= 0) return;
    if (!bestPlan || plan.basketScore > bestPlan.basketScore) {
      bestPlan = plan;
    }
  };

  if (k2 === 1) {
    for (const c of eligible.slice(0, 14)) trySubset([c]);
  } else if (k2 === 2) {
    const pool = eligible.slice(0, 11);
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) trySubset([pool[i], pool[j]]);
    }
  } else if (k2 === 3) {
    const pool = eligible.slice(0, 10);
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        for (let m = j + 1; m < pool.length; m++) trySubset([pool[i], pool[j], pool[m]]);
      }
    }
  } else {
    const pool = eligible.slice(0, 8);
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        for (let m = j + 1; m < pool.length; m++) {
          for (let n = m + 1; n < pool.length; n++) trySubset([pool[i], pool[j], pool[m], pool[n]]);
        }
      }
    }
  }

  return bestPlan;
}

/**
 * Main SPREAD Agent V6 Entry Point: Multi-Item Split / Basket Portfolio Optimizer
 *
 * @param {Array} items - Full 4,500-item live catalog
 * @param {Object} opts - Marketplace & fee settings
 * @param {number} capitalUsd - Starting budget in USD
 * @param {Object} filters - Advisor filters + { buyCount: 0|1|2|3, sellCount: 0|1|2|3|4 } (0 = Agent Auto)
 */
export function optimizeMultiItemBasket(items, opts, capitalUsd = 200, filters = {}) {
  const cap = Math.max(10, Number(capitalUsd) || 200);
  const tier = getCapitalTierInfo(cap);
  const isCSFloat = opts.marketplace !== 'YOUPIN';

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

  const buyCountReq = Math.max(0, Math.min(3, Number(filters.buyCount) || 0)); // 0 = Auto
  const sellCountReq = Math.max(0, Math.min(4, Number(filters.sellCount) || 0)); // 0 = Auto

  const leg1Pool = [];
  const leg2Pool = [];

  for (const item of items) {
    if (item.sEst) continue;
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

    // Leg 1 pool
    const passCat = style === 'CASES' ? item.c === 'Case' : true;
    const passAnom = minSpeed === 'MODERATE' ? true : !m.isAnomalySpread;
    if (passCat && passAnom && m.effBuy >= 0.35 && m.effBuy <= cap && m.leg1ProfitPct >= 2.0 && m.leg1ProfitPct <= 64) {
      const q1Est = Math.floor(cap / m.effBuy);
      const bookOk = !isCSFloat || q1Est <= Math.max(10, qty * 0.6);
      if (q1Est >= 1 && q1Est <= effectiveMaxQ1 && bookOk) {
        leg1Pool.push({ item, m, vel: computeVelocityProfile(item, opts.marketplace, 1), qty, q1Est });
      }
    }

    // Leg 2 pool (high liquidity, low cashout loss, strong order-book turnover & Bid/Ask on active market)
    // CRITICAL V10 GUARD: NEVER buy Doppler Gems or overpay phases (Ruby/Sapphire/Emerald/BP/Phase 2) on Steam for Leg 2!
    const isUnsafeDopplerL2 = Boolean(item.isGem || item.phPrem);
    const bidAskOk = vel.bidAskPct === 0 || vel.bidAskPct >= (isCSFloat ? 85 : 88);
    const l2TierOk = minSpeed === 'MODERATE' ? allowedTiers.has(vel.tier) : vel.tier === 'A' || vel.tier === 'B';
    const l2NoKnife = !vel.isKnifeOrGlove || (cap >= 1500 && vel.sold7d >= 8 && qty >= 60);
    const l2MinPrice = Math.max(tier.minL2Price * 0.7, cap / 60, 4);
    const maxL2Loss = cap >= 1500 || minSpeed === 'MODERATE' ? 21 : 15.5;
    const l2NotAnom = m.leg2LossPct >= 3.0 || (vel.tier === 'A' && vel.mktVol >= 150 && m.leg2LossPct >= 0.5);

    if (
      !isUnsafeDopplerL2 &&
      l2TierOk &&
      l2NoKnife &&
      bidAskOk &&
      l2NotAnom &&
      (vel.mktVol >= 20 || vel.weeklyUsd >= 500) &&
      m.steamUsd >= Math.min(l2MinPrice, cap * 0.35) &&
      m.steamUsd <= Math.max(tier.maxL2Price, cap * 1.1, 1400) &&
      m.leg2LossPct >= 0 &&
      m.leg2LossPct <= maxL2Loss
    ) {
      leg2Pool.push({ item, m, vel: computeVelocityProfile(item, opts.marketplace, 2), qty });
    }
  }

  if (leg1Pool.length === 0 || leg2Pool.length === 0) return null;

  // Curated diverse elite pools (include mid-price Knapsack complements + top-profit anchors)
  const l1ByAlpha = [...leg1Pool]
    .sort((a, b) => {
      const sa = a.m.leg1ProfitPct + (a.m.isBelowBuff ? 4 : 0) + (a.vel.tier === 'A' ? 3 : 0);
      const sb = b.m.leg1ProfitPct + (b.m.isBelowBuff ? 4 : 0) + (b.vel.tier === 'A' ? 3 : 0);
      return sb - sa;
    })
    .slice(0, 10);
  const l1MidFillers = [...leg1Pool]
    .filter((x) => x.m.effBuy <= cap * 0.42 && x.m.effBuy >= Math.max(3, cap * 0.04))
    .sort((a, b) => b.m.leg1ProfitPct + (b.vel.tier === 'A' ? 4 : 0) - (a.m.leg1ProfitPct + (a.vel.tier === 'A' ? 4 : 0)))
    .slice(0, 8);
  // Guarantee Single-Mode Champion's Leg 1 item is ALWAYS evaluated inside Basket Mode too!
  const anchorMatch = filters.anchorLeg1Name
    ? leg1Pool.find((x) => x.item.n.toLowerCase() === String(filters.anchorLeg1Name).toLowerCase())
    : null;
  const l1Cands = Array.from(
    new Map([...(anchorMatch ? [anchorMatch] : []), ...l1ByAlpha, ...l1MidFillers].map((x) => [x.item.n, x])).values()
  );

  const l2ByScore = [...leg2Pool]
    .sort((a, b) => {
      const sa = -a.m.leg2LossPct + (a.vel.tier === 'A' ? 2.6 : 0) + Math.min(2, a.vel.turnover30Pct / 20);
      const sb = -b.m.leg2LossPct + (b.vel.tier === 'A' ? 2.6 : 0) + Math.min(2, b.vel.turnover30Pct / 20);
      return sb - sa;
    })
    .slice(0, 12);
  const l2LowClick = [...leg2Pool]
    .filter((x) => x.m.steamUsd >= Math.max(45, cap * 0.14))
    .sort((a, b) => a.m.leg2LossPct - b.m.leg2LossPct)
    .slice(0, 4);
  const l2Cands = Array.from(new Map([...l2ByScore, ...l2LowClick].map((x) => [x.item.n, x])).values());

  // Solve TOP-3 Leg 1 baskets for k1 = 1, 2, 3 (eliminates single-pick blind spots!)
  const l1ByK = {
    1: solveLeg1TopForCount(l1Cands, cap, 1, opts, effectiveMaxQ1, 3),
    2: cap >= 80 ? solveLeg1TopForCount(l1Cands, cap, 2, opts, effectiveMaxQ1, 3) : [],
    3: cap >= 220 ? solveLeg1TopForCount(l1Cands, cap, 3, opts, effectiveMaxQ1, 2) : []
  };

  // Determine candidate grid for (k1, k2)
  const k1List = buyCountReq > 0 ? [buyCountReq] : cap < 120 ? [1] : cap < 350 ? [1, 2] : [1, 2, 3];
  const k2List = sellCountReq > 0 ? [sellCountReq] : cap < 90 ? [1] : cap < 280 ? [1, 2] : [1, 2, 3, 4];

  // Always compute best 1->1 single-pair baseline across top Leg 1 candidates for honest side-by-side proof
  let baseline11 = null;
  for (const l1Opt of l1ByK[1]) {
    const b11 = solveLeg2ForCount(l2Cands, l1Opt, cap, 1, opts, 1, 1);
    if (b11 && (!baseline11 || b11.basketScore > baseline11.basketScore)) baseline11 = b11;
  }

  // Evaluate requested grid across top Leg 1 candidates per k1
  const requestedCandidates = [];
  for (const k1 of k1List) {
    const l1Options = l1ByK[k1]?.length > 0 ? l1ByK[k1] : l1ByK[Math.max(1, k1 - 1)]?.length > 0 ? l1ByK[Math.max(1, k1 - 1)] : l1ByK[1];
    if (!l1Options || l1Options.length === 0) continue;
    for (const k2 of k2List) {
      let bestForCell = null;
      for (const l1Lines of l1Options) {
        const plan = solveLeg2ForCount(l2Cands, l1Lines, cap, k2, opts, buyCountReq, sellCountReq);
        if (plan && (!bestForCell || plan.basketScore > bestForCell.basketScore)) {
          bestForCell = plan;
        }
      }
      if (bestForCell) requestedCandidates.push(bestForCell);
    }
  }

  // Graceful fallback if strict manual count couldn't be formed on small budget
  if (requestedCandidates.length === 0 && baseline11) {
    requestedCandidates.push(baseline11);
  }
  if (requestedCandidates.length === 0) return null;

  requestedCandidates.sort((a, b) => b.basketScore - a.basketScore);
  const selected = requestedCandidates[0];

  // Also compute Agent's unconstrained AUTO optimum (for the same buyCount if user fixed buyCount, or full global)
  let agentBetterAlt = null;
  if (buyCountReq > 0 || sellCountReq > 0) {
    const autoK1s = buyCountReq > 0 ? [buyCountReq] : cap < 120 ? [1] : [1, 2];
    const autoK2s = cap < 90 ? [1] : cap < 280 ? [1, 2] : [1, 2, 3];
    let bestAuto = null;
    for (const k1 of autoK1s) {
      const l1Options = l1ByK[k1] || [];
      for (const l1Lines of l1Options) {
        for (const k2 of autoK2s) {
          if (k1 === selected.k1 && k2 === selected.k2) continue;
          const alt = solveLeg2ForCount(l2Cands, l1Lines, cap, k2, opts, 0, 0);
          if (alt && (!bestAuto || alt.basketScore > bestAuto.basketScore)) {
            bestAuto = alt;
          }
        }
      }
    }
    if (bestAuto && bestAuto.basketScore > selected.basketScore + 0.65) {
      const profitDiff = Math.round((bestAuto.netProfitUsd - selected.netProfitUsd) * 100) / 100;
      const daysDiff = selected.maxDays - bestAuto.maxDays;
      let reason = '';
      if (profitDiff >= 1.5 && daysDiff >= 0) {
        reason = bi(
          `Agent Tip: Using ${bestAuto.k2} exit item(s) instead of ${selected.k2} earns +$${profitDiff.toFixed(2)} more with ${daysDiff > 0 ? `${daysDiff}d faster exit` : 'same speed'}.`,
          `Agent Önerisi: ${selected.k2} yerine ${bestAuto.k2} farklı çıkış seçmek +$${profitDiff.toFixed(2)} daha kârlı${daysDiff > 0 ? ` ve ${daysDiff}G daha hızlı` : ' ve aynı hızda'}.`
        );
      } else if (daysDiff >= 1) {
        reason = bi(
          `Agent Tip: Switching to ${bestAuto.k1} Buy → ${bestAuto.k2} Sell cuts sell wait by ${daysDiff}d and improves cashflow speed.`,
          `Agent Önerisi: ${bestAuto.k1} Al → ${bestAuto.k2} Sat dağılımına geçmek çıkış süresini ${daysDiff} gün kısaltır.`
        );
      } else if (bestAuto.k2 < selected.k2 && profitDiff >= -1.0) {
        reason = bi(
          `Agent Tip: ${bestAuto.k2} exit skins beat ${selected.k2} here — cleaner execution with ${profitDiff >= 0 ? `+$${profitDiff.toFixed(2)} higher profit` : 'virtually identical return'}.`,
          `Agent Önerisi: Bu bütçede ${selected.k2} yerine ${bestAuto.k2} farklı çıkış daha temiz${profitDiff >= 0 ? ` ve +$${profitDiff.toFixed(2)} daha kârlı` : ' ve aynı kârda'}.`
        );
      } else {
        reason = bi(
          `Agent Tip: ${bestAuto.k1} Buy → ${bestAuto.k2} Sell gives a stronger risk-adjusted return (+$${bestAuto.netProfitUsd.toFixed(2)}).`,
          `Agent Önerisi: ${bestAuto.k1} Al → ${bestAuto.k2} Sat dağılımı risk-ayarlı olarak daha verimli (+$${bestAuto.netProfitUsd.toFixed(2)}).`
        );
      }
      agentBetterAlt = {
        k1: bestAuto.k1,
        k2: bestAuto.k2,
        netProfitUsd: bestAuto.netProfitUsd,
        profitDiff,
        daysDiff,
        reason
      };
    }
  }

  // Head-to-head proof vs 1->1 single-pair baseline (separates Leg 2 exit time from Leg 1!)
  let vsSingle = null;
  if (baseline11 && (selected.k1 > 1 || selected.k2 > 1)) {
    const profitDelta = Math.round((selected.netProfitUsd - baseline11.netProfitUsd) * 100) / 100;
    const daysSaved = Math.max(0, baseline11.maxDays - selected.maxDays);
    const exitDaysSaved = Math.max(0, baseline11.extraLeg2Days - selected.extraLeg2Days);
    const slipSavedPct =
      baseline11.totalSlippagePct > 0
        ? Math.max(0, Math.round((1 - selected.totalSlippagePct / baseline11.totalSlippagePct) * 100))
        : 0;
    const riskReductionPct =
      baseline11.risk.sigma14dPct > 0
        ? Math.max(0, Math.round((1 - selected.risk.sigma14dPct / baseline11.risk.sigma14dPct) * 100))
        : 0;
    vsSingle = {
      singleQ2: baseline11.totalQ2,
      singleProfitUsd: baseline11.netProfitUsd,
      profitDelta,
      daysSaved,
      exitDaysSaved,
      slipSavedPct,
      riskReductionPct
    };
  }

  // Plain-language executive rationale explaining WHY Agent chose this exact split (zero inflated claims!)
  let rationale = '';
  if (selected.k1 === 1 && selected.k2 === 1) {
    rationale = bi(
      `At this budget, a clean 1 → 1 pair maximizes net profit without over-splitting capital.`,
      `Bu bütçede sermayeyi gereksiz bölmeden temiz 1 → 1 çift en yüksek net getiriyi veriyor.`
    );
  } else if (vsSingle) {
    const parts = [];
    if (vsSingle.profitDelta >= 5) {
      parts.push(
        bi(
          `deploys idle cash for +$${vsSingle.profitDelta.toFixed(2)} extra profit`,
          `boşta kalan nakdi değerlendirip +$${vsSingle.profitDelta.toFixed(2)} ek kâr üretir`
        )
      );
    }
    if (vsSingle.exitDaysSaved >= 1) {
      parts.push(
        bi(
          `parallel selling cuts cashout wait by ${vsSingle.exitDaysSaved}d`,
          `paralel satışla çıkış süresini ${vsSingle.exitDaysSaved} gün kısaltır`
        )
      );
    } else if (vsSingle.daysSaved >= 1) {
      parts.push(
        bi(
          `shortens full cycle by ${vsSingle.daysSaved}d`,
          `toplam döngüyü ${vsSingle.daysSaved} gün kısaltır`
        )
      );
    }
    if (vsSingle.slipSavedPct >= 10) {
      parts.push(
        bi(`reduces slippage by ${vsSingle.slipSavedPct}%`, `emir defteri kaymasını %${vsSingle.slipSavedPct} azaltır`)
      );
    }
    if (vsSingle.riskReductionPct >= 8) {
      parts.push(
        bi(`lowers 7D hold volatility by ${vsSingle.riskReductionPct}%`, `7G fiyat riskini %${vsSingle.riskReductionPct} düşürür`)
      );
    }
    if (parts.length > 0) {
      rationale =
        selected.k2 > 1
          ? bi(
            `Splitting across ${selected.k2} parallel exits instead of ${vsSingle.singleQ2}x in 1 book: ${parts.join(' • ')}.`,
            `Tek eşyada ${vsSingle.singleQ2}x yerine ${selected.k2} paralel çıkışa bölmek: ${parts.join(' • ')}.`
          )
          : bi(
            `Multi-skin Step 1 basket (${selected.k1} buys → 1 clean exit): ${parts.join(' • ')}.`,
            `${selected.k1} farklı 1. adım alım sepeti: ${parts.join(' • ')}.`
          );
    } else {
      rationale = bi(
        `Diversified across ${selected.k1} buy & ${selected.k2} parallel cashout books with ${selected.risk.popPct}% profit probability.`,
        `${selected.k1} alım ve ${selected.k2} paralel çıkış pazarına bölündü (%${selected.risk.popPct} kâr ihtimali).`
      );
    }
  }

  return {
    plan: selected,
    baseline11,
    vsSingle,
    agentBetterAlt,
    rationale
  };
}

/**
 * SPREAD Agent V9 — Head-to-Head Single vs. Multi-Item Basket Meta-Arbitrator!
 *
 * Always evaluates BOTH Single Mode (1 -> 1) and Basket Mode (Multi-Item) side-by-side using
 * exact Profit, 500-Trial EV, CVaR 5% Crash Floor, Directional Liquidity Velocity, and
 * Order-Book Absorption (days of total market volume) so the Agent can honestly tell the trader:
 *   - 'PREFER_SINGLE': Single beats Basket by a significant margin AND both legs are genuinely fast/high-volume!
 *   - 'PREFER_BASKET': Basket beats Single via idle-cash deployment, order-book queue rescue, or crash protection!
 *   - 'BALANCED_TRADEOFF': Both are close; shows transparent side-by-side pros/cons with zero nagging!
 *   - 'SINGLE_ONLY': Budget or market naturally favors 1 -> 1 (no multi-item basket formed).
 */
export function evaluateModeArbitration(singlePair, basketRes, singleMc, basketMc, capitalUsd, opts = {}, formatMoneyFn = null) {
  const cap = Math.max(10, Number(capitalUsd) || 200);
  const fmtUsd =
    typeof formatMoneyFn === 'function'
      ? formatMoneyFn
      : (v, withSign = false) => `${withSign ? (v >= 0 ? '+' : '-') : v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`;

  if (!singlePair || !basketRes || !basketRes.plan) {
    return {
      verdict: 'SINGLE_ONLY',
      profitGapUsd: 0,
      profitGapPct: 0,
      singleBanner: null,
      basketBanner: null,
      togglePill: '',
      togglePillCls: ''
    };
  }

  const bp = basketRes.plan;
  if (bp.k1 <= 1 && bp.k2 <= 1) {
    return {
      verdict: 'SINGLE_ONLY',
      profitGapUsd: 0,
      profitGapPct: 0,
      singleBanner: null,
      basketBanner: null,
      togglePill: '',
      togglePillCls: ''
    };
  }

  const isCSFloat = opts.marketplace !== 'YOUPIN';
  const l1Item = singlePair.leg1.item;
  const l2Item = singlePair.leg2.item;
  const l1Vel = singlePair.leg1.vel;
  const l2Vel = singlePair.leg2.vel;
  const q1 = singlePair.c1.q1;
  const q2 = singlePair.c1.q2;

  // 1. Exact Leg 1 Steam Liquidity Clearance Audit
  const isL1SteamZeroTrap = Boolean(l1Item?.st24Checked && Number(l1Item.st24) === 0 && (l1Vel?.steamBidAskPct || 0) < 92);
  const l1Daily = l1Item?.st24Checked
    ? Math.max(0.15, Number(l1Item.st24) || 0)
    : Math.max(0.3, Number(l1Vel?.estDailySales) || 0.5);
  const l1DaysOfVol = Math.round((q1 / Math.max(0.15, l1Daily)) * 10) / 10;
  const l1Fast =
    !isL1SteamZeroTrap &&
    (l1Vel?.tier === 'A' || l1Vel?.tier === 'B') &&
    (q1 <= 2 || l1DaysOfVol <= 2.6 || (l1Daily >= 4 && l1DaysOfVol <= 3.0));

  // 2. Exact Leg 2 Cashout Market Absorption Audit (e.g. 24x-32x on a 100+/wk, 20+/day skin = ultra-liquid!)
  const l2Sold7d =
    isCSFloat && l2Item?.cfLive
      ? Number(l2Item.cf7) || 0
      : Math.max(Number(l2Vel?.sold7d) || 0, Math.round((Number(l2Vel?.estDailySales) || 0) * 7));
  const l2Daily =
    isCSFloat && l2Item?.cfLive
      ? Math.max(0.35, Number(l2Item.cf24) || 0, (Number(l2Item.cf7) || 0) / 7)
      : Math.max(0.35, Number(l2Vel?.estDailySales) || 0.5, l2Sold7d / 7);
  const l2DaysOfVol = Math.round((q2 / Math.max(0.35, l2Daily)) * 10) / 10;
  const l2SuperLiquid =
    (l2Vel?.tier === 'A' || (l2Vel?.tier === 'B' && l2Sold7d >= 55)) &&
    (q2 <= 10 || (l2Sold7d >= 65 && l2DaysOfVol <= 2.8) || (l2Daily >= 12 && l2DaysOfVol <= 2.8));
  const l2Congested = !l2SuperLiquid && (q2 >= 14 || l2DaysOfVol >= 3.2);

  // 3. Head-to-Head Quantitative Deltas (+ = Single leads, - = Basket leads)
  const singleProfitUsd = Math.round((singlePair.c1.netProfit || 0) * 100) / 100;
  const basketProfitUsd = Math.round((bp.netProfitUsd || 0) * 100) / 100;
  const profitGapUsd = Math.round((singleProfitUsd - basketProfitUsd) * 100) / 100;
  const profitGapPct = Math.round(((profitGapUsd / cap) * 100) * 10) / 10;

  const evSingle = singleMc?.evProfitUsd ?? singleProfitUsd;
  const evBasket = basketMc?.evProfitUsd ?? basketProfitUsd;
  const evGapUsd = Math.round((evSingle - evBasket) * 100) / 100;

  const cvarSingle = singleMc?.cvar5ProfitUsd ?? 0;
  const cvarBasket = basketMc?.cvar5ProfitUsd ?? 0;
  const cvarGapUsd = Math.round((cvarSingle - cvarBasket) * 100) / 100;

  const floorSingle = singlePair.instantFloorProfit ?? 0;
  const floorBasket = bp.instantFloorProfitUsd ?? 0;
  const floorGapUsd = Math.round((floorSingle - floorBasket) * 100) / 100;

  const singleMaxDays = singlePair.reality?.maxDays || 16;
  const basketMaxDays = bp.maxDays || 16;
  const daysSavedByBasket = singleMaxDays - basketMaxDays;

  const singleSigma = singleMc?.sigma14dPct || 8;
  const basketSigma = basketMc?.sigma14dPct || bp.risk?.sigma14dPct || 8;
  const volCutPct = singleSigma > 0 ? Math.max(0, Math.round((1 - basketSigma / singleSigma) * 100)) : 0;
  const idleCashSavedUsd = Math.round(((singlePair.c1.cashLeftAfterLeg1 || 0) - (bp.idleCashUsd || 0)) * 100) / 100;

  // 4. High-Signal Arbitrator Decision Logic (Strict thresholds -> Zero Spam, Maximum Trust!)
  const sigProfitThreshold = Math.max(12, cap * 0.018); // e.g. $12 on $200-$650, $16.20 on $900, $27 on $1500
  const sigEvThreshold = Math.max(8, cap * 0.012);
  const basketProfitWinThresh = Math.max(10, cap * 0.015);

  const l2PaceStr = bi(
    `${Math.round(l2Sold7d)}/wk (~${Math.round(l2Daily)}/day)`,
    `haftada ${Math.round(l2Sold7d)} (~${Math.round(l2Daily)}/gün)`
  );

  let verdict = 'BALANCED_TRADEOFF';
  let singleBanner = null;
  let basketBanner = null;
  let togglePill = '';
  let togglePillCls = 'is-balanced';

  const singleStrictlyDominates =
    profitGapUsd >= sigProfitThreshold &&
    evGapUsd >= sigEvThreshold &&
    l1Fast &&
    l2SuperLiquid &&
    daysSavedByBasket <= 3;

  const basketProfitWin = profitGapUsd <= -basketProfitWinThresh;
  const basketQueueRescue =
    (l2Congested || !l1Fast) &&
    daysSavedByBasket >= 2 &&
    profitGapUsd <= Math.max(18, cap * 0.025);
  const basketCrashShield =
    (cvarGapUsd <= -Math.max(15, cap * 0.02) || volCutPct >= 18) &&
    profitGapUsd <= Math.max(10, cap * 0.015);

  if (singleStrictlyDominates) {
    verdict = 'PREFER_SINGLE';
    togglePill = bi(
      `⚡ Agent: Single Mode (${fmtUsd(profitGapUsd, true)})`,
      `⚡ Agent: Tekli Mod (${fmtUsd(profitGapUsd, true)})`
    );
    togglePillCls = 'is-single';

    const l1Note =
      q1 <= 2
        ? bi(`${q1}x ${l1Item.n} sells fast on Steam`, `${q1}x ${l1Item.n} Steam'de hızlı satılıyor`)
        : bi(`${q1}x ${l1Item.n} clears in ~${l1DaysOfVol}d on Steam`, `${q1}x ${l1Item.n} Steam'de ~${l1DaysOfVol}G hacimde eriyor`);

    basketBanner = {
      tone: 'is-single-win',
      title: bi(
        `Agent Advice: Closing Basket Mode earns ${fmtUsd(profitGapUsd, true)} (+${profitGapPct.toFixed(1)}% ROI) more!`,
        `SPREAD Agent Tavsiyesi: Sepeti kapatıp Tekli Moda geçmek ${fmtUsd(profitGapUsd, true)} (+%${profitGapPct.toFixed(1)} ROI) daha kârlı!`
      ),
      detail: bi(
        `${l1Note}, and Step 2 (${q2}x ${l2Item.n}) moves ${l2PaceStr} (~${l2DaysOfVol}d volume) — no need to split and sacrifice profit.`,
        `${l1Note} ve 2. adımdaki ${q2}x ${l2Item.n} ${l2PaceStr} satılan (~${l2DaysOfVol}G hacim) çok popüler bir eşya; kârdan feragat edip sepet bölmeye gerek yok.`
      ),
      ctaLabel: bi(
        `Switch to Single Mode (${fmtUsd(singleProfitUsd, true)}) →`,
        `Tekli Moda Geç (${fmtUsd(singleProfitUsd, true)}) →`
      ),
      targetSplitMode: false
    };

    singleBanner = {
      tone: 'is-confirmed',
      title: bi(
        `Smart Mode Verified: Single Mode beats Basket by ${fmtUsd(profitGapUsd, true)} here — no split needed.`,
        `Akıllı Mod Onayı: Tekli Mod şu an Sepet Modu'ndan ${fmtUsd(profitGapUsd, true)} daha kârlı — sepete gerek yok.`
      ),
      detail: bi(
        `Exit skin (${q2}x ${l2Item.n}) sells ${l2PaceStr} (~${l2DaysOfVol}d volume), so 1 clean exit clears fast without diluting profit.`,
        `Çıkış eşyası (${q2}x ${l2Item.n}) ${l2PaceStr} satıldığı için (~${l2DaysOfVol}G hacim) kârı düşürmeden tek eşyada hızla nakde döner.`
      ),
      ctaLabel: bi(`Compare Basket (${fmtUsd(basketProfitUsd, true)})`, `Sepeti Gör (${fmtUsd(basketProfitUsd, true)})`),
      targetSplitMode: true
    };
  } else if (basketProfitWin || basketQueueRescue || basketCrashShield) {
    verdict = 'PREFER_BASKET';
    const extraUsd = Math.abs(profitGapUsd);
    togglePill = basketProfitWin
      ? bi(`⚡ Agent: Basket (${fmtUsd(extraUsd, true)})`, `⚡ Agent: Sepet (${fmtUsd(extraUsd, true)})`)
      : daysSavedByBasket >= 2
        ? bi(`⚡ Agent: Basket (-${daysSavedByBasket}d faster)`, `⚡ Agent: Sepet (-${daysSavedByBasket}G hızlı)`)
        : bi(`⚡ Agent: Basket (-${volCutPct}% risk)`, `⚡ Agent: Sepet (-%${volCutPct} risk)`);
    togglePillCls = 'is-basket';

    const whyParts = [];
    if (basketProfitWin) {
      whyParts.push(
        bi(
          `earns ${fmtUsd(extraUsd, true)} more${idleCashSavedUsd >= 20 ? ` by deploying ${fmtUsd(idleCashSavedUsd)} idle cash` : ''}`,
          `${idleCashSavedUsd >= 20 ? `boşta kalan ${fmtUsd(idleCashSavedUsd)} nakdi değerlendirip ` : ''}${fmtUsd(extraUsd, true)} daha fazla kâr üretir`
        )
      );
    }
    if (daysSavedByBasket >= 2) {
      whyParts.push(
        bi(
          `cuts sell wait by ${daysSavedByBasket}d via ${bp.k2} parallel books`,
          `${bp.k2} paralel çıkışla bekleme süresini ${daysSavedByBasket} gün kısaltır`
        )
      );
    }
    if (l2Congested) {
      whyParts.push(
        bi(
          `avoids dumping ${q2}x into one skin (${l2DaysOfVol}d of volume)`,
          `tek skine ${q2}x yığmayı (${l2DaysOfVol}G piyasa hacmi) önler`
        )
      );
    }
    if (volCutPct >= 15) {
      whyParts.push(bi(`lowers 7D hold risk by ${volCutPct}%`, `7G fiyat riskini %${volCutPct} azaltır`));
    }
    if (cvarGapUsd <= -15) {
      whyParts.push(
        bi(`lifts worst-5% CVaR floor by ${fmtUsd(Math.abs(cvarGapUsd), true)}`, `en kötü %5 CVaR tabanını ${fmtUsd(Math.abs(cvarGapUsd), true)} güçlendirir`)
      );
    }

    singleBanner = {
      tone: 'is-basket-win',
      title: bi(
        `Agent Advice: Multi-Item Basket (${bp.k1} → ${bp.k2}) is stronger at this budget!`,
        `SPREAD Agent Tavsiyesi: Bu bütçede Sepet Modu (${bp.k1} Al → ${bp.k2} Sat) daha mantıklı!`
      ),
      detail: bi(
        `Basket Mode (${fmtUsd(basketProfitUsd, true)}): ${whyParts.join(' • ')}.`,
        `Sepet Modu (${fmtUsd(basketProfitUsd, true)}): ${whyParts.join(' • ')}.`
      ),
      ctaLabel: bi(
        `Open Basket Mode (${fmtUsd(basketProfitUsd, true)}) →`,
        `Sepet Modunu Aç (${fmtUsd(basketProfitUsd, true)}) →`
      ),
      targetSplitMode: true
    };

    basketBanner = {
      tone: 'is-confirmed',
      title: bi(
        `Smart Mode Verified: Basket Mode (${bp.k1} → ${bp.k2}) outperforms Single Mode here.`,
        `Akıllı Mod Onayı: Sepet Modu (${bp.k1} Al → ${bp.k2} Sat) şu an Tekli Moddan daha avantajlı.`
      ),
      detail: bi(
        `vs Single Mode (${fmtUsd(singleProfitUsd, true)}): ${whyParts.join(' • ')}.`,
        `Tekli Moda göre (${fmtUsd(singleProfitUsd, true)}): ${whyParts.join(' • ')}.`
      ),
      ctaLabel: bi(`Compare Single (${fmtUsd(singleProfitUsd, true)})`, `Tekliyi Gör (${fmtUsd(singleProfitUsd, true)})`),
      targetSplitMode: false
    };
  } else {
    verdict = 'BALANCED_TRADEOFF';
    togglePill = bi('⚖ Single ≈ Basket', '⚖ Tekli ≈ Sepet');
    togglePillCls = 'is-balanced';

    const singleDetail =
      profitGapUsd > 0
        ? bi(
          `Basket (${bp.k1} → ${bp.k2}) returns ${fmtUsd(basketProfitUsd, true)} (${fmtUsd(-profitGapUsd, true)} vs Single)${volCutPct >= 8 ? ` with ${volCutPct}% lower 7D risk` : ''}${daysSavedByBasket >= 1 ? ` & ${daysSavedByBasket}d faster exit` : ''}.`,
          `Sepet (${bp.k1} Al → ${bp.k2} Sat) ${fmtUsd(basketProfitUsd, true)} verir (${fmtUsd(-profitGapUsd, true)} fark)${volCutPct >= 8 ? ` • 7G riski %${volCutPct} daha düşük` : ''}${daysSavedByBasket >= 1 ? ` • ${daysSavedByBasket}G daha hızlı` : ''}.`
        )
        : bi(
          `Basket (${bp.k1} → ${bp.k2}) returns ${fmtUsd(basketProfitUsd, true)} (${fmtUsd(Math.abs(profitGapUsd), true)} extra) with parallel diversification.`,
          `Sepet (${bp.k1} Al → ${bp.k2} Sat) paralel bölünmeyle ${fmtUsd(basketProfitUsd, true)} (${fmtUsd(Math.abs(profitGapUsd), true)} ek kâr) sunuyor.`
        );

    const basketDetail =
      profitGapUsd > 0
        ? bi(
          `Single Mode (${q1}x → ${q2}x) returns ${fmtUsd(singleProfitUsd, true)} (${fmtUsd(profitGapUsd, true)} higher), while Basket reduces concentration & slippage.`,
          `Tekli Mod (${q1}x → ${q2}x) ${fmtUsd(singleProfitUsd, true)} (${fmtUsd(profitGapUsd, true)} daha yüksek) sunar; Sepet Modu ise riski ve kaymayı böler.`
        )
        : bi(
          `Single Mode returns ${fmtUsd(singleProfitUsd, true)} in 1 clean pair; Basket spreads risk across ${bp.k1 + bp.k2} skins.`,
          `Tekli Mod tek çiftte ${fmtUsd(singleProfitUsd, true)} sunar; Sepet Modu riski ${bp.k1 + bp.k2} farklı skine yayar.`
        );

    singleBanner = {
      tone: 'is-tradeoff',
      title: bi('Head-to-Head Mode Check (Balanced)', 'Tekli vs. Sepet Kıyaslaması (Dengeli)'),
      detail: singleDetail,
      ctaLabel: bi(`Inspect Basket (${fmtUsd(basketProfitUsd, true)}) →`, `Sepette Gör (${fmtUsd(basketProfitUsd, true)}) →`),
      targetSplitMode: true
    };
    basketBanner = {
      tone: 'is-tradeoff',
      title: bi('Head-to-Head Mode Check (Balanced)', 'Tekli vs. Sepet Kıyaslaması (Dengeli)'),
      detail: basketDetail,
      ctaLabel: bi(`Inspect Single (${fmtUsd(singleProfitUsd, true)}) →`, `Teklide Gör (${fmtUsd(singleProfitUsd, true)}) →`),
      targetSplitMode: false
    };
  }

  return {
    verdict,
    profitGapUsd,
    profitGapPct,
    evGapUsd,
    cvarGapUsd,
    floorGapUsd,
    daysSavedByBasket,
    volCutPct,
    idleCashSavedUsd,
    l1Fast,
    l2SuperLiquid,
    l2Congested,
    l1Daily: Math.round(l1Daily * 10) / 10,
    l2Daily: Math.round(l2Daily * 10) / 10,
    l2Sold7d: Math.round(l2Sold7d),
    l1DaysOfVol,
    l2DaysOfVol,
    singleProfitUsd,
    basketProfitUsd,
    singleBanner,
    basketBanner,
    togglePill,
    togglePillCls
  };
}

/**
 * V6.1 Full Native Multi-Item Basket Trade Desk Calculator:
 * Produces the exact same metrics shape as computeLoopMetrics() for Hero Strip,
 * 14-Day Timeline, Leg 1/2 Breakdowns, 12-Cycle Compounding Chart/Table, and Heatmap!
 */
export function computeBasketLoopMetrics(params) {
  const {
    capitalUsd = 200,
    leg1Lines = [],
    leg2Lines = [],
    buyFeePct = 0,
    sellFeePct = 2.0,
    withdrawFeePct = 0,
    steamFeeMode = 'EXACT_VALVE',
    steamCustomFeePct = 13.04
  } = params;

  const cap0 = Math.max(0, Number(capitalUsd) || 0);

  const l1Eval = leg1Lines.map((line) => {
    const qty = Math.max(0, Math.floor(Number(line.qty) || 0));
    const marketUsd = Math.max(0, Number(line.marketUsd) || 0);
    const steamUsd = Math.max(0, Number(line.steamUsd) || 0);
    const effBuy = calcEffectiveBuyUsd(marketUsd, buyFeePct);
    const netSteam = calcNetSteamUsd(steamUsd, steamFeeMode, steamCustomFeePct);
    const exactFee = calcExactValveSteamFee(steamUsd);
    const spentUsd = qty * effBuy;
    const grossSteamUsd = qty * steamUsd;
    const steamEarnedUsd = qty * netSteam;
    const m1Line = effBuy > 0 ? netSteam / effBuy : 0;
    return {
      ...line,
      qty,
      marketUsd,
      steamUsd,
      effBuy,
      netSteam,
      exactFee,
      spentUsd,
      grossSteamUsd,
      steamEarnedUsd,
      m1: m1Line,
      profitPct: m1Line > 0 ? (m1Line - 1) * 100 : -100
    };
  });

  const l2Eval = leg2Lines.map((line) => {
    const qty = Math.max(0, Math.floor(Number(line.qty) || 0));
    const steamUsd = Math.max(0, Number(line.steamUsd) || 0);
    const marketUsd = Math.max(0, Number(line.marketUsd) || 0);
    const netSell = calcNetSellUsd(marketUsd, sellFeePct, withdrawFeePct);
    const steamSpentUsd = qty * steamUsd;
    const cashReturnUsd = qty * netSell;
    const m2Line = steamUsd > 0 ? netSell / steamUsd : 0;
    return {
      ...line,
      qty,
      steamUsd,
      marketUsd,
      netSell,
      steamSpentUsd,
      cashReturnUsd,
      m2: m2Line,
      lossPct: m2Line > 0 ? (1 - m2Line) * 100 : 100
    };
  });

  const totalQ1 = l1Eval.reduce((a, l) => a + l.qty, 0);
  const totalSpent1 = l1Eval.reduce((a, l) => a + l.spentUsd, 0);
  const totalGrossSteam1 = l1Eval.reduce((a, l) => a + l.grossSteamUsd, 0);
  const totalSteamEarned1 = l1Eval.reduce((a, l) => a + l.steamEarnedUsd, 0);
  const totalSteamFeeUsd = Math.max(0, totalGrossSteam1 - totalSteamEarned1);
  const weightedSteamFeePct = totalGrossSteam1 > 0 ? (totalSteamFeeUsd / totalGrossSteam1) * 100 : 13.04;
  const anyMinFeeTrap = l1Eval.some((l) => l.qty > 0 && l.exactFee.isMinFeeTrap);

  const totalQ2 = l2Eval.reduce((a, l) => a + l.qty, 0);
  const totalSteamSpent2 = l2Eval.reduce((a, l) => a + l.steamSpentUsd, 0);
  const totalCashReturn2 = l2Eval.reduce((a, l) => a + l.cashReturnUsd, 0);

  const m1 = totalSpent1 > 0 ? totalSteamEarned1 / totalSpent1 : 0;
  const leg1ProfitPct = m1 > 0 ? (m1 - 1) * 100 : 0;
  const m2 = totalSteamSpent2 > 0 ? totalCashReturn2 / totalSteamSpent2 : 0;
  const conversionLossPct = m2 > 0 ? (1 - m2) * 100 : 100;

  const mCycle = m1 * m2;
  const netCycleRoiPct = (mCycle - 1) * 100;
  const breakEvenLossLimitPct = m1 > 0 ? (1 - 1 / m1) * 100 : 0;
  const marginOfSafetyPct = breakEvenLossLimitPct - conversionLossPct;

  // Weighted representative unit prices for sensitivity heatmap compatibility
  const pM1Usd = totalQ1 > 0 ? totalSpent1 / totalQ1 / (1 + buyFeePct / 100) : 0;
  const pS1Usd = totalQ1 > 0 ? totalGrossSteam1 / totalQ1 : 0;
  const pS2Usd = totalQ2 > 0 ? totalSteamSpent2 / totalQ2 : 0;
  const sellFactor = (1 - sellFeePct / 100) * (1 - withdrawFeePct / 100);
  const pM2Usd = totalQ2 > 0 && sellFactor > 0 ? totalCashReturn2 / totalQ2 / sellFactor : 0;

  const overBudgetUsd = Math.max(0, totalSpent1 - cap0);
  const overSteamUsd = Math.max(0, totalSteamSpent2 - totalSteamEarned1);

  // Cycle 1 exact + Cycles 2..12 realistic proportional integer basket compounding
  const realisticCycles = [];
  let cashWallet = cap0;
  let steamWallet = 0;

  for (let k = 1; k <= 12; k++) {
    let q1Cycle = 0;
    let spentM1 = 0;
    let steamEarned = 0;
    let q2Cycle = 0;
    let spentS2 = 0;
    let cashReturnM2 = 0;

    if (k === 1) {
      q1Cycle = totalQ1;
      spentM1 = totalSpent1;
      steamEarned = totalSteamEarned1;
      cashWallet -= spentM1;
      const cashLeftAfterLeg1 = cashWallet;
      steamWallet += steamEarned;
      const steamAfterLeg1 = steamWallet;

      q2Cycle = totalQ2;
      spentS2 = totalSteamSpent2;
      cashReturnM2 = totalCashReturn2;
      steamWallet -= spentS2;
      cashWallet += cashReturnM2;

      const steamCashEquiv = steamWallet * (m2 > 0 ? m2 : 0);
      const cashEquivPortfolio = cashWallet + steamCashEquiv;
      const netProfit = cashEquivPortfolio - cap0;
      const netRoiPct = cap0 > 0 ? (netProfit / cap0) * 100 : 0;
      const theoMult = Math.pow(Math.max(0, mCycle), k);
      const theoPortfolio = cap0 * theoMult;

      realisticCycles.push({
        cycle: k,
        days: 14,
        weeks: 2,
        q1: q1Cycle,
        spentM1,
        cashLeftAfterLeg1,
        steamAfterLeg1,
        q2: q2Cycle,
        spentS2,
        cashReturnM2,
        cashWallet,
        steamWallet,
        steamCashEquiv,
        cashEquivPortfolio,
        nominalPortfolio: cashWallet + steamWallet,
        netProfit,
        netRoiPct,
        theoMult,
        theoPortfolio,
        theoProfit: theoPortfolio - cap0,
        theoRoiPct: cap0 > 0 ? ((theoPortfolio - cap0) / cap0) * 100 : 0
      });
    } else {
      const availCash = Math.max(0, cashWallet);
      const l1Weights = l1Eval.map((l) => (totalSpent1 > 0 ? l.spentUsd / totalSpent1 : 1 / Math.max(1, l1Eval.length)));
      let remC = availCash;
      for (let i = 0; i < l1Eval.length; i++) {
        const l = l1Eval[i];
        if (l.effBuy <= 0) continue;
        const target = Math.min(remC, availCash * l1Weights[i]);
        const q = Math.floor(target / l.effBuy);
        q1Cycle += q;
        spentM1 += q * l.effBuy;
        steamEarned += q * l.netSteam;
        remC -= q * l.effBuy;
      }
      // Greedy pack leftover cash into cheapest affordable Leg 1 item
      const l1Cheap = [...l1Eval].filter((l) => l.effBuy > 0).sort((a, b) => a.effBuy - b.effBuy);
      for (const l of l1Cheap) {
        const extra = Math.floor(remC / l.effBuy);
        if (extra > 0) {
          q1Cycle += extra;
          spentM1 += extra * l.effBuy;
          steamEarned += extra * l.netSteam;
          remC -= extra * l.effBuy;
        }
      }
      cashWallet -= spentM1;
      const cashLeftAfterLeg1 = cashWallet;
      steamWallet += steamEarned;
      const steamAfterLeg1 = steamWallet;

      const availSteam = Math.max(0, steamWallet);
      const l2Weights = l2Eval.map((l) => (totalSteamSpent2 > 0 ? l.steamSpentUsd / totalSteamSpent2 : 1 / Math.max(1, l2Eval.length)));
      let remS = availSteam;
      for (let j = 0; j < l2Eval.length; j++) {
        const l = l2Eval[j];
        if (l.steamUsd <= 0) continue;
        const target = Math.min(remS, availSteam * l2Weights[j]);
        const q = Math.floor(target / l.steamUsd);
        q2Cycle += q;
        spentS2 += q * l.steamUsd;
        cashReturnM2 += q * l.netSell;
        remS -= q * l.steamUsd;
      }
      const l2Cheap = [...l2Eval].filter((l) => l.steamUsd > 0).sort((a, b) => a.steamUsd - b.steamUsd);
      for (const l of l2Cheap) {
        const extra = Math.floor(remS / l.steamUsd);
        if (extra > 0) {
          q2Cycle += extra;
          spentS2 += extra * l.steamUsd;
          cashReturnM2 += extra * l.netSell;
          remS -= extra * l.steamUsd;
        }
      }
      steamWallet -= spentS2;
      cashWallet += cashReturnM2;

      const steamCashEquiv = steamWallet * (m2 > 0 ? m2 : 0);
      const cashEquivPortfolio = cashWallet + steamCashEquiv;
      const netProfit = cashEquivPortfolio - cap0;
      const netRoiPct = cap0 > 0 ? (netProfit / cap0) * 100 : 0;
      const theoMult = Math.pow(Math.max(0, mCycle), k);
      const theoPortfolio = cap0 * theoMult;

      realisticCycles.push({
        cycle: k,
        days: k * 14,
        weeks: k * 2,
        q1: q1Cycle,
        spentM1,
        cashLeftAfterLeg1,
        steamAfterLeg1,
        q2: q2Cycle,
        spentS2,
        cashReturnM2,
        cashWallet,
        steamWallet,
        steamCashEquiv,
        cashEquivPortfolio,
        nominalPortfolio: cashWallet + steamWallet,
        netProfit,
        netRoiPct,
        theoMult,
        theoPortfolio,
        theoProfit: theoPortfolio - cap0,
        theoRoiPct: cap0 > 0 ? ((theoPortfolio - cap0) / cap0) * 100 : 0
      });
    }
  }

  return {
    isBasket: true,
    capitalUsd: cap0,
    pM1Usd,
    effPM1: calcEffectiveBuyUsd(pM1Usd, buyFeePct),
    pS1Usd,
    netS1: totalQ1 > 0 ? totalSteamEarned1 / totalQ1 : 0,
    exactSteamDetail: {
      buyerUsd: pS1Usd,
      netUsd: totalQ1 > 0 ? totalSteamEarned1 / totalQ1 : 0,
      totalFeeUsd: totalSteamFeeUsd,
      effectiveFeePct: weightedSteamFeePct,
      isMinFeeTrap: anyMinFeeTrap
    },
    m1,
    leg1ProfitPct,
    pS2Usd,
    pM2Usd,
    netM2: totalQ2 > 0 ? totalCashReturn2 / totalQ2 : 0,
    m2,
    conversionLossPct,
    mCycle,
    netCycleRoiPct,
    breakEvenLossLimitPct,
    marginOfSafetyPct,
    firstCycle: realisticCycles[0],
    realisticCycles,
    basketDetail: {
      leg1: l1Eval,
      leg2: l2Eval,
      totalSpent1,
      totalSteamEarned1,
      totalSteamSpent2,
      totalCashReturn2,
      overBudgetUsd,
      overSteamUsd
    }
  };
}

/**
 * Parallel Execution Reality & Risk Profiler for an Active Multi-Item Desk Basket
 */
export function estimateBasketReality(basketMetrics, leg1ItemsMap, leg2ItemsMap, opts = {}) {
  const bd = basketMetrics.basketDetail;
  const reasons = [];
  let maxExtraL1 = 0;
  let maxExtraL2 = 0;
  const l1RiskW = [];
  const l2RiskW = [];

  for (const line of bd.leg1) {
    const it = leg1ItemsMap.get(line.name.toLowerCase()) || null;
    const vel = computeVelocityProfile(it, opts.marketplace, 1);
    const fd = estimateLeg1FillDays(it, vel, line.qty);
    if (fd > maxExtraL1) maxExtraL1 = fd;
    if (it && (vel.tier === 'C' || vel.tier === 'D')) {
      reasons.push(
        bi(`Step 1 (${line.name}): ${vel.slowWarning || 'Moderate/slow Steam demand.'}`, `1. Adım (${line.name}): ${vel.slowWarning || 'Steam satış hızı orta/yavaş.'}`)
      );
    }
    l1RiskW.push({ weight: line.spentUsd, sigma: computeItemVolatility7d(it) });
  }

  for (const line of bd.leg2) {
    const it = leg2ItemsMap.get(line.name.toLowerCase()) || null;
    const vel = computeVelocityProfile(it, opts.marketplace, 2);
    const fd = estimateLeg2FillDays(it, vel, line.qty, opts.useBuyOrderForLeg2);
    if (fd > maxExtraL2) maxExtraL2 = fd;
    if (it && (vel.tier === 'C' || vel.tier === 'D')) {
      reasons.push(
        bi(`Step 2 (${line.name}): ${vel.slowWarning || 'Cashout may take extra days.'}`, `2. Adım (${line.name}): ${vel.slowWarning || 'Nakit dönüşü uzayabilir.'}`)
      );
    }
    l2RiskW.push({ weight: line.steamSpentUsd, sigma: computeItemVolatility7d(it) });
  }

  if (bd.overBudgetUsd > 0.5) {
    reasons.unshift(
      bi(
        `Basket buy cost exceeds budget by $${bd.overBudgetUsd.toFixed(2)} — raise budget or lower Step 1 qty.`,
        `Sepet alış tutarı bütçeyi $${bd.overBudgetUsd.toFixed(2)} aşıyor — bütçeyi artırın veya 1. adım adedini azaltın.`
      )
    );
  }
  if (bd.overSteamUsd > 0.5) {
    reasons.unshift(
      bi(
        `Step 2 exit basket costs $${bd.overSteamUsd.toFixed(2)} more than Step 1 Steam balance — reduce Step 2 qty.`,
        `2. Adım sepeti Steam bakiyesini $${bd.overSteamUsd.toFixed(2)} aşıyor — 2. adım adedini azaltın.`
      )
    );
  }

  const totalExtra = maxExtraL1 + maxExtraL2;
  const minDays = 14 + Math.floor(totalExtra * 0.5);
  const maxDays = 14 + Math.max(totalExtra, 1);
  const risk = computePortfolioRisk(l1RiskW, l2RiskW, basketMetrics.firstCycle.netRoiPct, basketMetrics.capitalUsd);

  let level = 'smooth';
  let pillCls = 'pill-mint';
  const k2Count = bd.leg2.length;
  let label = bi(
    `Parallel (~${minDays}–${maxDays}d • ${k2Count} Exits)`,
    `Paralel (~${minDays}–${maxDays}G • ${k2Count} Çıkış)`
  );

  if (bd.overBudgetUsd > 0.5 || bd.overSteamUsd > 0.5 || maxDays >= 28) {
    level = 'impractical';
    pillCls = 'pill-crimson';
    label = bi(`Check Basket (~${minDays}–${maxDays}d)`, `Sepeti Kontrol Et (~${minDays}–${maxDays}G)`);
  } else if (maxDays >= 20) {
    level = 'slow';
    pillCls = 'pill-amber';
    label = bi(`Extended (~${minDays}–${maxDays}d)`, `Süre Uzar (~${minDays}–${maxDays}G)`);
  } else if (totalExtra >= 2) {
    level = 'moderate';
    pillCls = 'pill-gold';
  }

  return {
    level,
    label,
    pillCls,
    minDays,
    maxDays,
    extraDays: totalExtra,
    estFillDays1: maxExtraL1,
    estFillDays2: maxExtraL2,
    storageUnits: 0,
    bookRatio1: 0,
    risk,
    reasons,
    needsUpperTierSuggestion: level === 'impractical' || level === 'slow'
  };
}

/**
 * SPREAD Agent V7 — Deterministic 500-Scenario Fat-Tail Correlated Monte Carlo Risk Engine
 *
 * Models real-world CS2 7+7D trade-hold risks that naive calculators ignore:
 *  - Fat-tail crash shocks (Student-t / negative skew for sudden Valve Armory / Major sale dips)
 *  - Cross-leg market correlation (rho = 0.45 between Step 1 Steam hold & Step 2 CSFloat hold)
 *  - Buff163 global mean-reversion drift (undervalued vs Buff -> positive drift; overpriced -> negative drift)
 *  - 30d momentum drift (penalizes falling items)
 *  - CSFloat Buy-Order floor cushion + Half-Kelly position sizing + Steam Buy-Gap / Craft-Skew warnings
 */
export function runMonteCarloSimulation({
  leg1Lines = [],
  leg2Lines = [],
  expectedProfitUsd = 0,
  capitalUsd = 200,
  instantFloorProfitUsd = null,
  marketplace = 'CSFLOAT',
  trials = 500
}) {
  const cap = Math.max(1, Number(capitalUsd) || 200);
  const baseRoiPct = (expectedProfitUsd / cap) * 100;

  const l1W = leg1Lines.map((l) => ({
    weight: Math.max(0.01, l.spentUsd || 1),
    sigma: computeItemVolatility7d(l.item, l.m),
    item: l.item,
    m: l.m
  }));
  const l2W = leg2Lines.map((l) => ({
    weight: Math.max(0.01, l.steamCostUsd || l.steamSpentUsd || 1),
    sigma: computeItemVolatility7d(l.item, l.m),
    item: l.item,
    m: l.m
  }));

  const baseRisk = computePortfolioRisk(l1W, l2W, baseRoiPct, cap);
  let sig1 = Math.max(1.8, baseRisk.sigma1Pct);
  const sig2 = Math.max(1.8, baseRisk.sigma2Pct);

  // V8 Directional Risk + Steam Ask-Illusion + Buff163 Mean-Reversion Drift
  let driftPct = 0;
  const warnings = [];
  const totalW1 = l1W.reduce((a, x) => a + x.weight, 0) || 1;
  for (const x of l1W) {
    const w = x.weight / totalW1;
    const vsBuff = x.m?.vsBuffPct;
    if (vsBuff !== null && vsBuff !== undefined) {
      if (vsBuff <= -2) driftPct += Math.min(2.2, Math.abs(vsBuff) * 0.22) * w;
      else if (vsBuff >= 8) driftPct -= Math.min(4.5, (vsBuff - 4) * 0.35) * w;
    }
    if (x.m?.trendStatus === 'FALLING') driftPct -= 2.4 * w;
    if (x.item?.stHist) {
      const st7 = Number(x.item.st7) || 0;
      const st30 = Number(x.item.st30) || 0;
      const stLast = Number(x.item.stLast) || 0;
      const stReal = Number(x.item.stReal) || 0;
      const askRef = Number(x.item.stSellOrd) || Number(x.item.s) || 0;
      const askGap = stReal > 0 && askRef > stReal ? ((askRef - stReal) / stReal) * 100 : 0;
      if (st7 <= 4) {
        sig1 *= 1 + 0.28 * w;
        warnings.push(
          bi(
            `${x.item.n}: Real Steam 7d has only ${st7} sales (30d: ${st30})${stLast > 0 ? ` — last sale $${stLast.toFixed(2)}` : ''}${askGap >= 4 ? ` vs lowest ask $${askRef.toFixed(2)} (+${askGap.toFixed(1)}%)` : ''}; list near realistic clearing price ($${stReal.toFixed(2)}).`,
            `${x.item.n}: Gerçek Steam 7g sadece ${st7} satış (30g: ${st30})${stLast > 0 ? ` — son satış $${stLast.toFixed(2)}` : ''}${askGap >= 4 ? ` (en düşük ilan $${askRef.toFixed(2)}, +%${askGap.toFixed(1)} pahalı)` : ''}; gerçekçi satış ($${stReal.toFixed(2)}) hedefle.`
          )
        );
      } else if (askGap >= 5.5) {
        warnings.push(
          bi(
            `${x.item.n}: Steam lowest ask ($${askRef.toFixed(2)}) is +${askGap.toFixed(1)}% above real recent sales ($${stReal.toFixed(2)}); SPREAD priced Leg 1 at realistic clearing value.`,
            `${x.item.n}: Steam en düşük ilan ($${askRef.toFixed(2)}) gerçek son satışların ($${stReal.toFixed(2)}) +%${askGap.toFixed(1)} üstünde; SPREAD 1. adımı gerçekçi satıştan hesapladı.`
          )
        );
      }
    } else if (x.item?.st24Checked && x.item.st24 === 0) {
      sig1 *= 1 + 0.25 * w;
      const bo = Number(x.item.stBuyOrd) || 0;
      warnings.push(
        bi(
          `${x.item.n}: 0 Steam sales in last 24h${bo > 0 ? ` — instant Steam Buy Order is $${bo.toFixed(2)}` : ''}; expect extra Steam sell wait.`,
          `${x.item.n}: Steam'de son 24s'te 0 satış${bo > 0 ? ` — anında Steam alım emri $${bo.toFixed(2)}` : ''}; Steam satış beklemesi uzayabilir.`
        )
      );
    }
    if (marketplace !== 'YOUPIN' && x.item?.cfAvg7 > 0 && x.item?.cf > 0 && x.item.cfAvg7 > x.item.cf * 1.4) {
      warnings.push(
        bi(
          `${x.item.n}: CSFloat 7d avg ($${x.item.cfAvg7}) > floor ($${x.item.cf}) — sticker/float crafts present; buy clean floor.`,
          `${x.item.n}: CSFloat 7g ort ($${x.item.cfAvg7}) tabandan ($${x.item.cf}) yüksek — sticker/float craft yoğun, temiz taban ilan al.`
        )
      );
    }
    if (marketplace === 'YOUPIN' && x.item?.ypo > 0 && x.item?.yp > 0 && ((x.item.yp - x.item.ypo) / x.item.yp) * 100 > 8) {
      const sp = (((x.item.yp - x.item.ypo) / x.item.yp) * 100).toFixed(1);
      warnings.push(
        bi(
          `${x.item.n}: Youpin898 Ask/Bid gap is ${sp}% — consider placing a Youpin buy order instead of paying instant ask.`,
          `${x.item.n}: Youpin898 Ask/Bid farkı %${sp} — direkt ilan almak yerine Youpin alım emri (buy order) bırakabilirsin.`
        )
      );
    }
  }

  const totalW2 = l2W.reduce((a, x) => a + x.weight, 0) || 1;
  for (const x of l2W) {
    const w = x.weight / totalW2;
    if (x.m?.trendStatus === 'FALLING') driftPct -= 1.8 * w;
    const sRaw = Number(x.item?.s) || 0;
    const sUsed = Number(x.m?.steamUsd) || sRaw;
    const stBo = Number(x.item?.stBuyOrd) || 0;
    if (stBo > 0 && sUsed > 0 && ((sUsed - stBo) / sUsed) * 100 >= 2.5) {
      const savePct = (((sUsed - stBo) / sUsed) * 100).toFixed(1);
      warnings.push(
        bi(
          `${x.item.n}: Steam Buy Order ($${stBo.toFixed(2)}) is ${savePct}% cheaper than ask — place a Step 2 Buy Order for extra profit!`,
          `${x.item.n}: Steam Alım Emri ($${stBo.toFixed(2)}) ilandan %${savePct} ucuz — 2. adımda Emirle Al ile ekstra kâr yakala!`
        )
      );
    } else if (sRaw > 0 && sUsed > 0 && ((sRaw - sUsed) / sUsed) * 100 > 6.5) {
      const gap = (((sRaw - sUsed) / sUsed) * 100).toFixed(1);
      warnings.push(
        bi(
          `${x.item.n}: Instant Steam ask is +${gap}% above 7d avg — place a Steam Buy Order in Step 2.`,
          `${x.item.n}: Steam anlık fiyatı 7g ortalamadan +%${gap} yüksek — 2. adımda Steam Buy Order (alım emri) ile al.`
        )
      );
    }
  }

  // Seeded deterministic PRNG (Mulberry32) so numbers stay rock-steady on UI re-renders
  let seed = (Math.round(cap * 100) ^ Math.round(sig1 * 1000) ^ (Math.round(sig2 * 1000) << 7) ^ 0x9e3779b9) >>> 0;
  const nextRand = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const randNormal = () => {
    const u1 = Math.max(1e-7, nextRand());
    const u2 = nextRand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  const RHO_CROSS = 0.45;
  const sqrtOneMinusRho2 = Math.sqrt(1 - RHO_CROSS * RHO_CROSS);
  const outcomes = new Array(trials);
  let wins = 0;
  let sumProfit = 0;

  // Hard downside cushion from instant CSFloat Buy-Order floor (if known)
  const floorCapLoss =
    instantFloorProfitUsd !== null && Number.isFinite(instantFloorProfitUsd)
      ? instantFloorProfitUsd - cap * 0.14
      : -cap * 0.45;

  for (let i = 0; i < trials; i++) {
    const z1 = randNormal();
    const z2 = RHO_CROSS * z1 + sqrtOneMinusRho2 * randNormal();
    // Fat-tail negative skew: 10% chance of market-wide Valve/Major shock (1.55x shock multiplier)
    const isTailEvent = nextRand() < 0.1;
    const tailScale = isTailEvent ? 1.55 : 0.94;
    const shock1 = z1 * sig1 * tailScale * (z1 < 0 ? 1.12 : 0.92);
    const shock2 = z2 * sig2 * tailScale * (z2 < 0 ? 1.1 : 0.94);

    const simRoiPct = baseRoiPct + driftPct + shock1 + shock2;
    const simProfitUsd = Math.max(floorCapLoss, (cap * simRoiPct) / 100);
    outcomes[i] = simProfitUsd;
    sumProfit += simProfitUsd;
    if (simProfitUsd > 0) wins += 1;
  }

  outcomes.sort((a, b) => a - b);
  const evProfitUsd = Math.round((sumProfit / trials) * 100) / 100;
  const evRoiPct = Math.round(((evProfitUsd / cap) * 100) * 100) / 100;
  const popPct = Math.round(((wins / trials) * 100) * 10) / 10;

  // Expected Shortfall (CVaR 5%: average of the worst 5% crash trials)
  const tailN = Math.max(1, Math.floor(trials * 0.05));
  let tailSum = 0;
  for (let i = 0; i < tailN; i++) tailSum += outcomes[i];
  const cvar5ProfitUsd = Math.round((tailSum / tailN) * 100) / 100;
  const p90ProfitUsd = Math.round(outcomes[Math.min(trials - 1, Math.floor(trials * 0.9))] * 100) / 100;

  // Fractional Half-Kelly recommended max single-cycle allocation %
  const avgWin = Math.max(1, evProfitUsd > 0 ? evProfitUsd : 1);
  const avgDownside = Math.max(1, Math.abs(Math.min(-1, cvar5ProfitUsd)));
  const pWin = popPct / 100;
  const rawKelly = pWin - (1 - pWin) / (avgWin / avgDownside);
  const kellyPct = Math.round(Math.max(15, Math.min(100, rawKelly * 100 * 0.85)));

  // Plain Risk Grade (A+ -> C)
  let riskGrade = 'B';
  let riskCls = 'pill-gold';
  let riskLabel = bi('Balanced Risk', 'Dengeli Risk');
  if (popPct >= 97 && cvar5ProfitUsd >= 0 && baseRisk.sigma14dPct <= 8.5) {
    riskGrade = 'A+';
    riskCls = 'pill-mint';
    riskLabel = bi('Institutional Low Risk', 'Çok Düşük Risk');
  } else if (popPct >= 92 && cvar5ProfitUsd >= -cap * 0.03) {
    riskGrade = 'A';
    riskCls = 'pill-mint';
    riskLabel = bi('Low Risk', 'Düşük Risk');
  } else if (popPct >= 82) {
    riskGrade = 'B+';
    riskCls = 'pill-ice';
    riskLabel = bi('Controlled Risk', 'Kontrollü Risk');
  } else if (popPct < 65) {
    riskGrade = 'C';
    riskCls = 'pill-amber';
    riskLabel = bi('Elevated Volatility', 'Yüksek Oynaklık');
  }

  return {
    trials,
    popPct,
    evProfitUsd,
    evRoiPct,
    cvar5ProfitUsd,
    p90ProfitUsd,
    sigma14dPct: baseRisk.sigma14dPct,
    driftPct: Math.round(driftPct * 100) / 100,
    kellyPct,
    riskGrade,
    riskCls,
    riskLabel,
    warnings: warnings.slice(0, 2)
  };
}

/**
 * SPREAD Agent V7 — Auto-Rebalancer for Active Multi-Item Desk Baskets!
 * When the user removes (e.g. 3 -> 2 skins) or adds a skin on the desk, automatically
 * redistributes the freed Steam Wallet (Leg 2) or cash budget (Leg 1) across the remaining items
 * using Almgren-Chriss marginal-utility integer allocation!
 */
export function rebalanceBasketLeg(leg1Lines, leg2Lines, targetLegNum, capitalUsd, opts, findItemFn) {
  const cap = Math.max(1, Number(capitalUsd) || 200);
  const isCSFloat = opts.marketplace !== 'YOUPIN';

  if (targetLegNum === 2) {
    if (!Array.isArray(leg2Lines) || leg2Lines.length === 0) return leg2Lines;
    // Compute total exact Net Steam available from Leg 1
    let totalSteamUsd = 0;
    for (const l1 of leg1Lines || []) {
      const q = Math.max(0, Math.floor(Number(l1.qty) || 0));
      const netS = calcNetSteamUsd(Number(l1.steamUsd) || 0, opts.steamFeeMode, opts.steamCustomFeePct);
      totalSteamUsd += q * netS;
    }
    if (totalSteamUsd <= 0) return leg2Lines;

    // Wrap current Leg 2 desk lines into subset format preserving user's exact edited prices!
    const subset = leg2Lines.map((line) => {
      const catalogItem = typeof findItemFn === 'function' ? findItemFn(line.name) : null;
      const synthItem = catalogItem || { n: line.name, s: line.steamUsd, cf: line.marketUsd, yp: line.marketUsd, q: 120, v7: 15, v30: 60, mv: 60 };
      const vel = computeVelocityProfile(synthItem, opts.marketplace, 2);
      const netSell = calcNetSellUsd(line.marketUsd, opts.sellFeePct, opts.withdrawFeePct);
      const m2 = line.steamUsd > 0 ? netSell / line.steamUsd : 0;
      return {
        item: synthItem,
        qty: Number(synthItem.q) || 120,
        vel,
        m: {
          steamUsd: line.steamUsd,
          marketSellUsd: line.marketUsd,
          netSell,
          m2,
          leg2LossPct: (1 - m2) * 100
        },
        origLine: line
      };
    });

    const alloc = allocateSteamAcrossSubset(subset, totalSteamUsd, opts, cap);
    if (alloc && alloc.lines.length > 0) {
      const qtyByName = new Map(alloc.lines.map((l) => [l.item.n.toLowerCase(), l.qty]));
      return leg2Lines.map((line) => ({
        ...line,
        qty: qtyByName.get(line.name.toLowerCase()) ?? Math.max(1, line.qty)
      }));
    }

    // Simple fallback if subset couldn't afford 1 of every item
    let rem = totalSteamUsd;
    const out = leg2Lines.map((l) => ({ ...l, qty: 0 }));
    const sortedIdx = out.map((_, idx) => idx).sort((a, b) => out[a].steamUsd - out[b].steamUsd);
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const idx of sortedIdx) {
        if (out[idx].steamUsd > 0 && out[idx].steamUsd <= rem + 0.001) {
          out[idx].qty += 1;
          rem -= out[idx].steamUsd;
          progressed = true;
        }
      }
    }
    return out;
  }

  // Rebalance Leg 1 across remaining Leg 1 items to deploy capital cleanly
  if (!Array.isArray(leg1Lines) || leg1Lines.length === 0) return leg1Lines;
  const out1 = leg1Lines.map((l) => ({ ...l, qty: 0 }));
  const effCosts = out1.map((l) => calcEffectiveBuyUsd(Number(l.marketUsd) || 0, opts.buyFeePct));
  const m1s = out1.map((l, i) => {
    const netS = calcNetSteamUsd(Number(l.steamUsd) || 0, opts.steamFeeMode, opts.steamCustomFeePct);
    return effCosts[i] > 0 ? netS / effCosts[i] : 0;
  });

  let remCash = cap;
  // Seed 1 unit each in order of highest price first
  const orderDesc = out1.map((_, i) => i).sort((a, b) => effCosts[b] - effCosts[a]);
  for (const idx of orderDesc) {
    if (effCosts[idx] > 0 && effCosts[idx] <= remCash + 0.01) {
      out1[idx].qty = 1;
      remCash -= effCosts[idx];
    }
  }
  // Allocate remaining cash favoring higher M1 while respecting soft diversification
  const orderByM1 = out1.map((_, i) => i).sort((a, b) => m1s[b] - m1s[a]);
  let guard = 0;
  while (guard < 250) {
    guard += 1;
    let added = false;
    for (const idx of orderByM1) {
      if (effCosts[idx] > 0 && effCosts[idx] <= remCash + 0.01) {
        const it = typeof findItemFn === 'function' ? findItemFn(out1[idx].name) : null;
        const maxBook = isCSFloat && it?.q ? Math.max(6, Math.floor(it.q * 0.5)) : 200;
        if (out1[idx].qty < maxBook) {
          out1[idx].qty += 1;
          remCash -= effCosts[idx];
          added = true;
          break;
        }
      }
    }
    if (!added) break;
  }
  return out1;
}

/**
 * SPREAD Agent V7 — Fixed / Owned Leg 1 Arbitrage Optimizer!
 * Given ANY custom Leg 1 skin(s) the user places on Step 1 (e.g. an owned ★ Karambit | Doppler FN),
 * computes the optimal single exit, parallel multi-skin exit basket (2-3 skins), and low-click exit,
 * complete with Direct CSFloat vs Steam Arbitrage check & 500-scenario Monte Carlo risk metrics!
 */
export function optimizeArbitrageForOwnedLeg1(items, leg1DeskLines, opts, capitalUsd, findItemFn) {
  if (!Array.isArray(items) || !Array.isArray(leg1DeskLines) || leg1DeskLines.length === 0) return null;
  const isCSFloat = opts.marketplace !== 'YOUPIN';

  // Build exact Leg 1 lines preserving user's chosen skin(s), qty & prices
  const leg1Lines = leg1DeskLines
    .map((row) => {
      const q = Math.max(1, Math.floor(Number(row.qty) || 1));
      const buyUsd = Math.max(0.01, Number(row.marketUsd) || 0);
      const steamUsd = Math.max(0.03, Number(row.steamUsd) || 0);
      const found = typeof findItemFn === 'function' ? findItemFn(row.name) : null;
      const itemObj = found || {
        n: row.name,
        c: inferCatFallback(row.name),
        w: '',
        r: 'Covert',
        rc: '#eb4b4b',
        s: steamUsd,
        s7: steamUsd,
        s30: steamUsd,
        s90: steamUsd,
        cf: buyUsd,
        cfo: buyUsd * 0.93,
        q: 40,
        v7: 5,
        v30: 20,
        mv: 20
      };
      const effBuy = calcEffectiveBuyUsd(buyUsd, opts.buyFeePct);
      const netSteam = calcNetSteamUsd(steamUsd, opts.steamFeeMode, opts.steamCustomFeePct);
      const m1 = effBuy > 0 ? netSteam / effBuy : 0;
      const vel = computeVelocityProfile(itemObj, opts.marketplace, 1);
      const m = {
        ...(found ? evaluateItemMetrics(found, opts) : {}),
        marketBuyUsd: buyUsd,
        effBuy,
        steamUsd,
        netSteam,
        m1,
        leg1ProfitPct: (m1 - 1) * 100
      };
      return buildLeg1Line({ item: itemObj, m, vel, qty: Number(itemObj.q) || 40 }, q, opts);
    })
    .filter((l) => l.spentUsd > 0 && l.netSteamUsd > 0);

  if (leg1Lines.length === 0) return null;

  const totalSpent1 = leg1Lines.reduce((a, l) => a + l.spentUsd, 0);
  const effectiveCap = Math.max(Number(capitalUsd) || 0, totalSpent1);
  const totalNetSteamUsd = leg1Lines.reduce((a, l) => a + l.netSteamUsd, 0);
  const directSellNetUsd = leg1Lines.reduce(
    (a, l) => a + l.qty * calcNetSellUsd(l.unitBuyUsd, opts.sellFeePct, opts.withdrawFeePct),
    0
  );

  // Gather eligible high-liquidity Leg 2 exit candidates (excluding estimated-Steam items!)
  const leg1Names = new Set(leg1Lines.map((l) => l.item.n.toLowerCase()));
  const tier = getCapitalTierInfo(effectiveCap);
  const l2Pool = [];
  for (const item of items) {
    if (item.sEst || item.st || item.sv || item.isGem || item.phPrem) continue;
    if (leg1Names.has(item.n.toLowerCase())) continue;
    const qty = Number(item.q) || 0;
    if (isCSFloat && qty < 14) continue;
    if (item.c === 'Capsule' && (item.v7 || 0) < 35) continue;

    const m = evaluateItemMetrics(item, opts);
    if (!m.hasValidMarket || m.isSpiky) continue;
    const vel = m.velocity;
    if (vel.tier !== 'A' && vel.tier !== 'B') continue;
    if (vel.isKnifeOrGlove && !(effectiveCap >= 1200 && vel.sold7d >= 6 && qty >= 45)) continue;
    if (vel.bidAskPct > 0 && vel.bidAskPct < (isCSFloat ? 86 : 88)) continue;
    if (m.leg2LossPct < 3.0 && !(vel.tier === 'A' && vel.mktVol >= 150 && m.leg2LossPct >= 0.5)) continue;
    if (m.leg2LossPct > 16.5) continue;
    if (m.steamUsd < Math.min(Math.max(tier.minL2Price * 0.65, totalNetSteamUsd / 55, 5), totalNetSteamUsd * 0.45)) continue;
    if (m.steamUsd > totalNetSteamUsd) continue;
    l2Pool.push({ item, m, vel: computeVelocityProfile(item, opts.marketplace, 2), qty });
  }

  if (l2Pool.length === 0) return null;

  const l2Ranked = [...l2Pool]
    .sort((a, b) => {
      const sa = -a.m.leg2LossPct + (a.vel.tier === 'A' ? 2.6 : 0) + Math.min(2, a.vel.turnover30Pct / 20);
      const sb = -b.m.leg2LossPct + (b.vel.tier === 'A' ? 2.6 : 0) + Math.min(2, b.vel.turnover30Pct / 20);
      return sb - sa;
    })
    .slice(0, 14);

  const l2LowClickPool = [...l2Pool]
    .filter((x) => x.m.steamUsd >= Math.max(45, totalNetSteamUsd / 10))
    .sort((a, b) => a.m.leg2LossPct - b.m.leg2LossPct)
    .slice(0, 10);

  const plan1 = solveLeg2ForCount(l2Ranked, leg1Lines, effectiveCap, 1, opts, leg1Lines.length, 1);
  const plan2 = totalNetSteamUsd >= 80 ? solveLeg2ForCount(l2Ranked, leg1Lines, effectiveCap, 2, opts, leg1Lines.length, 2) : null;
  const plan3 = totalNetSteamUsd >= 220 ? solveLeg2ForCount(l2Ranked, leg1Lines, effectiveCap, 3, opts, leg1Lines.length, 3) : null;
  const lowClickPlan =
    l2LowClickPool.length > 0
      ? solveLeg2ForCount(l2LowClickPool, leg1Lines, effectiveCap, totalNetSteamUsd >= 500 && l2LowClickPool.length >= 2 ? 2 : 1, opts, leg1Lines.length, 0)
      : null;

  const attachMc = (plan, id, tag, title) => {
    if (!plan) return null;
    const mc = runMonteCarloSimulation({
      leg1Lines: plan.leg1Lines,
      leg2Lines: plan.leg2Lines,
      expectedProfitUsd: plan.slippageAdjProfitUsd,
      capitalUsd: effectiveCap,
      instantFloorProfitUsd: plan.instantFloorProfitUsd,
      marketplace: opts.marketplace
    });
    const extraVsDirectUsd = Math.round((plan.endCashEquivUsd - (effectiveCap - totalSpent1) - directSellNetUsd) * 100) / 100;
    return { id, tag, title, plan, mc, extraVsDirectUsd };
  };

  // Pick best parallel split between k2=2 and k2=3
  const bestSplitRaw =
    plan2 && plan3 ? (plan3.basketScore > plan2.basketScore ? plan3 : plan2) : plan2 || plan3 || plan1;

  const options = [];
  const seenKeys = new Set();
  const pushOpt = (opt) => {
    if (!opt) return;
    const key = opt.plan.leg2Lines.map((l) => `${l.item.n}:${l.qty}`).join('|');
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    options.push(opt);
  };

  pushOpt(
    attachMc(
      bestSplitRaw,
      'AUTO_PARALLEL',
      bi(`AGENT PICK • ${bestSplitRaw?.k2 || 1} EXITS`, `AGENT ÖNERİSİ • ${bestSplitRaw?.k2 || 1} ÇIKIŞ`),
      bi('Optimal Parallel Cashout Plan', 'En Dengeli Paralel Çıkış Planı')
    )
  );
  pushOpt(
    attachMc(
      plan1,
      'SINGLE_BEST',
      bi('SINGLE EXIT', 'TEKLİ ÇIKIŞ'),
      bi('Simplest 1-Skin Cashout', 'Tek Skinle En Temiz Çıkış')
    )
  );
  if (lowClickPlan && lowClickPlan.totalQ2 <= 10) {
    pushOpt(
      attachMc(
        lowClickPlan,
        'LOW_CLICK',
        bi(`FEW ITEMS (${lowClickPlan.totalQ2}x)`, `AZ ADET (${lowClickPlan.totalQ2}x)`),
        bi('Minimal Trades / High-Ticket Exits', 'Az Tık · Üst Bant Çıkış')
      )
    );
  }

  if (options.length === 0) return null;
  const topOpt = options[0];

  return {
    effectiveCap,
    totalSpent1: Math.round(totalSpent1 * 100) / 100,
    totalNetSteamUsd: Math.round(totalNetSteamUsd * 100) / 100,
    directSellNetUsd: Math.round(directSellNetUsd * 100) / 100,
    beatsDirectSell: topOpt.extraVsDirectUsd > 0,
    topExtraVsDirectUsd: topOpt.extraVsDirectUsd,
    options
  };
}

function inferCatFallback(name) {
  if (String(name || '').startsWith('★') && /Gloves|Wraps/i.test(name)) return 'Gloves';
  if (String(name || '').startsWith('★')) return 'Knives';
  return 'Skin';
}
