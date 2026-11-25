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
  estimateExecutionReality,
  findBestExitsForLeg1
} from '../public/js/core/math-engine.js';
import { optimizeMultiItemBasket } from '../public/js/core/basket-optimizer.js';
import { DICT, setLang, t } from '../public/js/core/i18n.js';
import { parseSharedSetupFromUrl } from '../public/js/core/router-share.js';

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
        pS1Usd: top800.leg1.m.steamUsd,
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
          pS1Usd: top800.leg1.m.steamUsd
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
      pass(
        `SPREAD Agent V6 Multi-Item Basket Optimizer verified: $800 Auto (${autoBasket800.plan.k1}→${autoBasket800.plan.k2}, +$${autoBasket800.plan.netProfitUsd.toFixed(2)}, PoP ${autoBasket800.plan.risk.popPct}%, ${autoBasket800.plan.deployedCashPct}% deployed) | 1→3 Split (+$${split1x3.plan.netProfitUsd.toFixed(2)}, σ ${split1x3.plan.risk.sigma14dPct}% < ${split1x3.baseline11.risk.sigma14dPct}%).`
      );
    } else {
      fail(`SPREAD Agent V6 Basket Optimizer failed: autoOk=${autoOk}, split1x3Ok=${split1x3Ok}`);
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
        style: { setProperty() {} },
        children: [],
        get firstChild() { return this.children[0] || null; },
        classList: { toggle() {}, add() {}, remove() {} },
        appendChild(ch) { this.children.push(ch); return ch; },
        removeChild(ch) {
          const i = this.children.indexOf(ch);
          if (i >= 0) this.children.splice(i, 1);
          return ch;
        },
        setAttribute(k, v) { if (k === 'id') this.id = v; },
        getAttribute() { return ''; },
        addEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getBoundingClientRect() { return { width: 400, height: 220, left: 0, top: 0 }; },
        getContext() {
          return {
            setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
            stroke() {}, fill() {}, closePath() {}, arc() {}, fillText() {}, save() {},
            restore() {}, setLineDash() {}, roundRect() {},
            createLinearGradient() { return { addColorStop() {} }; }
          };
        }
      };
      if (id) idMap.set(id, node);
      return node;
    };

    for (const id of htmlIds) makeFakeNode('div', id);
    globalThis.Node = class FakeNode {};
    globalThis.requestAnimationFrame = (cb) => cb();
    globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#f0b90b' });
    globalThis.window = {
      devicePixelRatio: 1,
      innerWidth: 1280,
      innerHeight: 800,
      location: { pathname: '/', search: '', hostname: 'spread.haking.tr', origin: 'https://spread.haking.tr' },
      history: { replaceState() {}, pushState() {} },
      addEventListener() {},
      scrollTo() {}
    };
    globalThis.document = {
      documentElement: { setAttribute() {}, getAttribute: () => 'dark', style: {} },
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
      addEventListener() {}
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
      switchTab() {}, saveSettings() {}, saveCycles() {}, toast() {}, openCommandPalette() {}, applyItemToLeg() {}, applyPair() {}, toggleWatchlist() {}
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
        tour.stop(false);
        const scannerRows = idMap.get('scannerTableBody')?.children?.length || 0;
        const tickerChips = idMap.get('tickerTrack')?.children?.length || 0;
        const stratCards = idMap.get('advisorStrategiesGrid')?.children?.length || 0;
        const agentChildren = idMap.get('spreadAgentCard')?.children?.length || 0;
        if (scannerRows < 20 || tickerChips < 4 || stratCards < 2 || agentChildren < 2) {
          fail(`Runtime render [${lang}] insufficient DOM nodes: scannerRows=${scannerRows}, tickerChips=${tickerChips}, stratCards=${stratCards}, agent=${agentChildren}`);
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
        ['/js/main.js', 200],
        ['/assets/brand/logo-192.png', 200],
        ['/assets/brand/banner.jpg', 200],
        ['/data/catalog.json', 200],
        ['/api/fx', 200],
        ['/api/market', 200],
        ['/api/steam-verify?names=Revolution%20Case', 200],
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
