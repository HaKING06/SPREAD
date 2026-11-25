/**
 * SPREAD (spread.haking.tr) — Internationalization Engine (EN Default + Auto TR Detection)
 *
 * Language Resolution Priority:
 *  1. Explicit URL query param (?lang=tr or ?lang=en)
 *  2. User's saved localStorage preference (spread_haking_tr_v1_lang)
 *  3. Browser language detection: starts with "tr" -> Turkish ('tr'), all others -> English ('en')
 */

export const LANG_STORAGE_KEY = 'spread_haking_tr_v1_lang';

export const DICT = {
  en: {
    // Meta & Routes
    'route.calculator.title': 'SPREAD — CS2 Arbitrage Calculator & Live Spread Terminal | spread.haking.tr',
    'route.scanner.title': 'Live CS2 Skin Arbitrage Scanner (4,500+ Items) — SPREAD',
    'route.tracker.title': '14-Day CS2 Trade Hold Cycle Tracker — SPREAD',
    'route.academy.title': 'What is CS2 Steam Arbitrage? Complete Guide & Fee Lab — SPREAD',
    'route.about.title': 'About SPREAD — Architecture, Live Data & Zero-Login Security',

    // Header & Nav
    'brand.sub': 'Live CS2 Arbitrage Terminal',
    'nav.calculator': 'Trade Desk',
    'nav.scanner': 'Live Scanner',
    'nav.tracker': 'Cycle Tracker',
    'nav.academy': 'Arbitrage Guide',
    'nav.about': 'About & Trust',
    'hdr.search': 'Search skins...',
    'hdr.refresh': '↻ Refresh Live',
    'hdr.refreshing': 'Syncing...',
    'hdr.vault': '⛁ Vault / JSON',
    'hdr.support': '☕ Support',
    'hdr.buyFee': 'Buy:',
    'hdr.sellFee': 'Sell:',
    'hdr.withdrawFee': 'Payout:',
    'hdr.steamFee': 'Steam:',
    'hdr.live': 'LIVE',
    'hdr.cache': 'CACHED',
    'hdr.items': 'items',

    // Onboarding & Banners
    'onboard.badge': 'HOW IT WORKS',
    'onboard.pitch': 'Buy discounted CS2 skins on CSFloat → sell higher on Steam → cash out via liquid skins in a 14-day profit loop.',
    'onboard.s1': 'Enter your budget',
    'onboard.s2': 'Apply SPREAD Agent pick',
    'onboard.s3': 'Track 14-day cycle',
    'onboard.tourBtn': '▶ Interactive Tour',
    'onboard.guide': 'Guide →',
    'shared.banner': 'Shared Arbitrage Setup Loaded: Your friend’s exact loop configuration is now active on the desk.',
    'shared.clear': 'Clear URL',

    // Calculator Hero
    'calc.capital': 'Your Budget',
    'calc.capital.tip': 'Cash budget available on CSFloat or Youpin898 for your Step 1 purchases.',
    'calc.mult': '14-Day Return Multiplier',
    'calc.mult.tip': 'Combined return of Step 1 (Steam boost) × Step 2 (cashout rate). Anything above 1.0000x means net cash profit.',
    'calc.mult.sub': 'Buy → Steam → Back to Cash',
    'calc.realProfit': 'Est. Cycle 1 Net Profit',
    'calc.realProfit.tip': 'Realistic net cash profit using whole items. Any leftover Steam Wallet cents are converted to true cash value.',
    'calc.realProfit.sub': 'Total Cash Value (incl. Steam)',
    'calc.breakEven': 'Safe Exit Loss Limit',
    'calc.breakEven.tip': 'Maximum cashout discount you can accept in Step 2 and still break even: 1 − (1 / Step 1 Boost).',
    'calc.breakEven.sub': 'Max Step 2 cashout discount',
    'calc.monthly': 'Est. Monthly (2 Cycles)',
    'calc.monthly.tip': 'Estimated 28-day compounded return across 2 back-to-back 14-day trade-hold cycles.',
    'calc.monthly.sub': '28 Days • 2 Full Loops',
    'calc.trackBtn': '+ Track This Cycle',
    'calc.bestBtn': '⚡ Best Strategy',
    'calc.shareBtn': '↗ Share',
    'calc.theo': 'Est.',
    'calc.cashEquiv': 'Total Cash Value',
    'calc.safetyMargin': 'Safety Cushion',
    'calc.limitExceeded': 'Unprofitable Exit',
    'calc.pts': 'pts',

    // Strategy Advisor
    'adv.title': '⚡ SPREAD Agent — Smart Strategy Advisor',
    'adv.allItems': 'Browse All 4,500+ Skins →',
    'adv.howFilters': 'ⓘ Filter Guide',
    'adv.style.ALL': 'Best Mix',
    'adv.style.LOW_QTY': 'Few Items (≤10)',
    'adv.style.FAST': 'Fastest Cash',
    'adv.style.CASES': 'Cases Only',
    'adv.style.PATIENT': 'High Profit / Knives',
    'adv.maxQty': 'Max Items:',
    'adv.auto': 'Auto',
    'adv.qtyUnit': 'items',
    'adv.speed': 'Sell Speed:',
    'adv.speed.ULTRA': 'Sells Instantly',
    'adv.speed.FAST': 'Fast Sellers',
    'adv.speed.MODERATE': 'All (Incl. Slower)',
    'adv.cleanPool': 'Hide Rare/Dead Skins',
    'adv.cleanPool.tip': 'Automatically hides hard-to-sell StatTrak™, Souvenir & low-demand collector capsules',
    'adv.splitTitle': 'Recommended Budget Allocation',
    'adv.apply': 'Apply Strategy →',
    'adv.active': '✓ Active on Desk',
    'adv.empty': 'No profitable matches under current item count & speed filters. Try relaxing Max Items or Sell Speed.',
    'adv.stratsCount': 'strategies',
    'adv.maxLabel': 'Max',
    'adv.eff': 'Used',
    'adv.speedLbl': 'Speed',
    'adv.conf': 'Trust',

    // Timeline & Reality
    'tl.meta': 'Estimated Realistic Cycle Duration (7+7D Trade Hold + Buy/Sell Speed)',
    'tl.d0': 'Day 0 • Buy on',
    'tl.d7': 'Day 7 • Steam Net & Exit Skin',
    'tl.d14': 'Day 14+ • Final Cash Value',
    'tl.hold': '7D Hold',
    'tl.leftover': 'Cash left',
    'tl.exitItems': 'exit skins',
    'tl.cash': 'Cash',
    'tl.fixBest': 'Apply Realistic Strategy',
    'tl.fixSearch': 'Search Higher-Price Skins',
    'tl.setMinCap': 'Match 1 Item Cost',

    // Leg 1 & Leg 2 Cards
    'leg1.badge': 'STEP 1 • GROW STEAM BALANCE',
    'leg1.title': 'Buy → Sell on Steam',
    'leg1.name': 'Step 1 Item to Buy',
    'leg1.buy': 'Buy Price',
    'leg1.sell': 'Steam Sell',
    'leg1.net': 'Net Steam Payout / Item',
    'leg1.fee': 'Real Steam Fee',
    'leg1.qty': 'Items to Buy & Cash Left',
    'leg1.bal': 'Total Steam Balance After Step 1',
    'leg1.pct': 'Step 1 Balance Boost',
    'leg2.badge': 'STEP 2 • CASH OUT TO REAL MONEY',
    'leg2.title': 'Buy on Steam → Sell',
    'leg2.name': 'Step 2 Cashout Skin',
    'leg2.buy': 'Steam Buy',
    'leg2.sell': 'Sell Price',
    'leg2.net': 'Net Cash Payout / Item',
    'leg2.qty': 'Exit Items & Steam Leftover',
    'leg2.ret': 'Cash Returned After Step 2',
    'leg2.loss': 'Cashout Discount / Loss',
    'leg.change': 'Change',
    'leg.lossWord': 'Loss',
    'leg.extraGain': 'Extra Gain',
    'leg.units': 'units',
    'leg.left': 'Left',

    // FX Bar, Charts & Table
    'fx.badge': 'LIVE FX CONVERTER',
    'fx.toL1': '→ Send to Leg 1 Buy',
    'fx.toL2': '→ Send to Leg 2 Sell',
    'chart.compTitle': '12-Cycle Compound Capital Curve (168 Days)',
    'chart.compSub': 'Hover to compare Realistic Cash-Equivalent vs Theoretical Compounding.',
    'chart.legReal': 'Realistic (Cash-Equiv)',
    'chart.legTheo': 'Theoretical (Mⁿ)',
    'chart.heatTitle': 'Price Volatility Risk Heatmap (7+7D Hold)',
    'chart.heatSub': 'Net Cycle ROI if Steam (S1) or Cashout (M2) prices shift during trade hold.',
    'table.title': 'Compound Cycle Simulation Table',
    'table.realistic': 'Realistic (Integer + Cash-Equiv)',
    'table.proportional': 'Theoretical Proportional (Mⁿ)',
    'table.colCycle': 'Cycle',
    'table.colTime': 'Time',
    'table.colCash': 'Market Cash',
    'table.colSteamLeft': 'Steam Left',
    'table.colCashEq': 'Cash-Equiv',
    'table.colProfit': 'Net Profit & ROI',
    'table.colMult': 'Compound Mult (Mⁿ)',
    'table.colTheoCap': 'Theoretical Capital',
    'table.colTheoProfit': 'Theoretical Profit',
    'table.colGrowth': 'Total Growth %',

    // Scanner
    'scan.pairsTitle': '⚡ Top Live Full-Cycle Pairs (Velocity & Anti-Manipulation Verified)',
    'scan.pairsSub': 'Highest-confidence, actively traded Leg 1 + Leg 2 pairs tailored to your budget.',
    'scan.mode.LEG1': 'Leg 1 (Steam Boost)',
    'scan.mode.LEG2': 'Leg 2 (Low-Loss Cashout)',
    'scan.mode.ALL': 'All Items',
    'scan.mode.WATCH': '★ Watchlist',
    'scan.mode.CUSTOM': 'Custom Items',
    'scan.antiManip': 'Anti-Manipulation (24h/7d)',
    'scan.buyOrder': 'Leg 2 Buy Order',
    'scan.addCustom': '+ Custom Item',
    'scan.importBulk': 'Import CSV / JSON',
    'scan.searchLbl': 'Search',
    'scan.searchPh': 'e.g. ak red ft, case, asiimov...',
    'scan.catLbl': 'Category',
    'scan.minQtyLbl': 'Min Listings',
    'scan.minPriceLbl': 'Min',
    'scan.maxPriceLbl': 'Max',
    'scan.sortLbl': 'Sort By',
    'scan.colItem': 'Item / Visual / Rarity',
    'scan.colSpeed': 'Sales Speed (24h/7d)',
    'scan.colMkt': 'Price',
    'scan.colSteam': 'Steam Price',
    'scan.colTrend': '90d Trend',
    'scan.colL1': 'Leg 1 Boost %',
    'scan.colL2': 'Leg 2 Loss %',
    'scan.colAct': 'Load to Desk',
    'scan.prev': '← Prev',
    'scan.next': 'Next →',

    // Tracker
    'tr.active': 'Tracked Cycles',
    'tr.capital': 'Active Locked Capital',
    'tr.capitalSub': 'Normalized to display currency',
    'tr.expected': 'Expected Active Profit',
    'tr.expectedSub': 'Open Phase 1 + Phase 2 total',
    'tr.realized': 'Realized Total Profit',
    'tr.realizedSub': 'Completed cycles ledger',
    'tr.all': 'All',
    'tr.activeFilter': 'Active Hold',
    'tr.doneFilter': 'Completed',
    'tr.csv': '↓ Export CSV Ledger',
    'tr.demo': 'Load Sample Cycles',
    'tr.empty': 'No tracked cycles yet. Click "+ Track This Cycle" on the Trade Desk to monitor a 14-day loop.',

    // Academy (SEO Rich!)
    'acad.badge': 'CS2 ARBITRAGE ACADEMY • SPREAD.HAKING.TR',
    'acad.h2': 'What is CS2 Steam Arbitrage? How CSFloat & Youpin898 ↔ Steam Loops Work',
    'acad.lead': 'Items on the Steam Community Market typically trade 20% to 45% higher than real-cash P2P marketplaces like CSFloat and Youpin898 because Steam Wallet funds cannot be withdrawn directly to a bank account. Two-way CS2 arbitrage captures this structural price spread in a disciplined 14-day loop.',
    'acad.s1.num': 'STEP 01 • DAY 0',
    'acad.s1.t': 'Buy Undervalued Liquid Items (Leg 1)',
    'acad.s1.d': 'Purchase high-spread, fast-selling CS2 cases or play skins on CSFloat (0% buy fee) or Youpin898 using real cash.',
    'acad.s2.num': 'STEP 02 • DAY 0–7',
    'acad.s2.t': '7-Day Valve Trade Protection',
    'acad.s2.d': 'Under Valve’s July 2025 Trade Protection rule, traded items remain locked for 7 days before market listing. Volatility risk is tracked live.',
    'acad.s3.num': 'STEP 03 • DAY 7',
    'acad.s3.t': 'Sell on Steam & Buy Exit Skin',
    'acad.s3.d': 'Sell on Steam Market to multiply wallet balance (M₁), then buy a high-liquidity, low-loss cashout skin (e.g. AK-47 Redline, Printstream).',
    'acad.s4.num': 'STEP 04 • DAY 14',
    'acad.s4.t': 'Cash Out & Compound (Leg 2)',
    'acad.s4.d': 'After the second 7-day hold clears, sell on CSFloat (2% fee) or Youpin898 (1% fee) back to cash. When M₁ × M₂ > 1.00, reinvest profits.',
    'acad.labBadge': 'EXACT FEE SIMULATOR',
    'acad.labTitle': 'Steam $0.01 + $0.01 Minimum Fee Trap Lab',
    'acad.labDesc': 'Most calculators assume a flat ÷ 1.15 (13.04%) Steam fee. In reality, Valve enforces a minimum $0.01 Steam fee + $0.01 CS2 fee per item — pushing real fees up to 66.7% on cheap items.',
    'acad.labNet': 'Exact Net Proceeds',
    'acad.labEff': 'Real Effective Fee',
    'acad.labDiff': 'vs ÷1.15 Diff',
    'acad.cmpBadge': 'MARKETPLACE BENCHMARK',
    'acad.cmpTitle': 'CSFloat vs Youpin898 (2025/2026 Real Fees)',

    // About & Trust Page
    'about.badge': 'TRANSPARENCY & ARCHITECTURE • SPREAD.HAKING.TR',
    'about.h2': 'How SPREAD Works Under the Hood & Why You Can Trust It',
    'about.lead': 'SPREAD is built from the ground up as a zero-login, open-source quantitative desk for CS2 traders. No account access, no hidden backend tracking, and 100% verifiable real-market math.',
    'about.trustTitle': 'Why Traders Trust SPREAD',
    'about.t1.t': 'Zero Login & Zero API Keys',
    'about.t1.d': 'We never ask for Steam login, Steam Guard, trade URLs, CSFloat API keys, or browser extensions. Your inventory stays 100% untouched.',
    'about.t2.t': '100% Local-First Browser Vault',
    'about.t2.d': 'Your tracked cycles, custom prices, and watchlist stay strictly in your own browser (localStorage) with SHA-256 verified JSON backups.',
    'about.t3.t': 'Strict CSP & Zero-XSS Hardening',
    'about.t3.d': 'Zero runtime third-party JS libraries, zero inline scripts, zero innerHTML sinks, strict Content-Security-Policy, and open-source MIT code on GitHub.',
    'about.t4.t': 'Real Sales Velocity & Anomaly Guard',
    'about.t4.d': 'Unlike naive spread tables that push dead capsules or manipulated floats, SPREAD cross-checks 24h/7d/30d sales volume, Bid/Ask depth, and Steam price history.',
    'about.pipeTitle': 'Live Multi-Source Data Pipeline (Cloudflare Edge)',
    'about.pipeDesc': 'Every 5 minutes, our open-source Cloudflare Worker aggregates 5 independent public feeds into a normalized 4,500-item quant matrix, plus on-demand live Steam 24h verification:',
    'about.mathTitle': 'Quantitative Engine Highlights',

    // Filter Guide Modal
    'fguide.title': 'ⓘ Strategy Filters & Confidence Score Explained',
    'fguide.intro': 'New to CS2 arbitrage? Here is what each filter and metric inside the Strategy Advisor means in plain language:',

    // Command Palette, Share, Support, Vault & Footer
    'cmd.title': '⌕ CS2 Skin & Price Range Search',
    'cmd.ph': 'Search by name (e.g. ak red ft, printstream) or leave blank & set Min/Max price...',
    'cmd.minPh': 'Min price',
    'cmd.maxPh': 'Max price',
    'cmd.reset': 'Reset',
    'cmd.hint': 'Set Min $50 to filter top high-tier spreads instantly',
    'share.title': '↗ Share This Arbitrage Setup',
    'share.lbl': 'Direct Share Link (opens this exact configuration for your friend)',
    'share.copy': 'Copy',
    'share.copySummary': '📋 Copy Discord / Chat Summary',
    'support.title': '☕ Support SPREAD & Contact',
    'support.desc': 'SPREAD (spread.haking.tr) is free, ad-free, and open-source. If it helps you spot profitable spreads, you can voluntarily support hosting & development:',
    'support.coffeeTag': 'FINANCIAL SUPPORT',
    'support.coffeeDesc': 'Buy the developer a coffee to help keep live edge feeds and updates running.',
    'support.steamTag': 'CS2 SKIN / CASE',
    'support.steamTitle': 'Support via Steam Trade',
    'support.steamDesc': 'Prefer donating a spare CS2 case, sticker, or skin directly via Steam Trade Offer?',
    'support.steamBtn': '⇄ Send Steam Trade Offer ↗',
    'support.mailLbl': 'Official Support & Security Email',
    'support.copyMail': 'Copy Address',
    'support.sendMail': '✉ Send Email',
    'vault.title': '⛁ Local Data Vault — JSON Backup & Restore',
    'vault.desc': 'All cycles, watchlist items, and custom prices live exclusively in your browser (localStorage) — never sent to any server. Export a SHA-256 verified JSON backup anytime.',
    'vault.exportJson': '↓ Download Full JSON Backup (.json)',
    'vault.exportCsv': '↓ Export Cycle Ledger (.csv)',
    'vault.importJson': '↑ Restore JSON Backup',
    'vault.danger': 'Danger Zone: Permanently clears all local SPREAD data in this browser.',
    'vault.clear': 'Clear All Local Data',
    'footer.desc': '100% local-first, open-source CS2 two-way arbitrage terminal. Zero Steam login required. Not affiliated with Valve Corporation, Steam, CSFloat, or Youpin898.',
    'footer.contact': 'Support & Contact',
    'footer.contactDesc': 'Bug reports, feature ideas, or inquiries:',
    'footer.supportTitle': 'Support the Developer',
    'footer.supportDesc': 'SPREAD is free and open-source. Support server & dev costs:',
    'footer.supportBtn': 'Support Details',
    'footer.steamBtn': '⇄ Support via Steam Trade',
    'footer.disclaimer': 'Not financial advice — CS2 market prices fluctuate in real time.',
    'cat.ALL': 'All Categories',
    'cat.Case': 'Cases',
    'cat.Rifles': 'Rifles',
    'cat.Pistols': 'Pistols',
    'cat.SMGs': 'SMGs',
    'cat.Heavy': 'Heavy',
    'cat.Knives': 'Knives',
    'cat.Gloves': 'Gloves',
    'cat.Agent': 'Agents',
    'cat.Capsule': 'Capsules',
    'sort.AUTO': 'Smart Auto',
    'sort.LEG1_DESC': 'Best Leg 1 Boost %',
    'sort.LEG2_ASC': 'Lowest Leg 2 Loss %',
    'sort.SPEED_DESC': 'Fastest Sales Speed',
    'sort.QTY_DESC': 'Most Listings',
    'sort.PRICE_ASC': 'Price: Low → High',
    'sort.PRICE_DESC': 'Price: High → Low',
    'modal.completeTitle': '✓ Complete Cycle & Log Realized Profit',
    'modal.actualEndLbl': 'Actual Net Cash Received',
    'modal.noteLbl': 'Note (Optional)',
    'modal.notePh': 'e.g. Sold instantly via CSFloat buy order',
    'modal.cancel': 'Cancel',
    'modal.saveLedger': 'Save to Ledger',
    'custom.name': 'Item Name',
    'custom.mktPrice': 'Market Price',
    'custom.steamPrice': 'Steam Price',
    'custom.save': 'Save Item',
    'bulk.fillSample': 'Fill Sample CSV',
    'bulk.importBtn': 'Import Items'
  },

  tr: {
    // Meta & Routes
    'route.calculator.title': 'SPREAD — CS2 Arbitraj Hesaplayıcı ve Canlı Spread Terminali | spread.haking.tr',
    'route.scanner.title': 'Canlı CS2 Skin Arbitraj Tarayıcısı (4.500+ Eşya) — SPREAD',
    'route.tracker.title': '14 Günlük CS2 Aktif Döngü Takibi — SPREAD',
    'route.academy.title': 'CS2 Steam Arbitraj Nedir? Kapsamlı Rehber ve Komisyon Laboratuvarı — SPREAD',
    'route.about.title': 'Hakkında — SPREAD Sistem Mimarisi, Canlı Veriler ve Güvenlik',

    // Header & Nav
    'brand.sub': 'CS2 Canlı Arbitraj Terminali',
    'nav.calculator': 'Döngü Masası',
    'nav.scanner': 'Canlı Tarayıcı',
    'nav.tracker': 'Aktif Döngüler',
    'nav.academy': 'Arbitraj Rehberi',
    'nav.about': 'Hakkında & Güven',
    'hdr.search': 'Skin Ara...',
    'hdr.refresh': '↻ Canlı Yenile',
    'hdr.refreshing': 'Güncelleniyor...',
    'hdr.vault': '⛁ Kasa / JSON',
    'hdr.support': '☕ Destek',
    'hdr.buyFee': 'Alış:',
    'hdr.sellFee': 'Satış:',
    'hdr.withdrawFee': 'Çekim:',
    'hdr.steamFee': 'Steam:',
    'hdr.live': 'CANLI',
    'hdr.cache': 'ÖNBELLEK',
    'hdr.items': 'eşya',

    // Onboarding & Banners
    'onboard.badge': 'NASIL ÇALIŞIR?',
    'onboard.pitch': 'CSFloat’tan ucuza skin/kasa al → Steam’de kârlı sat → Hızlı satılan skinle tekrar nakde dön (14 günde net kâr).',
    'onboard.s1': 'Bütçeni yaz',
    'onboard.s2': 'SPREAD Agent önerisini seç',
    'onboard.s3': '14 günlük döngüyü takip et',
    'onboard.tourBtn': '▶ İnteraktif Tur',
    'onboard.guide': 'Rehber →',
    'shared.banner': 'Paylaşılan Arbitraj Kurulumu Yüklendi: Arkadaşının gönderdiği döngü senaryosu masaya aktarıldı.',
    'shared.clear': 'URL Temizle',

    // Calculator Hero
    'calc.capital': 'Başlangıç Bütçen',
    'calc.capital.tip': 'CSFloat veya Youpin898 hesabında 1. adım alımı için ayırdığın nakit para.',
    'calc.mult': '14 Günlük Kâr Çarpanı',
    'calc.mult.tip': '1. Adım (Steam bakiye artışı) × 2. Adım (nakit dönüş oranı). 1.0000x üstü net nakit kâr demektir.',
    'calc.mult.sub': 'Alış → Steam → Nakit Dönüş',
    'calc.realProfit': '1. Tur Tahmini Net Kâr',
    'calc.realProfit.tip': 'Tam sayı eşya alımıyla elde edilen gerçekçi net nakit kârı. Steam cüzdanında artan küsurat gerçek nakit değerine çevrilerek eklenir.',
    'calc.realProfit.sub': 'Toplam Nakit Değer (Steam dahil)',
    'calc.breakEven': 'Zarar Etmeme Sınırı',
    'calc.breakEven.tip': '2. adımda nakde dönerken zarar etmeden kabul edebileceğin en fazla fiyat farkı.',
    'calc.breakEven.sub': 'En fazla 2. adım nakit kaybı',
    'calc.monthly': 'Aylık Tahmini Getiri',
    'calc.monthly.tip': '14 günde 1 tam döngüyle 28 gün (2 tur) sonunda bileşik tahmini büyüme.',
    'calc.monthly.sub': '28 Gün • 2 Tam Döngü',
    'calc.trackBtn': '+ Bu Döngüyü Takibe Al',
    'calc.bestBtn': '⚡ En İyi Strateji',
    'calc.shareBtn': '↗ Paylaş',
    'calc.theo': 'Tahmini',
    'calc.cashEquiv': 'Toplam Nakit',
    'calc.safetyMargin': 'Güvenli Pay',
    'calc.limitExceeded': 'Kârsız Dönüş',
    'calc.pts': 'puan',

    // Strategy Advisor
    'adv.title': '⚡ SPREAD Agent — Akıllı Strateji Danışmanı',
    'adv.allItems': 'Tüm 4.500+ Skini Gör →',
    'adv.howFilters': 'ⓘ Filtre Rehberi',
    'adv.style.ALL': 'Karma (Önerilen)',
    'adv.style.LOW_QTY': 'Az İşlem (≤10)',
    'adv.style.FAST': 'En Hızlı Nakit',
    'adv.style.CASES': 'Sadece Kasalar',
    'adv.style.PATIENT': 'Yüksek Kâr / Bıçak',
    'adv.maxQty': 'En Fazla Adet:',
    'adv.auto': 'Otomatik',
    'adv.qtyUnit': 'adet',
    'adv.speed': 'Satış Hızı:',
    'adv.speed.ULTRA': 'Anında Satılanlar',
    'adv.speed.FAST': 'Hızlı Satılanlar',
    'adv.speed.MODERATE': 'Tümü (Yavaş Dahil)',
    'adv.cleanPool': 'Zor Satılanları Gizle',
    'adv.cleanPool.tip': 'Zor satılan StatTrak™, Hatıra ve düşük hacimli koleksiyon kapsüllerini otomatik gizler',
    'adv.splitTitle': 'Önerilen Bütçe Dağılımı',
    'adv.apply': 'Stratejiyi Uygula →',
    'adv.active': '✓ Masada Aktif',
    'adv.empty': 'Seçili adet/hız filtrelerinde kârlı eşleşme bulunamadı. "En Fazla Adet" veya "Satış Hızı" filtresini genişletin.',
    'adv.stratsCount': 'strateji',
    'adv.maxLabel': 'Maks',
    'adv.eff': 'Verim',
    'adv.speedLbl': 'Hız',
    'adv.conf': 'Güven',

    // Timeline & Reality
    'tl.meta': 'Tahmini Gerçekçi Döngü Süresi (7+7G Takas Kilidi + Alım/Satım Hızı)',
    'tl.d0': 'Gün 0 • Alım:',
    'tl.d7': 'Gün 7 • Steam Net & Dönüş',
    'tl.d14': 'Gün 14+ • Toplam Nakit Değer',
    'tl.hold': '7G Kilit',
    'tl.leftover': 'Artan nakit',
    'tl.exitItems': 'dönüş eşyası',
    'tl.cash': 'Nakit',
    'tl.fixBest': 'Gerçekçi Strateji Uygula',
    'tl.fixSearch': 'Üst Fiyatlı Skin Ara',
    'tl.setMinCap': '1 Adet Fiyatına Eşitle',

    // Leg 1 & Leg 2 Cards
    'leg1.badge': 'ADIM 1 • STEAM BAKİYESİ BÜYÜT',
    'leg1.title': 'Alış → Steam Satış',
    'leg1.name': '1. Adım Alınacak Eşya',
    'leg1.buy': 'Alış Fiyatı',
    'leg1.sell': 'Steam Satış',
    'leg1.net': 'Steam Satışından Ele Geçen',
    'leg1.fee': 'Gerçek Steam Kesintisi',
    'leg1.qty': 'Alınacak Adet & Artan Nakit',
    'leg1.bal': '1. Adım Sonu Steam Bakiyesi',
    'leg1.pct': '1. Adım Bakiye Artışı',
    'leg2.badge': 'ADIM 2 • TEKRAR NAKDE DÖN',
    'leg2.title': 'Steam Alış → Satış',
    'leg2.name': '2. Adım Nakde Dönüş Eşyası',
    'leg2.buy': 'Steam Alış',
    'leg2.sell': 'Satış Fiyatı',
    'leg2.net': 'Pazar Satışından Ele Geçen',
    'leg2.qty': 'Dönüş Adedi & Steam Artan',
    'leg2.ret': '1. Tur Nakit Dönüşü',
    'leg2.loss': 'Nakit Dönüşüm Kaybı',
    'leg.change': 'Değiştir',
    'leg.lossWord': 'Kayıp',
    'leg.extraGain': 'Ek Kâr',
    'leg.units': 'adet',
    'leg.left': 'Kalan',

    // FX Bar, Charts & Table
    'fx.badge': 'CANLI KUR ÇEVİRİCİ',
    'fx.toL1': '→ 1. Yön Alışa Aktar',
    'fx.toL2': '→ 2. Yön Satışa Aktar',
    'chart.compTitle': '12 Döngülük Bileşik Sermaye Eğrisi (168 Gün)',
    'chart.compSub': 'Fare ile üzerine gelerek gerçekçi nakit eşdeğeri vs teorik büyümeyi inceleyin.',
    'chart.legReal': 'Gerçekçi (Nakit Eşd.)',
    'chart.legTheo': 'Teorik (Mⁿ)',
    'chart.heatTitle': 'Fiyat Dalgalanma Risk Haritası (7+7G Hold)',
    'chart.heatSub': 'Takas kilidi boyunca Steam (S1) veya Pazar (M2) fiyatı oynarsa Net ROI ne olur?',
    'table.title': 'Bileşik Döngü Simülasyon Tablosu',
    'table.realistic': 'Gerçekçi (Tam Sayı + Nakit Eşdeğeri)',
    'table.proportional': 'Teorik Oransal (Mⁿ)',
    'table.colCycle': 'Döngü',
    'table.colTime': 'Süre',
    'table.colCash': 'Pazar Nakit',
    'table.colSteamLeft': 'Steam Kalan',
    'table.colCashEq': 'Nakit Eşdeğeri',
    'table.colProfit': 'Net Kâr & ROI',
    'table.colMult': 'Bileşik Çarpan (Mⁿ)',
    'table.colTheoCap': 'Teorik Sermaye',
    'table.colTheoProfit': 'Teorik Net Kâr',
    'table.colGrowth': 'Toplam Büyüme %',

    // Scanner
    'scan.pairsTitle': '⚡ En İyi Canlı Tam Döngü Çiftleri (Hız & Anti-Manipülasyon Doğrulamalı)',
    'scan.pairsSub': 'Bütçene uygun, yüksek satış hacimli ve güvenilir 1. Yön + 2. Yön eşleşmeleri.',
    'scan.mode.LEG1': '1. Yön (Bakiye Kârı)',
    'scan.mode.LEG2': '2. Yön (Düşük Kayıp)',
    'scan.mode.ALL': 'Tüm Eşyalar',
    'scan.mode.WATCH': '★ İzleme Listem',
    'scan.mode.CUSTOM': 'Özel Eşyalar',
    'scan.antiManip': 'Anti-Manipülasyon (24s/7g)',
    'scan.buyOrder': '2. Yön Buy Order',
    'scan.addCustom': '+ Özel Eşya',
    'scan.importBulk': 'CSV / JSON Ekle',
    'scan.searchLbl': 'Arama',
    'scan.searchPh': 'Örn: ak red ft, case, asiimov...',
    'scan.catLbl': 'Kategori',
    'scan.minQtyLbl': 'Min. İlan',
    'scan.minPriceLbl': 'Min',
    'scan.maxPriceLbl': 'Maks',
    'scan.sortLbl': 'Sıralama',
    'scan.colItem': 'Eşya / Görsel / Nadirlik',
    'scan.colSpeed': 'Satış Hızı (24s/7g)',
    'scan.colMkt': 'Fiyat',
    'scan.colSteam': 'Steam Fiyat',
    'scan.colTrend': '90g Trend',
    'scan.colL1': '1. Yön Kâr %',
    'scan.colL2': '2. Yön Kayıp %',
    'scan.colAct': 'Döngüye Aktar',
    'scan.prev': '← Önceki',
    'scan.next': 'Sonraki →',

    // Tracker
    'tr.active': 'Takipteki Döngüler',
    'tr.capital': 'Aktif Bağlı Sermaye',
    'tr.capitalSub': 'Aktif kur üzerinden birleştirildi',
    'tr.expected': 'Beklenen Aktif Kâr',
    'tr.expectedSub': 'Açık Faz 1 + Faz 2 toplamı',
    'tr.realized': 'Gerçekleşen Toplam Kâr',
    'tr.realizedSub': 'Tamamlanmış döngüler defteri',
    'tr.all': 'Tümü',
    'tr.activeFilter': 'Aktif Hold',
    'tr.doneFilter': 'Tamamlananlar',
    'tr.csv': '↓ CSV Defter İndir',
    'tr.demo': 'Örnek Döngü Yükle',
    'tr.empty': 'Henüz takipte döngü yok. Döngü Masası\'ndan "+ Bu Döngüyü Takibe Al" ile 14 günlük sayaç başlatabilirsin.',

    // Academy (SEO Rich TR)
    'acad.badge': 'CS2 ARBİTRAJ AKADEMİSİ • SPREAD.HAKING.TR',
    'acad.h2': 'CS2 Steam Arbitraj Nedir? CSFloat & Youpin898 ↔ Steam Döngüsü Nasıl Çalışır?',
    'acad.lead': 'Steam Topluluk Pazarı\'nda eşyalar gerçek nakit pazarlara (CSFloat, Youpin898) kıyasla genellikle %20 ile %45 daha yüksek fiyatlanır; çünkü Steam cüzdan bakiyesi doğrudan banka hesabına çekilemez. İki yönlü CS2 arbitrajı, bu fiyat makasını (spread) 14 günlük disiplinli döngüyle gerçek nakit kârına çevirir.',
    'acad.s1.num': 'ADIM 01 • GÜN 0',
    'acad.s1.t': 'Yüksek Makaslı Alım (1. Yön)',
    'acad.s1.d': 'CSFloat (%0 alış) veya Youpin898\'de Steam\'e göre iskontolu, hızlı satılan CS2 kasaları veya skinler nakitle alınır.',
    'acad.s2.num': 'ADIM 02 • GÜN 0–7',
    'acad.s2.t': '7 Gün Valve Trade Protection',
    'acad.s2.d': 'Valve\'ın Temmuz 2025 kuralına göre takasla gelen eşyalar 7 gün koruma altındadır ve pazarda satılamaz.',
    'acad.s3.num': 'ADIM 03 • GÜN 7',
    'acad.s3.t': 'Steam Satışı & Dönüş Eşyası',
    'acad.s3.d': 'Eşyalar Steam\'de satılarak bakiye büyütülür (M₁), ardından makası dar likit skin (AK-47 Redline, Printstream vb.) alınır.',
    'acad.s4.num': 'ADIM 04 • GÜN 14',
    'acad.s4.t': 'Nakit Dönüş & Bileşik Döngü',
    'acad.s4.d': 'İkinci 7 günlük kilit açıldığında CSFloat (%2) veya Youpin898 (%1) ile nakde dönülür. M₁ × M₂ > 1.00 ise kâr devredilir.',
    'acad.labBadge': 'GERÇEK ORAN LABORATUVARI',
    'acad.labTitle': 'Steam $0.01 + $0.01 Minimum Komisyon Tuzağı',
    'acad.labDesc': 'Çoğu hesaplayıcı Steam komisyonunu düz ÷ 1.15 (%13.04) sayar. Oysa Valve her satışta en az $0.01 Steam + $0.01 CS2 kesintisi uygular; ucuz eşyalarda kesinti %66,7\'ye çıkar.',
    'acad.labNet': 'Gerçek Net Ele Geçen',
    'acad.labEff': 'Gerçek Efektif Kesinti',
    'acad.labDiff': '÷1.15 Farkı',
    'acad.cmpBadge': 'PAZAR KARŞILAŞTIRMASI',
    'acad.cmpTitle': 'CSFloat vs Youpin898 (2025/2026 Gerçek Oranlar)',

    // About & Trust Page
    'about.badge': 'ŞEFFAFLIK & MİMARİ • SPREAD.HAKING.TR',
    'about.h2': 'SPREAD Arka Planda Nasıl Çalışır ve Neden Güvenebilirsiniz?',
    'about.lead': 'SPREAD, sıfır girişli, tamamen açık kaynaklı ve yerel öncelikli bir CS2 kantitatif arbitraj terminalidir. Hiçbir hesap bilgisi istemez; tüm matematik ve veri kaynakları şeffaf biçimde doğrulanabilir.',
    'about.trustTitle': 'SPREAD\'e Neden Güvenebilirsiniz?',
    'about.t1.t': 'Sıfır Hesap Girişi & Sıfır API Anahtarı',
    'about.t1.d': 'Steam girişi, Steam Guard, takas linki, CSFloat API anahtarı veya tarayıcı eklentisi ASLA istenmez. Envanterinize hiçbir erişim yoktur.',
    'about.t2.t': '%100 Yerel Tarayıcı Kasası',
    'about.t2.d': 'Tüm aktif döngüleriniz, favorileriniz ve özel fiyatlarınız yalnızca kendi cihazınızda (localStorage) tutulur; SHA-256 doğrulamalı JSON ile yedeklenir.',
    'about.t3.t': 'Katı CSP & Sıfır XSS Güvenliği',
    'about.t3.d': 'Sıfır harici 3. parti JS kütüphanesi, sıfır inline script, sıfır innerHTML kullanımı, katı Content-Security-Policy ve GitHub\'da MIT açık kaynak kodu.',
    'about.t4.t': 'Gerçek Satış Hızı & Anomali Koruması',
    'about.t4.d': 'Ölü kapsül veya manipüle edilmiş fiyatları öneren basit tabloların aksine 24s/7g/30g satış hacmini, Bid/Ask derinliğini ve 90g fiyat geçmişini çapraz doğrular.',
    'about.pipeTitle': 'Canlı Çok Kaynaklı Veri Hattı (Cloudflare Edge)',
    'about.pipeDesc': 'Açık kaynaklı Cloudflare Worker\'ımız 5 dakikada bir 5 bağımsız genel piyasa kaynağını 4.500 eşyalık matriste birleştirir ve seçili eşyalar için anlık Steam 24s doğrulaması yapar:',
    'about.mathTitle': 'Kantitatif Motor Özellikleri',

    // Filter Guide Modal
    'fguide.title': 'ⓘ Strateji Filtreleri ve Güven Skoru Rehberi',
    'fguide.intro': 'CS2 arbitrajında yeni misin? Strateji Danışmanı\'ndaki her filtrenin ve skorun ne işe yaradığını sade şekilde aşağıda görebilirsin:',

    // Command Palette, Share, Support, Vault & Footer
    'cmd.title': '⌕ CS2 Skin & Fiyat Aralığı Arama',
    'cmd.ph': 'İsimle ara (örn: ak red ft, printstream) veya boş bırakıp Min/Maks fiyatla en kârlıları listele...',
    'cmd.minPh': 'Min fiyat',
    'cmd.maxPh': 'Maks fiyat',
    'cmd.reset': 'Sıfırla',
    'cmd.hint': 'Yüksek bütçeye uygun sonuçlar için Min $50 seçin',
    'share.title': '↗ Bu Arbitraj Kurulumunu Paylaş',
    'share.lbl': 'Doğrudan Paylaşım Linki (Arkadaşın açınca birebir bu kurulum yüklenir)',
    'share.copy': 'Kopyala',
    'share.copySummary': '📋 Discord / Özet Metni Kopyala',
    'support.title': '☕ SPREAD\'i Destekle & İletişim',
    'support.desc': 'SPREAD (spread.haking.tr) ücretsiz, reklamsız ve açık kaynaklıdır. Canlı altyapı ve yeni özelliklere gönüllü destek olmak istersen:',
    'support.coffeeTag': 'FİNANSAL DESTEK',
    'support.coffeeDesc': 'Geliştiriciye bir kahve ısmarlayarak canlı sunucu ve geliştirme sürecine katkıda bulun.',
    'support.steamTag': 'CS2 SKİN / KASA',
    'support.steamTitle': 'Steam Takasla Destekle',
    'support.steamDesc': 'İstersen doğrudan Steam takas teklifi üzerinden kasa, çıkartma veya skin ile destek olabilirsin.',
    'support.steamBtn': '⇄ Steam Takas Teklifi Gönder ↗',
    'support.mailLbl': 'Resmi Destek & Güvenlik E-postası',
    'support.copyMail': 'Adresi Kopyala',
    'support.sendMail': '✉ Mail Gönder',
    'vault.title': '⛁ Yerel Veri Kasası — JSON Yedekleme & Geri Yükleme',
    'vault.desc': 'Tüm döngüleriniz, favorileriniz ve özel fiyatlarınız yalnızca kendi tarayıcınızda (localStorage) saklanır; hiçbir sunucuya gönderilmez. SHA-256 doğrulamalı JSON yedeği alabilirsiniz.',
    'vault.exportJson': '↓ Tam JSON Yedeği İndir (.json)',
    'vault.exportCsv': '↓ Döngü Defteri İndir (.csv)',
    'vault.importJson': '↑ JSON Yedeği Yükle',
    'vault.danger': 'Tehlikeli Alan: Bu tarayıcıdaki tüm SPREAD kayıtlarını kalıcı olarak temizler.',
    'vault.clear': 'Tüm Yerel Verileri Temizle',
    'footer.desc': '%100 tarayıcı içi yerel depolamalı, açık kaynaklı CS2 iki yönlü arbitraj terminali. Steam girişi istemez. Valve Corporation, Steam, CSFloat veya Youpin898 ile resmi bağlantısı yoktur.',
    'footer.contact': 'Destek & İletişim',
    'footer.contactDesc': 'Hata bildirimi, özellik önerisi veya iş birliği:',
    'footer.supportTitle': 'Geliştiriciyi Destekle',
    'footer.supportDesc': 'SPREAD ücretsiz ve açık kaynaklıdır. Sunucu & geliştirme desteği:',
    'footer.supportBtn': 'Destek Detayları',
    'footer.steamBtn': '⇄ Steam Takasla Destekle',
    'footer.disclaimer': 'Yatırım tavsiyesi değildir — CS2 piyasa fiyatları anlık değişebilir.',
    'cat.ALL': 'Tüm Kategoriler',
    'cat.Case': 'Kasa (Case)',
    'cat.Rifles': 'Tüfekler',
    'cat.Pistols': 'Tabancalar',
    'cat.SMGs': 'SMG',
    'cat.Heavy': 'Ağır Silahlar',
    'cat.Knives': 'Bıçaklar',
    'cat.Gloves': 'Eldivenler',
    'cat.Agent': 'Ajanlar',
    'cat.Capsule': 'Kapsüller',
    'sort.AUTO': 'Otomatik',
    'sort.LEG1_DESC': '1. Yön En Kârlı %',
    'sort.LEG2_ASC': '2. Yön En Az Kayıp %',
    'sort.SPEED_DESC': 'En Hızlı Satılan',
    'sort.QTY_DESC': 'En Yüksek İlan',
    'sort.PRICE_ASC': 'Fiyat: Artan',
    'sort.PRICE_DESC': 'Fiyat: Azalan',
    'modal.completeTitle': '✓ Döngüyü Tamamla & Gerçekleşen Kârı İşle',
    'modal.actualEndLbl': 'Elinize Geçen Gerçek Net Tutar',
    'modal.noteLbl': 'Not (Opsiyonel)',
    'modal.notePh': 'Örn: CSFloat buy order ile hızlı satıldı',
    'modal.cancel': 'İptal',
    'modal.saveLedger': 'Deftere Kaydet',
    'custom.name': 'Eşya Adı',
    'custom.mktPrice': 'Pazar Fiyatı',
    'custom.steamPrice': 'Steam Fiyatı',
    'custom.save': 'Kaydet',
    'bulk.fillSample': 'Örnek CSV Doldur',
    'bulk.importBtn': 'Listeye Aktar'
  }
};

