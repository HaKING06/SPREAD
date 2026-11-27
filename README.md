<div align="center">
  <img src="public/assets/brand/banner.jpg" alt="SPREAD — CS2 Arbitrage Calculator & Live Spread Terminal (spread.haking.tr)" width="100%" />

  <h1>SPREAD V11.2 — CS2 Arbitrage Terminal &amp; Quant Desk</h1>

  <p>
    <strong>Zero-login, open-source quantitative terminal</strong> for <strong>CSFloat &amp; Youpin898 ↔ Steam Community Market</strong> two-way CS2 arbitrage — powered by <strong>real Steam 7d/30d sales history</strong>, <strong>354+ Doppler &amp; Gamma Doppler phases</strong>, a <strong>Single vs. Basket Meta-Arbitrator</strong>, <strong>500-trial Monte Carlo CVaR</strong>, exact Valve cent math, and a 100% local SHA-256 browser vault.
  </p>

  <p>
    <a href="https://spread.haking.tr"><strong>Launch Live Terminal (spread.haking.tr)</strong></a> ·
    <a href="#why-spread-v11">Why SPREAD</a> ·
    <a href="#core-capabilities">Capabilities</a> ·
    <a href="#architecture--live-api">Architecture &amp; API</a> ·
    <a href="#quick-start-zero-dependencies">Quick Start</a> ·
    <a href="SECURITY.md">Security</a>
  </p>

  <p>
    <a href="https://spread.haking.tr"><img src="https://img.shields.io/badge/Live-spread.haking.tr-F0B90B?style=flat-square" alt="Live Terminal" /></a>
    <img src="https://img.shields.io/badge/Release-V11.2-10D981?style=flat-square" alt="SPREAD V11.2" />
    <img src="https://img.shields.io/badge/Catalog-6,000%2B%20Skins%20%7C%20354%20Doppler%20Phases-38BDF8?style=flat-square" alt="Catalog" />
    <img src="https://img.shields.io/badge/Global%20Lookup-20,000%2B%20Items-6366F1?style=flat-square" alt="Global Lookup" />
    <img src="https://img.shields.io/badge/Security-Zero%20Login%20%7C%20Strict%20CSP-10D981?style=flat-square" alt="Security" />
    <img src="https://img.shields.io/badge/i18n-EN%20%7C%20TR%20Auto-F59E0B?style=flat-square" alt="Bilingual EN/TR" />
    <img src="https://img.shields.io/badge/Edge-Cloudflare%20Workers-F38020?style=flat-square" alt="Cloudflare Workers" />
    <img src="https://img.shields.io/badge/License-MIT-A855F7?style=flat-square" alt="MIT License" />
  </p>
</div>

---

## Why SPREAD V11?

Naive CS2 arbitrage sheets compare a discounted CSFloat listing against the **lowest active Steam Ask** — ignoring whether anyone actually buys at that price, ignoring Valve's minimum cent fee traps, and ignoring how long 30 identical skins take to clear an order book.

**SPREAD** models the full **14-day two-way loop** (`7-day Valve Trade Protection × 2`) end-to-end:

```text
  [Cash on CSFloat / Youpin898]
         │
         ▼  STEP 1 (M₁ • Steam Balance Boost)
  Buy discounted liquid skins ──► Sell on Steam at REALISTIC clearing price (not phantom Ask)
         │                        Exact Valve cent solver + Real Steam 7d/30d sales tape
         ▼  STEP 2 (M₂ • Parallel Cashout)
  Buy low-loss liquid exits on Steam ──► Sell on CSFloat or Youpin898 (Ask or 0s Instant Bid)
         │
         ▼
  [Net Cash Profit when M₁ × M₂ > 1.0000]  +  Leftover Steam discounted by M₂ (Zero inflation!)
```

