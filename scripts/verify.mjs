#!/usr/bin/env node
/**
 * SPREAD (spread.haking.tr) — Automated Quality, Math, Security & Asset Verification
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  analyzeCapitalStrategies,
  calcExactValveSteamFee,
  computeLoopMetrics,
  computeVelocityProfile,
  estimateExecutionReality,
  evaluateItemMetrics,
  findBestExitsForLeg1
} from '../public/js/core/math-engine.js';
import {
  computeBasketLoopMetrics,
  evaluateModeArbitration,
  optimizeArbitrageForOwnedLeg1,
  optimizeMultiItemBasket,
  rebalanceBasketLeg,
  runMonteCarloSimulation
} from '../public/js/core/basket-optimizer.js';
import { DICT, setLang, t } from '../public/js/core/i18n.js';
import { buildShareUrl, parseSharedSetupFromUrl } from '../public/js/core/router-share.js';
import { validateSettings } from '../public/js/services/vault-storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

let failures = 0;

function pass(msg) {
  console.log(`  [PASS] ${msg}`);
}

function fail(msg) {
  console.error(`  [FAIL] ${msg}`);
  failures += 1;
}

async function listFiles(dir, extList) {
  const results = [];
  async function walk(cur) {
    const entries = await fs.readdir(cur, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) await walk(full);
      else if (extList.some((ext) => ent.name.endsWith(ext))) results.push(full);
    }
  }
  await walk(dir);
  return results;
}

async function main() {
  console.log('\nSPREAD Verification Suite (spread.haking.tr)\n');

  // 1. JS Syntax Check across all public modules, Worker & scripts
  const jsFiles = [
    ...(await listFiles(path.join(PUBLIC_DIR, 'js'), ['.js'])),
    ...(await listFiles(path.join(ROOT, 'src'), ['.js'])),
    ...(await listFiles(path.join(ROOT, 'scripts'), ['.mjs'])),
    path.join(ROOT, 'server.mjs')
  ];

  for (const file of jsFiles) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (e) {
      fail(`Syntax error in ${path.relative(ROOT, file)}: ${e.stderr?.toString()}`);
    }
  }
  pass(`Checked syntax of ${jsFiles.length} JS/MJS files.`);

  // 2. Security Static Audit (no innerHTML/outerHTML/document.write/eval/Function in code)
  const appJs = await listFiles(path.join(PUBLIC_DIR, 'js'), ['.js']);
  let secFails = 0;
  for (const file of appJs) {
    const raw = await fs.readFile(file, 'utf8');
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (/\.\s*innerHTML\b|\.\s*outerHTML\b|\bdocument\.write\s*\(|\beval\s*\(|new\s+Function\s*\(/.test(code)) {
      fail(`Dangerous DOM/eval sink detected in ${path.relative(ROOT, file)}`);
      secFails += 1;
    }
  }
  if (secFails === 0) {
    pass('Security audit: zero innerHTML / eval / document.write sinks in public/js/.');
  }

  const indexHtml = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  // Allow non-executable JSON-LD structured data, forbid any executable inline <script>
  const inlineScriptRegex = /<script(?![^>]*\bsrc=)(?![^>]*type=["']application\/ld\+json["'])[^>]*>/i;
  if (inlineScriptRegex.test(indexHtml)) {
    fail('Inline executable <script> tag found in public/index.html (violates strict CSP script-src self)');
  } else {
    pass('Strict CSP audit: zero inline executable <script> tags in public/index.html (JSON-LD SEO verified).');
  }

  // 2a. Global SEO & i18n Dictionary Integrity Check
  const enKeys = Object.keys(DICT.en);
  const trKeys = Object.keys(DICT.tr);
  const missingTrKeys = enKeys.filter((k) => !DICT.tr[k]);
  if (
    indexHtml.includes('<html lang="en"') &&
    indexHtml.includes('application/ld+json') &&
    indexHtml.includes('hreflang="tr"') &&
    missingTrKeys.length === 0
  ) {
    setLang('en', false);
    const enSample = t('nav.about');
    setLang('tr', false);
    const trSample = t('nav.about');
    setLang('en', false);
    pass(`Global SEO & Bilingual i18n verified: EN default + hreflang + JSON-LD | ${enKeys.length}/${trKeys.length} keys (${enSample} / ${trSample}).`);
  } else {
    fail(`SEO/i18n check failed: missingTrKeys=${missingTrKeys.join(', ')}`);
  }

  // 2b. DOM ID Integrity Check
  const htmlIds = new Set([...indexHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const missingIds = [];
  for (const file of appJs) {
    const src = await fs.readFile(file, 'utf8');
    for (const m of src.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)) {
      if (!htmlIds.has(m[1])) {
        missingIds.push(`${path.relative(ROOT, file)} -> #${m[1]}`);
      }
    }
  }
  if (missingIds.length > 0) {
    fail(`Missing DOM IDs referenced in JS: ${missingIds.join(', ')}`);
  } else {
    pass(`DOM ID cross-check: 100% of JS getElementById() references exist in public/index.html (${htmlIds.size} IDs).`);
  }

  // 3. Required Brand, Data & Deploy Files
  const requiredFiles = [
    'public/index.html',
    'public/css/mobile.css',
    'public/_headers',
    'public/_redirects',
    'public/assets/brand/logo.jpg',
    'public/assets/brand/logo-192.png',
    'public/assets/brand/logo-512.png',
    'public/assets/brand/favicon.png',
    'public/assets/brand/banner.jpg',
    'public/data/catalog.json',
    'public/data/market-snapshot.json',
    'src/worker.js',
    'wrangler.toml',
    'LICENSE',
    'README.md',
    'SECURITY.md'
  ];

  for (const rel of requiredFiles) {
    try {
      const stat = await fs.stat(path.join(ROOT, rel));
      if (stat.size <= 0) fail(`Empty file: ${rel}`);
    } catch {
      fail(`Missing required file: ${rel}`);
    }
  }
  pass(`All ${requiredFiles.length} required brand, data, Cloudflare Worker & GitHub files present.`);

  // 4. Data Integrity Check
  const catalog = JSON.parse(await fs.readFile(path.join(PUBLIC_DIR, 'data', 'catalog.json'), 'utf8'));
  const snapshot = JSON.parse(await fs.readFile(path.join(PUBLIC_DIR, 'data', 'market-snapshot.json'), 'utf8'));
  if (catalog.items?.length >= 1000 && Object.keys(snapshot.prices || {}).length >= 1000) {
    pass(`Catalog (${catalog.items.length} items) & Snapshot (${Object.keys(snapshot.prices).length} priced items) verified.`);
  } else {
    fail('Catalog or snapshot has fewer than 1000 items.');
  }

  // 5. Math Engine Assertions
  const trap = calcExactValveSteamFee(0.03);
  if (trap.netUsd === 0.01 && trap.isMinFeeTrap) {
    pass('Valve exact cent math: $0.03 -> $0.01 net (66.67% fee trap detected).');
  } else {
    fail(`Valve exact cent math mismatch on $0.03: ${JSON.stringify(trap)}`);
  }

  const loop = computeLoopMetrics({
    capitalUsd: 150,
    pM1Usd: 0.48,
    pS1Usd: 0.76,
    pS2Usd: 20,
    pM2Usd: 18.4,
    buyFeePct: 0,
    sellFeePct: 1,
    withdrawFeePct: 0,
    steamFeeMode: 'DIV_115'
  });
  if (loop.firstCycle.netRoiPct <= loop.netCycleRoiPct + 0.001) {
    pass(
      `Cash-equivalent valuation verified: Realistic ROI (+${loop.firstCycle.netRoiPct.toFixed(2)}%) <= Theoretical ROI (+${loop.netCycleRoiPct.toFixed(2)}%).`
    );
  } else {
    fail(
      `Cash-equivalent valuation regression: Realistic (${loop.firstCycle.netRoiPct}) > Theoretical (${loop.netCycleRoiPct})`
    );
  }

  // 5b. Smart Capital Advisor + Shareable URL Parser Assertions
  const mergedSample = catalog.items
    .map((m) => ({ ...m, ...(snapshot.prices[m.n] || {}) }))
    .filter((x) => x.s > 0 && x.cf > 0);
  const adv = analyzeCapitalStrategies(
    mergedSample,
    { marketplace: 'CSFLOAT', buyFeePct: 0, sellFeePct: 2, withdrawFeePct: 0, steamFeeMode: 'EXACT_VALVE', conservativeSteamPrice: true },
    200
  );
  const adv800 = analyzeCapitalStrategies(
    mergedSample,
    { marketplace: 'CSFLOAT', buyFeePct: 0, sellFeePct: 2, withdrawFeePct: 0, steamFeeMode: 'EXACT_VALVE', conservativeSteamPrice: true },
    800
  );
  const allHaveConfidence = adv.strategies.every(
    (s) => Number.isFinite(s.pair?.confidenceScore) && s.pair.confidenceScore >= 35 && s.pair.confidenceScore <= 99
  );
  const noFalseFastOnSlow = adv.strategies.every((s) => !(s.pair?.hasSlowLeg && /FAST|HIZLI/i.test(s.tag)));
  const top800 = adv800.strategies[0]?.pair;
  const noParetoSuboptimal800 =
    top800 &&
    !adv800.strategies.some((other) => {
      const altExit = other.pair.leg2;
      if (altExit.item.n === top800.leg2.item.n) return false;
      const altSim = computeLoopMetrics({
        capitalUsd: 800,
        pM1Usd: top800.leg1.m.marketBuyUsd,
        pS1Usd: top800.leg1.m.steamSellUsd || top800.leg1.m.steamUsd,
        pS2Usd: altExit.m.steamUsd,
        pM2Usd: altExit.m.marketSellUsd,
        sellFeePct: 2
      });
      const altReal = estimateExecutionReality(altSim, top800.leg1.item, altExit.item, { marketplace: 'CSFLOAT' });
      return (
        altSim.firstCycle.netProfit > top800.c1.netProfit + 0.5 &&
        altReal.maxDays <= top800.reality.maxDays &&
        altSim.firstCycle.q2 <= top800.c1.q2
      );
    });
  const exits800 = top800
    ? findBestExitsForLeg1(
      mergedSample,
      {
        item: top800.leg1.item,
        name: top800.leg1.item.n,
        pM1Usd: top800.leg1.m.marketBuyUsd,
        pS1Usd: top800.leg1.m.steamSellUsd || top800.leg1.m.steamUsd
      },
      { marketplace: 'CSFLOAT', buyFeePct: 0, sellFeePct: 2, withdrawFeePct: 0, steamFeeMode: 'EXACT_VALVE', conservativeSteamPrice: true },
      800,
      3
    )
    : [];
  const fastTurnoverExit800 = top800 && (top800.leg2.vel.tier === 'A' || top800.leg2.vel.sold7d >= 12);
  if (
    adv.strategies.length >= 2 &&
    adv.tier.id === 'STARTER' &&
    allHaveConfidence &&
    noFalseFastOnSlow &&
    noParetoSuboptimal800 &&
    fastTurnoverExit800 &&
    exits800.length >= 2
  ) {
    pass(
      `SPREAD Agent V5.1 True-Turnover Pareto Optimizer verified: $200 (${adv.strategies.length} strats) | $800 Top=${top800.leg1.item.n} -> ${top800.c1.q2}x ${top800.leg2.item.n} (+$${top800.c1.netProfit.toFixed(2)}, 7d:${top800.leg2.vel.sold7d}, floor:+$${top800.instantFloorProfit.toFixed(2)}) | ${exits800.length} Pareto exits.`
    );
  } else {
    fail(
      `SPREAD Agent V5.1 check failed: count=${adv.strategies.length}, conf=${allHaveConfidence}, noFalseFast=${noFalseFastOnSlow}, paretoOk=${noParetoSuboptimal800}, fastExit=${fastTurnoverExit800}, exits=${exits800.length}`
    );
  }

  // Verify high-budget ($5000) realistic quantity cap & impracticality detector
  const extremeLoop = computeLoopMetrics({ capitalUsd: 5000, pM1Usd: 0.31, pS1Usd: 0.46, pS2Usd: 20, pM2Usd: 18.4, sellFeePct: 2 });
  const extremeReality = estimateExecutionReality(extremeLoop, { q: 400, v7: 100, mv: 200 }, { q: 200, v7: 50, mv: 200 }, { marketplace: 'CSFLOAT' });
  const whaleAdv = analyzeCapitalStrategies(
    mergedSample,
    { marketplace: 'CSFLOAT', buyFeePct: 0, sellFeePct: 2, withdrawFeePct: 0, steamFeeMode: 'EXACT_VALVE', conservativeSteamPrice: true },
    5000,
    { style: 'PATIENT', maxQty: 10, minSpeed: 'MODERATE', cleanOnly: true }
  );
  const lowQtyAdv = analyzeCapitalStrategies(
    mergedSample,
    { marketplace: 'CSFLOAT', buyFeePct: 0, sellFeePct: 2, withdrawFeePct: 0, steamFeeMode: 'EXACT_VALVE', conservativeSteamPrice: true },
    200,
    { style: 'LOW_QTY', maxQty: 10, minSpeed: 'FAST', cleanOnly: true }
  );
  const whaleMaxQ1 = whaleAdv.bestBenchmark?.c1?.q1 || 0;
  const lowQ1 = lowQtyAdv.bestBenchmark?.c1?.q1 || 0;
  if (extremeReality.level === 'impractical' && extremeReality.storageUnits > 10 && whaleMaxQ1 > 0 && whaleMaxQ1 <= 10 && lowQ1 > 0 && lowQ1 <= 10) {
    pass(
      `Execution Reality & Velocity Filters verified: 16k-case warning (${extremeReality.label}) | $200 LOW_QTY Q1=${lowQ1} | $5,000 PATIENT Q1=${whaleMaxQ1} (${whaleAdv.strategies.length} strats).`
    );
  } else {
    fail(`Execution Reality check failed: level=${extremeReality.level}, lowQ1=${lowQ1}, whaleQ1=${whaleMaxQ1}, whaleStrats=${whaleAdv.strategies.length}`);
  }

  const parsedShare = parseSharedSetupFromUrl('?m=cf&cur=TRY&cap=250&l1=Revolution+Case&p1m=0.55&p1s=0.89&l2=AK-47+%7C+Redline+%28Field-Tested%29&p2s=20&p2m=18.2');
  if (parsedShare && parsedShare.currency === 'TRY' && parsedShare.capitalUsd === 250 && parsedShare.leg1.name === 'Revolution Case') {
    pass('Shareable Deep-Link parser verified cleanly.');
  } else {
    fail('Shareable Deep-Link parser failed validation.');
  }

  // 5b-V6. Multi-Item Split / Basket Portfolio Optimizer & Risk Engine Verification
  {
    const opts800 = {
      marketplace: 'CSFLOAT',
      buyFeePct: 0,
      sellFeePct: 2,
      withdrawFeePct: 0,
      steamFeeMode: 'EXACT_VALVE',
      conservativeSteamPrice: true
    };
    const autoBasket800 = optimizeMultiItemBasket(mergedSample, opts800, 800, { buyCount: 0, sellCount: 0 });
    const split1x3 = optimizeMultiItemBasket(mergedSample, opts800, 800, { buyCount: 1, sellCount: 3 });
    const autoOk =
      autoBasket800?.plan &&
      autoBasket800.plan.netProfitUsd > 200 &&
      autoBasket800.plan.risk.popPct >= 90 &&
      autoBasket800.plan.deployedCashPct >= 90;
    const split1x3Ok =
      split1x3?.plan &&
      split1x3.plan.k1 === 1 &&
      split1x3.plan.k2 === 3 &&
      split1x3.plan.netProfitUsd > 190 &&
      split1x3.baseline11 &&
      split1x3.plan.risk.sigma14dPct < split1x3.baseline11.risk.sigma14dPct;
    if (autoOk && split1x3Ok) {
      // V6.1 Full Desk Basket Math, Vault Persistence & Share URL Roundtrip Check
      const deskBasket = {
        leg1: split1x3.plan.leg1Lines.map((l) => ({ name: l.item.n, qty: l.qty, marketUsd: l.unitBuyUsd, steamUsd: l.unitSteamUsd })),
        leg2: split1x3.plan.leg2Lines.map((l) => ({ name: l.item.n, qty: l.qty, steamUsd: l.unitSteamUsd, marketUsd: l.unitSellUsd }))
      };
      const deskMetrics = computeBasketLoopMetrics({
        capitalUsd: 800,
        leg1Lines: deskBasket.leg1,
        leg2Lines: deskBasket.leg2,
        buyFeePct: 0,
        sellFeePct: 2,
        withdrawFeePct: 0,
        steamFeeMode: 'EXACT_VALVE'
      });
      const savedSettings = validateSettings({
        marketplace: 'CSFLOAT',
        currency: 'USD',
        capitalUsd: 800,
        splitMode: true,
        splitBuyCount: 1,
        splitSellCount: 3,
        activeBasket: deskBasket,
        leg1: { name: deskBasket.leg1[0].name, marketUsd: deskBasket.leg1[0].marketUsd, steamUsd: deskBasket.leg1[0].steamUsd },
        leg2: { name: deskBasket.leg2[0].name, steamUsd: deskBasket.leg2[0].steamUsd, marketUsd: deskBasket.leg2[0].marketUsd }
      });
      globalThis.window = { location: { hostname: 'spread.haking.tr', origin: 'https://spread.haking.tr' } };
      const sharedBasketUrl = buildShareUrl(savedSettings);
      const parsedBasket = parseSharedSetupFromUrl(sharedBasketUrl.slice(sharedBasketUrl.indexOf('?')));
      delete globalThis.window;

      const deskMatchOk =
        Math.abs(deskMetrics.firstCycle.netProfit - split1x3.plan.netProfitUsd) < 1.0 &&
        savedSettings.activeBasket?.leg2?.length === 3 &&
        parsedBasket?.activeBasket?.leg2?.length === 3 &&
        parsedBasket.activeBasket.leg1[0].qty === deskBasket.leg1[0].qty;

      if (deskMatchOk) {
        pass(
          `SPREAD Agent V6.1 Multi-Item Basket Desk, Vault & Share URL verified: $800 Auto (${autoBasket800.plan.k1}→${autoBasket800.plan.k2}, +$${autoBasket800.plan.netProfitUsd.toFixed(2)}, PoP ${autoBasket800.plan.risk.popPct}%) | Desk 1→3 (+$${deskMetrics.firstCycle.netProfit.toFixed(2)}, 3 exits persisted & URL-shareable).`
        );
      } else {
        fail(`SPREAD Agent V6.1 Desk/Vault/URL roundtrip failed: deskProfit=${deskMetrics.firstCycle.netProfit}, planProfit=${split1x3.plan.netProfitUsd}, vaultL2=${savedSettings.activeBasket?.leg2?.length}, urlL2=${parsedBasket?.activeBasket?.leg2?.length}`);
      }
    } else {
      fail(`SPREAD Agent V6 Basket Optimizer failed: autoOk=${autoOk}, split1x3Ok=${split1x3Ok}`);
    }

    // 5b-V7 & V10. Full Doppler & Gamma Doppler Phase Library, Monte Carlo, Auto-Rebalancer (3->2) & Owned-Skin Optimizer
    const findItem = (name) => mergedSample.find((x) => x.n.toLowerCase() === String(name).toLowerCase()) || null;
      const karaPhases = ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Ruby', 'Sapphire', 'Black Pearl'].map((ph) =>
        findItem(`★ Karambit | Doppler (Factory New) - ${ph}`)
      );
      const karaEmerald = findItem('★ Karambit | Gamma Doppler (Factory New) - Emerald');
      const all7KaraOk =
        karaPhases.every((x) => x && x.cf > 400 && x.def === 507 && x.pi > 400 && x.nid > 0 && x.img) &&
        karaEmerald &&
        karaEmerald.cf > 2000 &&
        karaEmerald.isGem === 1 &&
        karaPhases[4].cf > karaPhases[0].cf * 3 && // Ruby >> Phase 1!
        karaPhases[4].s === karaPhases[0].s; // Shared Steam base floor (Ruby must NEVER inflate Steam est!)
      const totalDopplerItems = mergedSample.filter((x) => Boolean(x.ph)).length;
      const karambitDoppler = karaPhases[0];
      // Verify Leg 2 Guard: NO Ruby/Sapphire/Emerald/Black Pearl/Phase 2 gem overpay ever appears in Leg 2 recommendations!
      const noGemInLeg2 =
        adv800.strategies.every((st) => !st.pair?.leg2?.item?.isGem && !st.pair?.leg2?.item?.phPrem) &&
        (!split1x3?.plan || split1x3.plan.leg2Lines.every((l) => !l.item.isGem && !l.item.phPrem));
      if (all7KaraOk && totalDopplerItems >= 300 && noGemInLeg2) {
        pass(
            `V10.0 Full Doppler Phase Library verified: ${totalDopplerItems} phases | Karambit P1=$${karaPhases[0].cf}, P2=$${karaPhases[1].cf}, Sapphire=$${karaPhases[5].cf}, Ruby=$${karaPhases[4].cf}, Emerald=$${karaEmerald.cf} | Leg-2 Gem Guard OK.`
        );
      } else {
        fail(`V10.0 Doppler Phase check failed: total=${totalDopplerItems}, all7KaraOk=${all7KaraOk}, noGemInLeg2=${noGemInLeg2}`);
      }

      if (split1x3?.plan) {
        const mc = runMonteCarloSimulation({
          leg1Lines: split1x3.plan.leg1Lines,
          leg2Lines: split1x3.plan.leg2Lines,
          expectedProfitUsd: split1x3.plan.slippageAdjProfitUsd,
          capitalUsd: 800,
          instantFloorProfitUsd: split1x3.plan.instantFloorProfitUsd
        });
        const mcOk =
          mc.trials === 500 &&
          mc.popPct >= 50 &&
          mc.popPct <= 100 &&
          Number.isFinite(mc.evProfitUsd) &&
          Number.isFinite(mc.cvar5ProfitUsd) &&
          ['A+', 'A', 'B+', 'B', 'C'].includes(mc.riskGrade);
        if (mcOk) {
          pass(
            `V7 500-Trial Fat-Tail Monte Carlo verified: Grade ${mc.riskGrade} | PoP ${mc.popPct}% | EV +$${mc.evProfitUsd} | CVaR 5% $${mc.cvar5ProfitUsd} | Kelly ${mc.kellyPct}%.`
          );
        } else {
          fail(`V7 Monte Carlo returned invalid stats: ${JSON.stringify(mc)}`);
        }

        // Test 3 -> 2 Auto-Rebalance on Leg 2
        const l1Desk = split1x3.plan.leg1Lines.map((l) => ({ name: l.item.n, qty: l.qty, marketUsd: l.unitBuyUsd, steamUsd: l.unitSteamUsd }));
        const l2Desk3 = split1x3.plan.leg2Lines.map((l) => ({ name: l.item.n, qty: l.qty, steamUsd: l.unitSteamUsd, marketUsd: l.unitSellUsd }));
        const l2AfterDrop = l2Desk3.slice(0, 2);
        const qtyBeforeRebal = l2AfterDrop.reduce((a, x) => a + x.qty, 0);
        const l2Rebalanced = rebalanceBasketLeg(l1Desk, l2AfterDrop, 2, 800, opts800, findItem);
        const qtyAfterRebal = l2Rebalanced.reduce((a, x) => a + x.qty, 0);
        const rebalMetrics = computeBasketLoopMetrics({
          capitalUsd: 800,
          leg1Lines: l1Desk,
          leg2Lines: l2Rebalanced,
          buyFeePct: 0,
          sellFeePct: 2,
          withdrawFeePct: 0,
          steamFeeMode: 'EXACT_VALVE'
        });
        const steamUtilPct =
          rebalMetrics.basketDetail.totalSteamEarned1 > 0
            ? (rebalMetrics.basketDetail.totalSteamSpent2 / rebalMetrics.basketDetail.totalSteamEarned1) * 100
            : 0;
        if (qtyAfterRebal > qtyBeforeRebal && steamUtilPct >= 93 && rebalMetrics.basketDetail.overSteamUsd <= 0.01) {
          pass(
            `V7 Auto-Rebalancer (3→2 Leg 2) verified: units lifted ${qtyBeforeRebal} → ${qtyAfterRebal} | Steam util ${steamUtilPct.toFixed(1)}% | Profit +$${rebalMetrics.firstCycle.netProfit.toFixed(2)}.`
          );
        } else {
          fail(`V7 Auto-Rebalancer failed: before=${qtyBeforeRebal}, after=${qtyAfterRebal}, steamUtil=${steamUtilPct.toFixed(1)}%, overSteam=${rebalMetrics.basketDetail.overSteamUsd}`);
        }
      }

      // Test Owned / Custom Leg 1 Arbitrage Optimizer on Karambit Doppler FN
      const ownedRes = optimizeArbitrageForOwnedLeg1(
        mergedSample,
        [
          {
            name: '★ Karambit | Doppler (Factory New)',
            qty: 1,
            marketUsd: karambitDoppler?.cf || 843.26,
            steamUsd: karambitDoppler?.s || 1219.69
          }
        ],
        opts800,
        850,
        findItem
      );
      if (ownedRes && ownedRes.options.length >= 2 && ownedRes.options[0].mc?.popPct > 0) {
        const top = ownedRes.options[0];
        pass(
          `V7 Owned-Skin Arbitrage Optimizer verified: 1x Karambit Doppler FN → ${ownedRes.options.length} plans | Best=${top.plan.k2} exits (+$${top.plan.netProfitUsd.toFixed(2)}, Grade ${top.mc.riskGrade}, vsDirect ${top.extraVsDirectUsd >= 0 ? '+' : ''}$${top.extraVsDirectUsd.toFixed(2)}).`
        );
      } else {
        fail(`V7 Owned-Skin Arbitrage Optimizer failed: ${JSON.stringify(ownedRes).slice(0, 180)}`);
      }

      // 5b-V7.1 & V8.0. Directional Leg-1 (Steam) vs Leg-2 (CSFloat/Youpin898) Telemetry + Steam Histogram & Direct Youpin IDs
      const asiimovMw = findItem('AK-47 | Asiimov (Minimal Wear)');
      const m9Vanilla = findItem('★ M9 Bayonet');
      const ypLiveOk = asiimovMw && asiimovMw.yp > 25 && asiimovMw.yp < 48 && asiimovMw.ypo > 25 && asiimovMw.ypo <= asiimovMw.yp;
      const idsOk = m9Vanilla && Number(m9Vanilla.nid) > 0 && Number(m9Vanilla.ypId) > 0;
      const synthMixed = { ...asiimovMw, cf24: 99, cf7: 500, cf30: 2000, st24: 18, st24Checked: true, stBuyOrd: 51.2, stSellCnt: 24 };
      const leg1SteamVel = computeVelocityProfile(synthMixed, 'CSFLOAT', 1);
      const leg1ZeroVel = computeVelocityProfile({ ...m9Vanilla, st24: 0, st24Checked: true, stBuyOrd: 717, stSellCnt: 7 }, 'CSFLOAT', 1);
      const leg2CfVel = computeVelocityProfile(synthMixed, 'CSFLOAT', 2);
      const leg2YpVel = computeVelocityProfile(synthMixed, 'YOUPIN', 2);
      const dirOk =
        (leg1SteamVel.volSource === 'STEAM_LIVE' || leg1SteamVel.volSource === 'STEAM_HISTORY') &&
        !/CSFloat/i.test(leg1SteamVel.volText) &&
        /Steam (24h|7d)/i.test(leg1SteamVel.volText) &&
        leg1ZeroVel.tier === 'C' &&
        /0/.test(leg1ZeroVel.volText) &&
        leg2CfVel.volSource === 'CSFLOAT' &&
        /CSFloat/i.test(leg2CfVel.volText) &&
        !/CSFloat/i.test(leg2YpVel.volText) &&
        leg2YpVel.bidAskPct > 90;
      const ypOpts = { marketplace: 'YOUPIN', buyFeePct: 0, sellFeePct: 1, withdrawFeePct: 0, steamFeeMode: 'EXACT_VALVE', conservativeSteamPrice: true };
      const ypAdv = analyzeCapitalStrategies(mergedSample, ypOpts, 800);
      const ypBasket = optimizeMultiItemBasket(mergedSample, ypOpts, 800, { buyCount: 0, sellCount: 0 });
      if (ypLiveOk && idsOk && dirOk && ypAdv.strategies.length >= 2 && ypBasket?.plan) {
        pass(
          `V8.0 Directional Engine & Youpin898 Order Book verified: M9 nid=${m9Vanilla.nid} ypId=${m9Vanilla.ypId} | Leg1="${leg1SteamVel.volText}" | Leg1(0-sale)="${leg1ZeroVel.volText}" (${leg1ZeroVel.tier}) | Leg2(YP)="${leg2YpVel.volText}" | YP $800 Basket +$${ypBasket.plan.netProfitUsd.toFixed(2)}.`
        );
      } else {
        fail(`V8.0 directional check failed: ypLiveOk=${ypLiveOk}, idsOk=${idsOk}, dirOk=${dirOk}, l1=${leg1SteamVel.volText}, l1z=${leg1ZeroVel.volText}/${leg1ZeroVel.tier}, l2yp=${leg2YpVel.volText}`);
      }

      // 5b-V9.0. Head-to-Head Single vs Basket Meta-Arbitrator (PREFER_SINGLE, PREFER_BASKET & Anti-Congestion Guard)
      const adv900 = analyzeCapitalStrategies(mergedSample, opts800, 900);
      const ap900 = adv900.agentBrief?.pair;
      const liveFastSingle = ap900
        ? {
          ...ap900,
          leg1: { ...ap900.leg1, item: { ...ap900.leg1.item, st24: 6, st24Checked: true }, vel: { ...ap900.leg1.vel, tier: 'B', estDailySales: 6 } },
          leg2: { ...ap900.leg2, item: { ...ap900.leg2.item, cfLive: true, cf24: 22, cf7: 139 }, vel: { ...ap900.leg2.vel, tier: 'A', sold7d: 139, estDailySales: 20 } },
          c1: { ...ap900.c1, q1: 6, q2: 24, netProfit: 405.04 },
          reality: { minDays: 15, maxDays: 17 }
        }
        : null;
      const weakerBasket900 = {
        plan: {
          k1: 2, k2: 2, netProfitUsd: 347.47, instantFloorProfitUsd: 302.06,
          minDays: 14, maxDays: 15, idleCashUsd: 16.12, risk: { sigma14dPct: 9.3, popPct: 99.9 }
        }
      };
      const vPreferSingle = evaluateModeArbitration(
        liveFastSingle,
        weakerBasket900,
        { evProfitUsd: 400.86, cvar5ProfitUsd: 241.45, sigma14dPct: 11.5 },
        { evProfitUsd: 337.52, cvar5ProfitUsd: 176.06, sigma14dPct: 9.3 },
        900,
        opts800
      );

      // Scenario B: $200 Single leaving idle cash (+$67.51) vs Basket deploying full budget (+$82.10) -> MUST recommend PREFER_BASKET!
      const adv200 = analyzeCapitalStrategies(mergedSample, opts800, 200);
      const ap200Base = adv200.agentBrief?.pair;
      const idleSingle200 = ap200Base
        ? {
          ...ap200Base,
          c1: { ...ap200Base.c1, q1: 1, q2: 6, netProfit: 67.51, cashLeftAfterLeg1: 48.0 },
          instantFloorProfit: 52.0,
          reality: { minDays: 15, maxDays: 17 }
        }
        : null;
      const strongerBasket200 = {
        plan: {
          k1: 2, k2: 2, netProfitUsd: 82.1, instantFloorProfitUsd: 68.4,
          minDays: 14, maxDays: 15, idleCashUsd: 4.5, risk: { sigma14dPct: 8.4, popPct: 99.8 }
        }
      };
      const vPreferBasket = evaluateModeArbitration(
        idleSingle200,
        strongerBasket200,
        { evProfitUsd: 66.2, cvar5ProfitUsd: 22, sigma14dPct: 10.5 },
        { evProfitUsd: 81.0, cvar5ProfitUsd: 36, sigma14dPct: 8.4 },
        200,
        opts800
      );

      // Scenario C: High profit gap (+$58) BUT slow congested exit (32x on 12/wk skin) -> MUST NOT recommend PREFER_SINGLE!
      const congestedSingle = liveFastSingle
        ? {
          ...liveFastSingle,
          leg2: { ...liveFastSingle.leg2, item: { ...liveFastSingle.leg2.item, cfLive: true, cf24: 1, cf7: 12 }, vel: { ...liveFastSingle.leg2.vel, tier: 'B', sold7d: 12, estDailySales: 1.7 } },
          c1: { ...liveFastSingle.c1, q2: 32 }
        }
        : null;
      const vCongested = evaluateModeArbitration(
        congestedSingle,
        weakerBasket900,
        { evProfitUsd: 400, cvar5ProfitUsd: 240, sigma14dPct: 11.5 },
        { evProfitUsd: 340, cvar5ProfitUsd: 180, sigma14dPct: 9.3 },
        900,
        opts800
      );

      if (
        vPreferSingle.verdict === 'PREFER_SINGLE' &&
        vPreferSingle.basketBanner?.targetSplitMode === false &&
        vPreferSingle.togglePillCls === 'is-single' &&
        vPreferBasket.verdict === 'PREFER_BASKET' &&
        vPreferBasket.singleBanner?.targetSplitMode === true &&
        vPreferBasket.togglePillCls === 'is-basket' &&
        vCongested.verdict !== 'PREFER_SINGLE'
      ) {
        pass(
          `V9.0 Meta-Arbitrator verified: $900 Fast Single (139/wk) -> ${vPreferSingle.verdict} (+$${vPreferSingle.profitGapUsd}) | $200 Idle-Cash -> ${vPreferBasket.verdict} (+$${Math.abs(vPreferBasket.profitGapUsd)}) | Slow 32x Guard -> ${vCongested.verdict}.`
        );
      } else {
        fail(
          `V9.0 Meta-Arbitrator failed: single=${vPreferSingle.verdict}, basket=${vPreferBasket.verdict}, congested=${vCongested.verdict}`
        );
      }
    }

    // 5b-V11. Real Steam 7d/30d Sales History & Realistic Clearing-Price Engine Verification
    {
      const synthM9 = {
        n: '★ M9 Bayonet',
        c: 'Knives',
        s: 880,
        s7: 880,
        s30: 840,
        cf: 490,
        cfo: 455,
        q: 71,
        v7: 7,
        v30: 24,
        mv: 25,
        stHist: 1,
        st24: 0,
        st24Checked: 1,
        st7: 3,
        st30: 19,
        stLast: 811.22,
        stLastH: 38,
        stAvg7: 841.44,
        stAvg30: 815.6,
        stReal: 821.8,
        stSellOrd: 880,
        stBuyOrd: 717
      };
      const m9Vel = computeVelocityProfile(synthM9, 'CSFLOAT', 1);
      const m9Eval = evaluateItemMetrics(synthM9, {
        marketplace: 'CSFLOAT',
        buyFeePct: 0,
        sellFeePct: 2,
        withdrawFeePct: 0,
        steamFeeMode: 'EXACT_VALVE',
        conservativeSteamPrice: true
      });
      const snapM9 = mergedSample.find((x) => x.n === '★ M9 Bayonet');
      const snapHistCount = mergedSample.filter((x) => x.stHist).length;
      if (
        m9Vel.volSource === 'STEAM_HISTORY' &&
        m9Vel.sold7d === 3 &&
        m9Vel.tier === 'C' &&
        m9Vel.askOverSalePct >= 6 &&
        m9Eval.hasRealSteamSales &&
        Math.abs(m9Eval.steamSellUsd - 821.8) < 0.01 &&
        m9Eval.steamSellUsd < m9Eval.steamAskUsd &&
        snapHistCount >= 15 &&
        snapM9?.stHist &&
        snapM9.stReal > 500
      ) {
        pass(
          `V11.0 Real Steam Clearing-Price Engine verified: M9 Bayonet real 7d=${snapM9.st7} (30d=${snapM9.st30}), last=$${snapM9.stLast}, realistic=$${snapM9.stReal} vs Ask=$${snapM9.stSellOrd || snapM9.s} | Tier=${m9Vel.tier} | ${snapHistCount} snapshot skins enriched.`
        );
      } else {
        fail(
          `V11.0 Clearing-Price check failed: src=${m9Vel.volSource}, tier=${m9Vel.tier}, sell=${m9Eval.steamSellUsd}, snapHist=${snapHistCount}, snapM9=${JSON.stringify(snapM9 ? { stHist: snapM9.stHist, st7: snapM9.st7, stReal: snapM9.stReal } : null)}`
        );
      }
    }

    // 5c. Runtime View Render Test (DOM Shim — catches TDZ, ReferenceError, empty scanner table in BOTH EN & TR!)
    {
      const idMap = new Map();
      const makeFakeNode = (tag = 'div', id = '') => {
        const node = {
          tagName: tag.toUpperCase(),
          id,
          className: '',
          value: '',
          checked: false,
          disabled: false,
          textContent: '',
          dataset: {},
          style: { setProperty() { } },
          children: [],
          get firstChild() { return this.children[0] || null; },
          classList: { toggle() { }, add() { }, remove() { } },
          appendChild(ch) { this.children.push(ch); return ch; },
          removeChild(ch) {
            const i = this.children.indexOf(ch);
            if (i >= 0) this.children.splice(i, 1);
            return ch;
          },
          setAttribute(k, v) { if (k === 'id') this.id = v; },
          getAttribute() { return ''; },
          addEventListener() { },
          querySelector() { return null; },
          querySelectorAll() { return []; },
          getBoundingClientRect() { return { width: 400, height: 220, left: 0, top: 0 }; },
          getContext() {
            return {
              setTransform() { }, clearRect() { }, beginPath() { }, moveTo() { }, lineTo() { },
              stroke() { }, fill() { }, closePath() { }, arc() { }, fillText() { }, save() { },
              restore() { }, setLineDash() { }, roundRect() { },
              createLinearGradient() { return { addColorStop() { } }; }
            };
          }
        };
        if (id) idMap.set(id, node);
        return node;
      };

      for (const id of htmlIds) makeFakeNode('div', id);
      globalThis.Node = class FakeNode { };
      globalThis.requestAnimationFrame = (cb) => cb();
      globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#f0b90b' });
      globalThis.window = {
        devicePixelRatio: 1,
        innerWidth: 1280,
        innerHeight: 800,
        location: { pathname: '/', search: '', hostname: 'spread.haking.tr', origin: 'https://spread.haking.tr' },
        history: { replaceState() { }, pushState() { } },
        addEventListener() { },
        scrollTo() { }
      };
      globalThis.document = {
        documentElement: { setAttribute() { }, getAttribute: () => 'dark', style: {} },
        body: makeFakeNode('body'),
        title: '',
        createElement: (tag) => {
          const n = makeFakeNode(tag);
          Object.setPrototypeOf(n, globalThis.Node.prototype);
          return n;
        },
        createTextNode: (txt) => {
          const n = { textContent: String(txt) };
          Object.setPrototypeOf(n, globalThis.Node.prototype);
          return n;
        },
        getElementById: (id) => idMap.get(id) || null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() { }
      };

      const { renderLiveTicker } = await import('../public/js/views/header-ticker.js');
      const { initScannerView } = await import('../public/js/views/scanner-view.js');
      const { initCalculatorView } = await import('../public/js/views/calculator-view.js');
      const { initTrackerView } = await import('../public/js/views/tracker-view.js');
      const { initAcademyView } = await import('../public/js/views/academy-view.js');
      const { initAboutView } = await import('../public/js/views/about-view.js');
      const { initInteractiveTour } = await import('../public/js/views/tour-guide.js');

      const mockApp = {
        activeTab: 'scanner',
        items: mergedSample,
        cycles: [],
        watchlist: [],
        customItems: [],
        market: {
          sourceMode: 'live-edge',
          updatedAt: new Date().toISOString(),
          fxRates: { USD: 1, TRY: 50.67, CNY: 6.68, EUR: 0.91 },
          feeds: { csfloatLive: true, buff163: true, steam: true, youpin: true },
          verifySteamLive: async () => ({})
        },
        settings: {
          marketplace: 'CSFLOAT', currency: 'USD', buyFeePct: 0, sellFeePct: 2, withdrawFeePct: 0,
          steamFeeMode: 'EXACT_VALVE', steamCustomFeePct: 13.04, useBuyOrderForLeg2: false,
          conservativeSteamPrice: true, capitalUsd: 200, compoundMode: 'REALISTIC',
          leg1: { name: 'Revolution Case', marketUsd: 0.5, steamUsd: 0.78 },
          leg2: { name: 'AK-47 | Redline (Field-Tested)', steamUsd: 22, marketUsd: 20.1 }
        },
        findItemByName: (n) => mergedSample.find((x) => x.n.toLowerCase() === String(n).toLowerCase()) || null,
        switchTab() { }, saveSettings() { }, saveCycles() { }, toast() { }, openCommandPalette() { }, applyItemToLeg() { }, applyPair() { }, toggleWatchlist() { }
      };

      const scannerView = initScannerView(mockApp);
      const calcView = initCalculatorView(mockApp);
      const trackerView = initTrackerView(mockApp);
      const academyView = initAcademyView();
      const aboutView = initAboutView(mockApp);
      const tour = initInteractiveTour(mockApp);

      let runtimeOk = true;
      for (const lang of ['en', 'tr']) {
        setLang(lang, false);
        try {
          renderLiveTicker(mockApp);
          calcView.render();
          scannerView.render();
          trackerView.render();
          academyView.render();
          aboutView.render();
          tour.start();
          const tourCount = tour.getStepCount();
          for (let ti = 0; ti < tourCount; ti++) {
            tour.goToStep(ti);
          }
          tour.stop(false);
          const scannerRows = idMap.get('scannerTableBody')?.children?.length || 0;
          const tickerChips = idMap.get('tickerTrack')?.children?.length || 0;
          const stratCards = idMap.get('advisorStrategiesGrid')?.children?.length || 0;
          const agentNode = idMap.get('spreadAgentCard');
          const agentChildren = agentNode?.children?.length || 0;
          const countImgs = (n) => (!n ? 0 : (n.tagName === 'IMG' ? 1 : 0) + (n.children || []).reduce((a, c) => a + countImgs(c), 0));
          const agentImgs = countImgs(agentNode);
          const modePillTxt = idMap.get('splitModeAgentPill')?.textContent || '';
          if (scannerRows < 20 || tickerChips < 4 || stratCards < 2 || agentChildren < 3 || agentImgs < 2 || !modePillTxt || tourCount < 8) {
            fail(`Runtime render [${lang}] insufficient DOM nodes: scannerRows=${scannerRows}, tickerChips=${tickerChips}, stratCards=${stratCards}, agent=${agentChildren}, agentImgs=${agentImgs}, modePill="${modePillTxt}", tourSteps=${tourCount}`);
            runtimeOk = false;
          }
        } catch (err) {
          fail(`Runtime view render crashed in [${lang}]: ${err.stack || err.message}`);
          runtimeOk = false;
        }
      }
      setLang('en', false);
      const buffCount = mergedSample.filter((x) => (x.b || 0) > 0).length;
      if (runtimeOk && buffCount > 2000 && indexHtml.includes('name="color-scheme" content="dark"')) {
        const rowsCount = idMap.get('scannerTableBody')?.children?.length || 0;
        const tickerCount = idMap.get('tickerTrack')?.children?.length || 0;
        pass(
          `Runtime DOM render & SPREAD Agent V4 audit (EN & TR) passed: Scanner ${rowsCount} rows, Ticker ${tickerCount} chips, Buff163 ${buffCount} items, Tour OK, Dark-Default OK.`
        );
      } else if (runtimeOk) {
        fail(`V4 check failed: buffCount=${buffCount}`);
      }
    }

    if (process.argv.includes('--live')) {
      console.log('\nRunning live local server + /api/market & /api/fx smoke test...');
      const port = '4189';
      const proc = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
        env: { ...process.env, PORT: port, HOST: '127.0.0.1' },
        stdio: 'pipe'
      });

      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Server startup timeout')), 6000);
          proc.stdout.on('data', (chunk) => {
            if (String(chunk).includes(port)) {
              clearTimeout(timer);
              resolve();
            }
          });
          proc.on('exit', (code) => {
            clearTimeout(timer);
            reject(new Error(`Server exited early with code ${code}`));
          });
        });

        const endpoints = [
          ['/', 200],
          ['/scanner', 200],
          ['/tarayici', 200],
          ['/tracker', 200],
          ['/takip', 200],
          ['/academy', 200],
          ['/akademi', 200],
          ['/about', 200],
          ['/hakkinda', 200],
          ['/css/advisor.css', 200],
          ['/css/mobile.css', 200],
          ['/js/main.js', 200],
          ['/assets/brand/logo-192.png', 200],
          ['/assets/brand/banner.jpg', 200],
          ['/data/catalog.json', 200],
          ['/api/fx', 200],
          ['/api/market', 200],
          ['/api/item-lookup?q=karambit%20doppler%20fn', 200],
          ['/api/steam-verify?mkt=CSFLOAT&name=Desert%20Eagle%20%7C%20Conspiracy%20(Factory%20New)&nid=175975101&name=%E2%98%85%20M9%20Bayonet&nid=1285128', 200],
          ['/api/steam-verify?mkt=YOUPIN&name=AK-47%20%7C%20Asiimov%20(Minimal%20Wear)&nid=176024735', 200],
          ['/server.mjs', 403],
          ['/scripts/sync-catalog.mjs', 403]
        ];

        for (const [ep, expected] of endpoints) {
          const res = await fetch(`http://127.0.0.1:${port}${ep}`);
          if (res.status !== expected) {
            fail(`${ep} returned HTTP ${res.status}, expected ${expected}`);
            continue;
          }
          if (ep === '/') {
            const csp = res.headers.get('content-security-policy') || '';
            const xfo = res.headers.get('x-frame-options') || '';
            if (!csp.includes("script-src 'self'") || xfo !== 'DENY') {
              fail(`Security headers missing on /: CSP="${csp}" XFO="${xfo}"`);
              continue;
            }
          }
          if (ep === '/api/market') {
            const j = await res.json();
            if (j.ok && j.count >= 1000) {
              pass(`Live /api/market -> ${j.count} items | feeds=${JSON.stringify(j.feeds)}`);
            } else {
              fail(`Live /api/market invalid payload: ${JSON.stringify(j).slice(0, 140)}`);
            }
          } else if (ep === '/api/fx') {
            const j = await res.json();
            if (j.ok && j.rates?.TRY > 1 && j.rates?.CNY > 1) {
              pass(`Live /api/fx -> 1 USD = ${j.rates.TRY} TRY | ${j.rates.CNY} CNY | ${j.rates.EUR} EUR`);
            } else {
              fail('Live /api/fx invalid payload');
            }
          } else if (ep.startsWith('/api/item-lookup')) {
            const j = await res.json();
              const hitP1 = (j.items || []).find((x) => x.n === '★ Karambit | Doppler (Factory New) - Phase 1');
              const hitRuby = (j.items || []).find((x) => x.n === '★ Karambit | Doppler (Factory New) - Ruby');
              if (j.ok && hitP1 && hitP1.cf > 400 && hitRuby && hitRuby.cf > hitP1.cf * 3) {
                pass(`Live /api/item-lookup -> found ${j.items.length} phase matches incl. P1 ($${hitP1.cf}) & Ruby ($${hitRuby.cf}).`);
              } else {
                fail(`Live /api/item-lookup missed Karambit Doppler FN phases: ${JSON.stringify(j).slice(0, 220)}`);
              }
            } else if (ep.startsWith('/api/steam-verify?mkt=YOUPIN')) {
              const j = await res.json();
              const rec = j.items?.['AK-47 | Asiimov (Minimal Wear)'];
              if (j.ok && (!rec || rec.csfloat === null)) {
                pass(`Live /api/steam-verify (YOUPIN mode) -> Steam 24h:${rec?.volume24h || 'n/a'} | csfloat=null (100% isolated).`);
              } else {
                fail(`Live /api/steam-verify (YOUPIN mode) leaked CSFloat data: ${JSON.stringify(j).slice(0, 180)}`);
              }
            } else if (ep.startsWith('/api/steam-verify')) {
              const j = await res.json();
              const rec = j.items?.['Desert Eagle | Conspiracy (Factory New)'];
              const m9Rec = j.items?.['★ M9 Bayonet'];
              if (
                j.ok &&
                rec?.csfloat?.live &&
                rec.csfloat.sold7d >= 20 &&
                m9Rec?.steamBuyOrderUsd > 300 &&
                m9Rec?.histLive &&
                m9Rec.sold7d >= 1 &&
                m9Rec.lastSaleUsd > 400 &&
                m9Rec.realisticSellUsd > 400 &&
                Array.isArray(m9Rec.recentSales) &&
                m9Rec.recentSales.length >= 1
              ) {
                pass(
                  `Live /api/steam-verify (V11 CSFLOAT+SteamHistory+Histogram) -> Deagle CF 24h:${rec.csfloat.sold24h}, 7d:${rec.csfloat.sold7d} | M9 Steam 7d:${m9Rec.sold7d}, 30d:${m9Rec.sold30d}, last:$${m9Rec.lastSaleUsd}, realistic:$${m9Rec.realisticSellUsd}, Ask:$${m9Rec.steamSellOrderUsd || m9Rec.lowestUsd}, BuyOrd:$${m9Rec.steamBuyOrderUsd}`
                );
              } else {
                fail(`Live /api/steam-verify missing V11 Steam history or CSFloat sales: ${JSON.stringify(j).slice(0, 320)}`);
              }
            } else {
              pass(`HTTP ${res.status} ${ep}`);
            }
          }
        } finally {
          proc.kill();
        }
      }

  if (failures > 0) {
        console.error(`\nVerification FAILED with ${failures} error(s).\n`);
        process.exit(1);
      }
      console.log('\nAll SPREAD verification checks PASSED.\n');
    }

    main().catch((err) => {
      console.error(err);
      process.exit(1);
    });
