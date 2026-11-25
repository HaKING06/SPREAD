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
  estimateExecutionReality
} from '../public/js/core/math-engine.js';
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
  const inlineScriptRegex = /<script(?![^>]*\bsrc=)[^>]*>/i;
  if (inlineScriptRegex.test(indexHtml)) {
    fail('Inline <script> tag found in public/index.html (violates strict CSP script-src self)');
  } else {
    pass('Strict CSP audit: zero inline <script> tags in public/index.html.');
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
  if (adv.strategies.length >= 2 && adv.tier.id === 'STARTER') {
    pass(`Capital Strategy Advisor verified: ${adv.strategies.length} tailored strategies generated for $200 (${adv.tier.badge}).`);
  } else {
    fail(`Capital Strategy Advisor returned insufficient strategies: ${adv.strategies.length}`);
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
        ['/tarayici', 200],
        ['/takip', 200],
        ['/akademi', 200],
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