| Problem in Typical Spread Tables | How SPREAD V11.2 Solves It |
| :--- | :--- |
| **Phantom Lowest Steam Ask** (e.g. `\$880` Ask when last sales cleared at `\$811–\$856`) | Extracts **wear-matched real Steam 7d/30d transactions**, auto-prices Step 1 at **Realistic Clearing Value (`stReal`)**, and gives 1-click presets (`Realistic Sell`, `Last Sale`, `Lowest Ask`, `Instant Buy-Order`). |
| **Fake Cross-Market Volume** (showing P2P sales on Step 1 Steam sells or leaking CSFloat stats in Youpin mode) | **Directional Liquidity Physics**: Step 1 strictly tracks **Steam sales & Steam order-book histograms**; Step 2 strictly tracks the active cashout market (**CSFloat real sales graph** or **Youpin898 live Bid/Ask**). |
| **Missing Doppler / Gamma Doppler Phases** (all phases lumped into one broken price) | Full **354+ Phase Catalog** (`Phase 1–4`, `Ruby`, `Sapphire`, `Emerald`, `Black Pearl`) with phase icons, exact CSFloat/Youpin/Buff163 phase pricing, direct `def_index + paint_index` CSFloat deep-links, and Leg-2 Gem Overpay Guards. |
| **Guessing Single vs. Multi-Item Basket** | **Head-to-Head Meta-Arbitrator** evaluates both Single (`1→1`) and Multi-Item Basket (`1–3 → 1–4`) simultaneously across profit, 500-trial EV, CVaR 5% crash floor, and book absorption — telling you honestly when to split and when Single beats Basket. |
| **Account Phishing / API Key Risk** | **Zero Steam login, zero API keys, zero browser extensions, zero runtime npm deps, zero `innerHTML`**. 100% client-side `localStorage` vault with SHA-256 verified JSON backups. |

---

## Core Capabilities

### 1. Real Steam 7d/30d Sales History & Clearing-Price Engine (V11.2)
- Extracts **actual wear-matched Steam sales history** (`24h / 7d / 30d` sold volume, last actual sale price + live relative age, 7d weighted average, last 4 transactions) without requiring Steam login.
- **Self-Healing Monotonic Telemetry:** Prevents partial Edge responses from ever zeroing out verified snapshot history or contradicting the recent sales tape (`st24 ≥ tape24`, `st7 ≥ tape7`, `st30 ≥ tape30`).
- **Full-Width Step 1 Telemetry Deck:** Shows clickable recent Steam sales chips plus 4 one-click desk price presets (`✓ Realistic Sell`, `Last Sale`, `Lowest Ask (+%)`, `Steam Instant Buy-Order`).

### 2. Full Doppler & Gamma Doppler Phase Engine (354+ Phases)
- Splits every Doppler knife, Gamma Doppler knife, and `Glock-18 | Gamma Doppler` into exact **Phase 1–4, Ruby, Sapphire, Emerald, and Black Pearl** variants.
- Displays distinct phase-colored badges and icons, live phase-specific CSFloat / Youpin898 / Buff163 prices, direct `def_index` + `paint_index` CSFloat search links, and prevents recommending Gem phases on Step 2 where Steam does not pay phase overpay.

### 3. SPREAD Agent — Meta-Arbitrator, Parallel Baskets & Monte Carlo Risk
- **Multi-Item Parallel Basket Optimizer:** Distributes larger budgets (`\$300–\$10,000+`) across 2–4 parallel order books via Almgren-Chriss square-root slippage & queue-clearing optimization.
- **Auto-Rebalancing Trade Desk:** Load an entire multi-item basket onto the desk (`1–3` buys → `1–4` exits). Adding or removing a skin (`3 → 2`) automatically redistributes freed cash or Steam balance across the remaining items.
- **Head-to-Head Single vs. Basket Arbitrator:** Compares Single Mode vs. Basket Mode live and surfaces a 1-click verdict pill right next to the Split Mode toggle.
- **500-Trial Fat-Tail Correlated Monte Carlo:** Computes Profit Probability (`PoP %`), Expected Value (`EV`), Worst-5% Crash Floor (`CVaR 5%`), Half-Kelly allocation %, and instant Buy-Order downside floor.
- **Owned Skin Optimizer:** Put any skin you already own into Step 1 to compare Direct P2P Cashout vs. Steam Arbitrage exits side by side.

