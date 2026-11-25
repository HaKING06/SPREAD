<div align="center">
  <img src="public/assets/brand/banner.jpg" alt="SPREAD — CS2 Arbitrage Terminal (spread.haking.tr)" width="100%" />

  <h1>SPREAD — CS2 Arbitrage Calculator &amp; Live Spread Terminal</h1>

  <p>
    <strong>Zero-login, open-source quantitative desk</strong> for <strong>CSFloat &amp; Youpin898 ↔ Steam Community Market</strong> two-way CS2 arbitrage — featuring exact Valve cent fees, 4,500+ skins with 24h/7d sales velocity, Confidence Scores, bilingual EN/TR auto-detection, and a 100% local SHA-256 JSON vault.
  </p>

  <p>
    <a href="https://spread.haking.tr"><strong>spread.haking.tr</strong></a> ·
    <a href="#key-features">Features</a> ·
    <a href="#local-development">Local Setup</a> ·
    <a href="#cloudflare-workers-deployment">Cloudflare Deploy</a> ·
    <a href="SECURITY.md">Security</a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Live-spread.haking.tr-F0B90B?style=flat-square" alt="Live Site" />
    <img src="https://img.shields.io/badge/CS2%20Catalog-4,500%2B%20Items-10D981?style=flat-square" alt="Catalog" />
    <img src="https://img.shields.io/badge/i18n-EN%20Default%20%7C%20TR%20Auto-38BDF8?style=flat-square" alt="Languages" />
    <img src="https://img.shields.io/badge/Deploy-Cloudflare%20Workers-F38020?style=flat-square" alt="Cloudflare Workers" />
    <img src="https://img.shields.io/badge/License-MIT-A855F7?style=flat-square" alt="MIT License" />
  </p>
</div>

---

## What is SPREAD?

**SPREAD** (`https://spread.haking.tr`) is a local-first Counter-Strike 2 two-way arbitrage calculator and live spread scanner comparing **CSFloat** (primary) and **Youpin898** (optional) against the **Steam Community Market**. It solves real 14-day cycles (`2 × 7-day Valve Trade Protection`) with cent-exact Steam math, real-world sales velocity (`24h / 7d / 30d`), anomaly & float guards, and transparent **Trust % Confidence Scores** — without ever asking for Steam login, Steam Guard, or API keys.

---

## Key Features

- **Global Bilingual i18n (`EN` Default + Auto `TR` Detection):**
  - Opens in **English** by default globally; automatically switches to **Turkish** when the visitor's browser language is Turkish (`tr-*`), and persists manual `EN | TR` switching in `localStorage` (plus `?lang=en` / `?lang=tr` share links).
- **Live 5-Source Edge Pipeline & 4,500+ Verified CS2 Items:**
  - Powered by [ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API) imagery & rarity metadata + live **CSFloat** (`min_price`, listing depth `quantity`, `highest_order`), **Steam** (`24h/7d/30d/90d` + live on-demand `/api/steam-verify`), **Youpin898**, **Skinport & Market.CSGO Sales Velocity**, and live **FX (`USD / TRY / CNY / EUR`)** via Cloudflare Workers (`/api/market`, `/api/steam-verify`, `/api/fx`).
- **Smart Capital Strategy Advisor V2 + Filter Guide Popup:**
  - Tailors strategies to your exact budget (`Balanced Mix`, `Low-Count ≤10`, `Fastest Cash`, `Case Engine`, `High Margin / Knives`), with Max Items & Speed filters, Clean Liquid Pool toggle, and an interactive **`ⓘ Filter Guide`** popup for beginners.
  - **Pattern/Float & Thin-Book Anomaly Guard:** Flags pattern-sensitive skins (`Crimson Web`, `Doppler`, `Case Hardened`, `Fade`), filters artificial `<3%` thin-book Leg 2 float anomalies, never labels slow knives as "Fast", and scores every strategy with a **35–99% Confidence / Trust Score**.
- **Exact Quantitative Math Engine:**
  - **Exact Valve Cent Solver:** Solves Steam's minimum `$0.01 Steam + $0.01 CS2` cent floor instead of naive `÷ 1.15`, catching hidden up-to-66.7% fee traps on low-price items.
  - **M₂ Cash-Equivalent Accounting:** Discounts leftover Steam Wallet balance by `M₂` so Realistic ROI never inflates above Theoretical ROI.
  - **Interactive Canvas 2D Charts:** Zero-dependency 12-cycle compounding curve and 5×5 price volatility risk heatmap.
