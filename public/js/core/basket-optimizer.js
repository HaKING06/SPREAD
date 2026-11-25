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
  return {
    item: cand.item,
    m: cand.m,
    vel: cand.vel,
    qty,
    unitBuyUsd: cand.m.marketBuyUsd,
    unitEffBuyUsd: cand.m.effBuy,
    unitSteamUsd: cand.m.steamUsd,
    unitNetSteamUsd: cand.m.netSteam,
    spentUsd,
    netSteamUsd,
    slipPct: Math.round(slipPct * 100) / 100,
    slippageUsd,
    fillDays,
    sigma7d
  };
}

function buildLeg2Line(cand, qty, opts) {
  const isCSFloat = opts.marketplace !== 'YOUPIN';
  const steamCostUsd = qty * cand.m.steamUsd;
  const cashReturnUsd = qty * cand.m.netSell;
  const slipPct = opts.useBuyOrderForLeg2 ? 0 : calcSlipPct(qty, cand.qty, 1.5);
  const slippageUsd = cashReturnUsd * (slipPct / 100);
  const instSell = isCSFloat && cand.item.cfo > 0 ? cand.item.cfo : cand.m.marketSellUsd;
  const instNetUnit = calcNetSellUsd(instSell, opts.sellFeePct, opts.withdrawFeePct);
  const instantCashUsd = qty * instNetUnit;
  const fillDays = estimateLeg2FillDays(cand.item, cand.vel, qty, opts.useBuyOrderForLeg2);
  const sigma7d = computeItemVolatility7d(cand.item, cand.m);
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
  for (const l of lines) {
    totalSpent += l.spentUsd;
    totalNetSteam += l.netSteamUsd;
    totalSlip += l.slippageUsd;
    if (l.fillDays > maxFill) maxFill = l.fillDays;
    const w = l.spentUsd / Math.max(1, cap);
    if (l.m.isBelowBuff) buffBonusSum += 3.2 * w;
    if (l.m.isOverBuff) buffBonusSum -= 4.0 * w;
    if (l.m.trendStatus === 'FALLING') buffBonusSum -= 5.0 * w;
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
  return timeAdj * 1.45 + deployBonus + buffBonusSum - sigma1 * 0.45 - Math.max(0, maxFill - 3) * 1.1;
}

function maxSafeQtyL1(cand, cap, effectiveMaxQ1, isCSFloat) {
  const byBudget = Math.floor(cap / Math.max(0.01, cand.m.effBuy));
  const byBook = isCSFloat ? Math.max(6, Math.floor(cand.qty * 0.48)) : effectiveMaxQ1;
  const byVel = Math.max(8, Math.floor(cand.vel.estWeeklyCap * 1.15));
  return Math.max(0, Math.min(byBudget, byBook, byVel, effectiveMaxQ1));
}

function solveLeg1ForCount(cands, cap, k, opts, effectiveMaxQ1) {
  const isCSFloat = opts.marketplace !== 'YOUPIN';
  const top = cands.slice(0, 14);
  if (top.length < k) return null;

  let bestLines = null;
  let bestScore = -Infinity;

  const tryLines = (rawPairs) => {
    const valid = rawPairs.filter((x) => x.qty > 0);
    if (valid.length !== k) return;
    let spent = 0;
    for (const x of valid) spent += x.qty * x.cand.m.effBuy;
    if (spent > cap + 0.01) return;
    const lines = valid.map((x) => buildLeg1Line(x.cand, x.qty, opts));
    const sc = scoreLeg1Basket(lines, cap);
    if (sc > bestScore) {
      bestScore = sc;
      bestLines = lines;
    }
  };

  if (k === 1) {
    for (const c of top) {
      const q = maxSafeQtyL1(c, cap, effectiveMaxQ1, isCSFloat);
      if (q > 0) tryLines([{ cand: c, qty: q }]);
    }
    return bestLines;
  }

  if (k === 2) {
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
    return bestLines;
  }

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
            // Greedy pack any leftover cash into best affordable member of triad
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
  return bestLines;
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

  // Compute helper metrics for each skin
  const unitInstM2 = subset.map((c) => {
    const instSell = isCSFloat && c.item.cfo > 0 ? c.item.cfo : c.m.marketSellUsd;
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
        leg1Pool.push({ item, m, vel, qty, q1Est });
      }
    }

    // Leg 2 pool (high liquidity, low cashout loss, strong order-book turnover)
    const bidAskOk = !isCSFloat || vel.bidAskPct === 0 || vel.bidAskPct >= 85;
    const l2TierOk = minSpeed === 'MODERATE' ? allowedTiers.has(vel.tier) : vel.tier === 'A' || vel.tier === 'B';
    const l2NoKnife = !vel.isKnifeOrGlove || (cap >= 1500 && vel.sold7d >= 8 && qty >= 60);
    const l2MinPrice = Math.max(tier.minL2Price * 0.7, cap / 60, 4);
    const maxL2Loss = cap >= 1500 || minSpeed === 'MODERATE' ? 21 : 15.5;
    const l2NotAnom = m.leg2LossPct >= 3.0 || (vel.tier === 'A' && vel.mktVol >= 150 && m.leg2LossPct >= 0.5);

    if (
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
      leg2Pool.push({ item, m, vel, qty });
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
  const l1Cands = Array.from(new Map([...l1ByAlpha, ...l1MidFillers].map((x) => [x.item.n, x])).values());

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

  // Solve Leg 1 baskets for k1 = 1, 2, 3
  const l1ByK = {
    1: solveLeg1ForCount(l1Cands, cap, 1, opts, effectiveMaxQ1),
    2: cap >= 80 ? solveLeg1ForCount(l1Cands, cap, 2, opts, effectiveMaxQ1) : null,
    3: cap >= 220 ? solveLeg1ForCount(l1Cands, cap, 3, opts, effectiveMaxQ1) : null
  };

  // Determine candidate grid for (k1, k2)
  const k1List = buyCountReq > 0 ? [buyCountReq] : cap < 120 ? [1] : cap < 350 ? [1, 2] : [1, 2, 3];
  const k2List = sellCountReq > 0 ? [sellCountReq] : cap < 90 ? [1] : cap < 280 ? [1, 2] : [1, 2, 3, 4];

  // Always compute 1->1 single-pair baseline for transparent side-by-side proof
  const baseline11 = l1ByK[1] ? solveLeg2ForCount(l2Cands, l1ByK[1], cap, 1, opts, 1, 1) : null;

  // Evaluate requested grid
  const requestedCandidates = [];
  for (const k1 of k1List) {
    const l1Lines = l1ByK[k1] || l1ByK[Math.max(1, k1 - 1)] || l1ByK[1];
    if (!l1Lines) continue;
    for (const k2 of k2List) {
      const plan = solveLeg2ForCount(l2Cands, l1Lines, cap, k2, opts, buyCountReq, sellCountReq);
      if (plan) requestedCandidates.push(plan);
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
      const l1Lines = l1ByK[k1];
      if (!l1Lines) continue;
      for (const k2 of autoK2s) {
        if (k1 === selected.k1 && k2 === selected.k2) continue;
        const alt = solveLeg2ForCount(l2Cands, l1Lines, cap, k2, opts, 0, 0);
        if (alt && (!bestAuto || alt.basketScore > bestAuto.basketScore)) {
          bestAuto = alt;
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

  // Head-to-head proof vs 1->1 single-pair baseline
  let vsSingle = null;
  if (baseline11 && (selected.k1 > 1 || selected.k2 > 1)) {
    const profitDelta = Math.round((selected.netProfitUsd - baseline11.netProfitUsd) * 100) / 100;
    const daysSaved = Math.max(0, baseline11.maxDays - selected.maxDays);
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
      slipSavedPct,
      riskReductionPct
    };
  }

  // Plain-language executive rationale explaining WHY Agent chose this exact split
  let rationale = '';
  if (selected.k1 === 1 && selected.k2 === 1) {
    rationale = bi(
      `At this budget, a clean 1 → 1 pair maximizes net profit without over-splitting small capital.`,
      `Bu bütçede sermayeyi fazla bölmeden tek temiz 1 → 1 çift en yüksek net getiriyi veriyor.`
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
    if (vsSingle.daysSaved >= 1) {
      parts.push(
        bi(
          `parallel selling cuts cashout wait by ${vsSingle.daysSaved}d`,
          `paralel satışla çıkış süresini ${vsSingle.daysSaved} gün kısaltır`
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
              `Tek eşyada ${vsSingle.singleQ2}x yığmak yerine ${selected.k2} paralel çıkışa bölmek: ${parts.join(' • ')}.`
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
    const vel = computeVelocityProfile(it);
    const fd = estimateLeg1FillDays(it, vel, line.qty);
    if (fd > maxExtraL1) maxExtraL1 = fd;
    if (it && (vel.tier === 'C' || vel.tier === 'D')) {
      reasons.push(
        bi(`Step 1 (${line.name}): ${vel.slowWarning || 'Moderate/slow demand.'}`, `1. Adım (${line.name}): ${vel.slowWarning || 'Satış hızı orta/yavaş.'}`)
      );
    }
    l1RiskW.push({ weight: line.spentUsd, sigma: computeItemVolatility7d(it) });
  }

  for (const line of bd.leg2) {
    const it = leg2ItemsMap.get(line.name.toLowerCase()) || null;
    const vel = computeVelocityProfile(it);
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