### 4. Exact Quantitative Finance & 14-Day Cycle Tracker
- **Exact Valve Cent Fee Solver:** Solves Steam's `\$0.01 Steam + \$0.01 CS2` minimum fee floor (catching up-to-`66.67%` low-price fee traps) alongside `÷ 1.15` and custom `%` modes.
- **M₂ Cash-Equivalent Valuation:** Discounts leftover Steam Wallet balance by `M₂` so Realistic ROI never inflates above Theoretical ROI.
- **20,000+ Global Live Lookup (`Ctrl+K`):** Searches 6,000 bundled skins instantly and queries the full 20,000+ CS2 market on demand via `/api/item-lookup` for rare knives, gloves, and Dopplers.
- **14-Day Trade-Hold Ledger:** Tracks single loops or full multi-item baskets through Day 0 → Day 7 Hold → Day 14 Cashout, with CSV export & SHA-256 signed JSON vault backup/restore.
- **Bilingual (`EN` Default + Auto `TR`):** Auto-detects Turkish browsers (`tr-*`), persists manual `EN | TR` switching, translates all tooltips & SEO routes (`/scanner` ↔ `/tarayici`, `/about` ↔ `/hakkinda`), and defaults to dark mode with optional light theme.

---

## Architecture & Live API

SPREAD runs as a **zero-dependency ES Module frontend** backed by a single **Cloudflare Worker** (`src/worker.js`) + static assets (`public/`), with a 1:1 local Node mirror (`server.mjs`).

```text
  7 Public Market Feeds (No User Auth / No API Keys)
  ├── CSFloat Price List + Order Book + Live Sales Graph
  ├── Steam Community Market (SSR 7d/30d History + Histogram + 24h Overview)
  ├── Youpin898 (41,000+ Live Ask + Highest Buy-Order + Direct templateId)
  ├── Buff163 Global Cash Anchor (incl. Doppler phase pricing)
  ├── Skinport 24h/7d/30d Sales History + Market.CSGO Cross-Market Volume
  ├── ByMykel/CSGO-API Official CS2 Skin / Case / Agent Metadata & Icons
  └── Open ER-API Live FX (USD / TRY / CNY / EUR)
         │
         ▼
  Cloudflare Worker (src/worker.js) — Edge Cached, Zero User Tracking
  ├── GET /api/market        5m Edge cache • 6,000-item matrix + pre-enriched Steam history
  ├── GET /api/steam-verify  15m Edge cache • Live Steam 7d/30d + Histogram + CSFloat graph
  ├── GET /api/item-lookup   On-demand 20,000+ global CS2 skin & Doppler phase lookup
  └── GET /api/fx            1h Edge cache • Live USD / TRY / CNY / EUR exchange rates
         │
         ▼
  Client-Side Quant Engine (100% Browser-Local)
  └── math-engine.js + basket-optimizer.js + Canvas 2D Charts + SHA-256 localStorage Vault
```

---

## Project Structure

```text
├── wrangler.toml                  # Cloudflare Workers + Static Assets config (name = "spread")
├── server.mjs                     # Zero-dependency local dev & live API proxy (1:1 parity with Worker)
├── src/
│   └── worker.js                  # Cloudflare Worker (/api/market, /api/steam-verify, /api/item-lookup, /api/fx)
├── public/                        # Static web bundle deployed to Cloudflare Edge
│   ├── index.html                 # Strict-CSP EN/TR SEO shell + JSON-LD + hreflang
│   ├── _headers                   # Hardened security headers (CSP, HSTS, X-Frame-Options: DENY)
│   ├── _redirects                 # Bilingual clean SPA routes (/scanner, /tarayici, /about, /hakkinda...)
│   ├── sitemap.xml                # Multilingual hreflang sitemap
│   ├── assets/brand/              # Logo, favicon, PWA icons, and 16:9 banner
│   ├── css/                       # Modular CSS (tokens, base, layout, components, calculator, advisor, mobile)
│   ├── js/
│   │   ├── core/                  # config, i18n, formatters, security, math-engine, basket-optimizer, router-share
│   │   ├── services/              # market-api (3-tier live sync & self-healing verify), vault-storage (SHA-256)
│   │   ├── charts/                # Zero-dependency Canvas 2D compounding curve & 5×5 sensitivity heatmap
│   │   └── views/                 # calculator-view, scanner-view, tracker-view, academy-view, about-view, tour-guide
│   └── data/                      # Bundled 6,000-item catalog + Steam-history enriched market snapshot
└── scripts/
    ├── sync-catalog.mjs           # Rate-limit-safe catalog, 354+ Doppler phase & Steam 7d/30d snapshot updater
    └── verify.mjs                 # 25-file syntax, XSS/CSP, HTML balance, quant math & live HTTP test suite
```