- **About & Trust Page (`/about` | `/hakkinda`):**
  - Explains the full edge architecture, zero-login security guarantees, quantitative safeguards, and live 6-node telemetry status directly inside the app.
- **Hardened Zero-XSS Security & Local JSON Vault:**
  - Zero `innerHTML`, zero runtime 3rd-party JS CDNs, zero inline executable scripts, strict CSP (`script-src 'self'`), and SHA-256 integrity-verified JSON backup/restore + CSV ledger export.

---

## Project Structure

```text
├── wrangler.toml               # Cloudflare Workers + Static Assets config (name = "spread")
├── server.mjs                  # Zero-dependency local dev & live API proxy server
├── src/
│   └── worker.js               # Cloudflare Worker (/api/market, /api/steam-verify, /api/fx + ASSETS)
├── public/                     # Static public web assets uploaded to Cloudflare Edge
│   ├── index.html              # EN-first SEO HTML + JSON-LD + hreflang + strict CSP
│   ├── _headers                # Security headers (CSP, HSTS, X-Frame-Options)
│   ├── _redirects              # Bilingual SPA clean URL routes (/scanner, /tarayici, /about, /hakkinda...)
│   ├── sitemap.xml             # Multilingual hreflang sitemap
│   ├── assets/brand/           # Brand logo, favicon, and 16:9 social banner
│   ├── css/                    # Modular design system (tokens, base, layout, components, views)
│   ├── js/                     # Modular ES app (core/i18n, core/math-engine, services, charts, views)
│   └── data/                   # Bundled 4,500-item catalog + velocity-enriched snapshot
└── scripts/
    ├── sync-catalog.mjs        # ByMykel/CSGO-API + live velocity & market snapshot updater
    └── verify.mjs              # Automated syntax, CSP/XSS, i18n, quant math & live HTTP test suite
```

---

## Local Development

Requires only **Node.js 20+** — zero `npm install` needed.

```bash
# 1. Clone the repository
git clone https://github.com/halit/SPREAD.git
cd SPREAD

# 2. (Optional) Refresh catalog & live market velocity snapshot
npm run sync

# 3. Start local live server (serves UI + live /api/market, /api/steam-verify & /api/fx)
npm run dev
```

Open **`http://127.0.0.1:4173`** in your browser.

Run full automated verification (including live API smoke test):

```bash
node scripts/verify.mjs --live
```

---

## Cloudflare Workers Deployment (`spread.haking.tr`)

Configured directly for **GitHub → Cloudflare Workers Builds (`npx wrangler deploy`)**:

1. Push this repository to GitHub (`main` branch).
2. In **Cloudflare Dashboard → Workers & Pages → Create → Workers → Connect to Git**, select `SPREAD`.
3. Keep Worker name **`spread`** (matches `wrangler.toml`) and deploy command `npx wrangler deploy`.
4. Attach your custom domain **`spread.haking.tr`** under **Settings → Domains & Routes**.
5. `src/worker.js` serves `/api/market`, `/api/steam-verify`, and `/api/fx` on the Edge while static files are served cleanly from `./public`.

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl + K` or `/` | Open 4,500+ CS2 Skin & Price Range Search Palette |
| `1` / `2` / `3` / `4` / `5` | Trade Desk / Live Scanner / Cycle Tracker / Guide / About & Trust |
| `Esc` | Close active modal or search palette |

---

## Support & Contact

- **Official Support & Security Email:** `spread@haking.tr`
- **Buy Me a Coffee:** [buymeacoffee.com/haking](https://buymeacoffee.com/haking)
- **Support via Steam Trade Offer:** [Send Steam Trade Offer](https://steamcommunity.com/tradeoffer/new/?partner=1800489426&token=jIoKxNd7)

---

## Disclaimer & License

SPREAD is an analytical calculator and personal cycle tracker — not financial or investment advice. Not affiliated with Valve Corporation, Steam, Counter-Strike 2, CSFloat, or Youpin898.

Released under the [MIT License](LICENSE).