let currentLang = 'en';

export function detectInitialLanguage() {
  try {
    const params = new URLSearchParams(window.location.search);
    const qLang = (params.get('lang') || '').toLowerCase();
    if (qLang === 'tr' || qLang === 'en') {
      localStorage.setItem(LANG_STORAGE_KEY, qLang);
      currentLang = qLang;
      return currentLang;
    }
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === 'tr' || saved === 'en') {
      currentLang = saved;
      return currentLang;
    }
    const browserLangs = navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language || 'en'];
    const primary = String(browserLangs[0] || 'en').toLowerCase();
    currentLang = primary.startsWith('tr') ? 'tr' : 'en';
    return currentLang;
  } catch {
    currentLang = 'en';
    return currentLang;
  }
}

export function getLang() {
  return currentLang;
}

export function setLang(lang, persist = true) {
  currentLang = lang === 'tr' ? 'tr' : 'en';
  if (persist) {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, currentLang);
    } catch {
      // ignore
    }
  }
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', currentLang);
    applyStaticTranslations();
  }
  return currentLang;
}

export function t(key, fallback = '') {
  return DICT[currentLang]?.[key] ?? DICT.en?.[key] ?? fallback ?? key;
}

export function isTr() {
  return currentLang === 'tr';
}

export function applyStaticTranslations() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const k = node.getAttribute('data-i18n');
    const val = t(k);
    if (val) node.textContent = val;
  });
  document.querySelectorAll('[data-i18n-ph]').forEach((node) => {
    const k = node.getAttribute('data-i18n-ph');
    const val = t(k);
    if (val) node.setAttribute('placeholder', val);
  });
  document.querySelectorAll('[data-i18n-tip]').forEach((node) => {
    const k = node.getAttribute('data-i18n-tip');
    const val = t(k);
    if (val) node.setAttribute('data-tip', val);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((node) => {
    const k = node.getAttribute('data-i18n-title');
    const val = t(k);
    if (val) node.setAttribute('title', val);
  });
  document.querySelectorAll('[data-lang-btn]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.langBtn === currentLang);
  });
  // Show/hide rich localized prose blocks (like detailed bilingual Academy/About/Filter Guide lists)
  document.querySelectorAll('[data-lang-only]').forEach((el) => {
    el.classList.toggle('hidden', el.getAttribute('data-lang-only') !== currentLang);
  });
}