---

## Quick Start (Zero Dependencies)

Requires only **Node.js 20+** — zero `npm install` or build step needed.

```bash
# 1. Clone the repository
git clone https://github.com/HaKING06/SPREAD.git
cd SPREAD

# 2. (Optional) Refresh 6,000-item catalog, Doppler phases & Steam 7d/30d history snapshot
npm run sync

# 3. Start local live server (serves UI + live /api/market, /api/steam-verify, /api/item-lookup, /api/fx)
npm run dev
```

Open **`http://127.0.0.1:4173`** in your browser.

### Automated Verification Suite

Runs syntax checks across all 25 JS/MJS modules, zero-XSS/CSP static audit, EN↔TR dictionary parity (`330+` keys), HTML tag-balance check, quant math + Doppler + Monte Carlo + Self-Healing Steam regression assertions, and live local HTTP endpoint smoke tests:

```bash
node scripts/verify.mjs --live
```

---

## Cloudflare Workers Deployment (`spread.haking.tr`)

Configured out of the box for **GitHub → Cloudflare Workers Builds** (`wrangler.toml`):

```bash
# Dry-run bundle verification
npx wrangler deploy --dry-run

# Production deploy to Cloudflare Edge
npx wrangler deploy
```

1. Push to `main` on GitHub.
2. In **Cloudflare Dashboard → Workers & Pages → Create → Workers → Connect to Git**, select `SPREAD`.
3. Keep Worker name **`spread`** (matches `wrangler.toml`) and deploy command `npx wrangler deploy`.
4. Attach custom domain **`spread.haking.tr`** under **Settings → Domains & Routes**.

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl + K` or `/` | Open 20,000+ CS2 Skin, Doppler Phase & Price Range Search Palette |
| `1` / `2` / `3` / `4` / `5` | Trade Desk / Live Scanner / Cycle Tracker / Arbitrage Guide / About & Trust |
| `←` / `→` / `Esc` | Navigate Interactive Spotlight Tour or close active modal |

---

## Security & Privacy

- **Zero Steam Login / Zero API Keys:** Never asks for credentials, Steam Guard, or browser extensions.
- **Zero-XSS DOM Construction:** Zero `innerHTML`, `outerHTML`, `eval`, `new Function`, or `document.write` sinks across the entire codebase (enforced on every run of `verify.mjs`).
- **Strict CSP:** `script-src 'self'` with zero inline executable `<script>` tags and zero runtime third-party CDNs.
- See [SECURITY.md](SECURITY.md) for responsible disclosure (`spread@haking.tr`).

---

## Support & Contact

- **Official Support & Security Email:** `spread@haking.tr`
- **Buy Me a Coffee:** [buymeacoffee.com/haking](https://buymeacoffee.com/haking)
- **Support via Steam Trade Offer:** [Send Steam Trade Offer](https://steamcommunity.com/tradeoffer/new/?partner=1800489426&token=jIoKxNd7)

---

## Disclaimer & License

SPREAD is an analytical calculator and personal trade-cycle tracker — not financial or investment advice. CS2 market prices fluctuate in real time. Not affiliated with Valve Corporation, Steam, Counter-Strike 2, CSFloat, Youpin898, or Buff163.

Released under the [MIT License](LICENSE).
