/**
 * SPREAD (spread.haking.tr) — Main Application Orchestrator
 * Includes Clean History API Routing (/ , /tarayici, /takip, /akademi) & Shareable Deep-Links.
 */

import { MARKETPLACES } from './core/config.js';
import { el } from './core/security.js';
import { evaluateItemMetrics, findOptimalPairs } from './core/math-engine.js';
import { detectInitialLanguage, isTr, setLang, t } from './core/i18n.js';
import {
  parseSharedSetupFromUrl,
  resolveTabFromPathname,
  syncUrlForTab
} from './core/router-share.js';
import { MarketService } from './services/market-api.js';
import { Vault } from './services/vault-storage.js';
import { initCommandPalette, renderLiveTicker } from './views/header-ticker.js';
import { initCalculatorView } from './views/calculator-view.js';
import { initScannerView } from './views/scanner-view.js';
import { initTrackerView } from './views/tracker-view.js';
import { initAcademyView } from './views/academy-view.js';
import { initAboutView } from './views/about-view.js';
import { initVaultModal } from './views/vault-modal.js';
import { initShareAndSupportModals } from './views/share-support-modals.js';

class SpreadApp {
  constructor() {
    this.market = new MarketService();
    this.settings = Vault.loadSettings();
    this.cycles = Vault.loadCycles();
    this.customItems = Vault.loadCustomItems();
    this.watchlist = Vault.loadWatchlist();
    this.items = [];
    this.itemIndex = new Map();
    this.activeTab = 'calculator';
    this.latestMetrics = null;

    this.views = {};
    this.cmdPalette = null;
    this.vaultModal = null;
    this.shareSupport = null;
  }

  toast(message, kind = 'ok') {
    const host = document.getElementById('toastHost');
    if (!host) return;
    const node = el(
      'div',
      { className: `toast ${kind === 'warn' ? 'is-warn' : kind === 'err' ? 'is-err' : ''}` },
      el('span', { className: 'toast-dot' }),
      el('span', null, message)
    );
    host.appendChild(node);
    setTimeout(() => {
      node.style.opacity = '0';
      node.style.transition = 'opacity 180ms ease';
      setTimeout(() => node.remove(), 200);
    }, 3200);
  }

  rebuildItemIndex() {
    this.itemIndex.clear();
    for (const item of this.items) {
      this.itemIndex.set(item.n.toLowerCase(), item);
    }
  }

  findItemByName(name) {
    if (!name) return null;
    return this.itemIndex.get(name.toLowerCase().trim()) || null;
  }

  saveSettings() {
    Vault.saveSettings(this.settings);
  }

  saveCycles() {
    Vault.saveCycles(this.cycles);
  }

  reloadFromVault() {
    const theme = Vault.loadTheme();
    document.documentElement.setAttribute('data-theme', theme);
    this.settings = Vault.loadSettings();
    this.cycles = Vault.loadCycles();
    this.customItems = Vault.loadCustomItems();
    this.watchlist = Vault.loadWatchlist();
    this.items = this.market.rebuildWithCustomItems(this.customItems);
    this.rebuildItemIndex();
    this.syncHeaderControls();
    this.renderAll();
  }

  openCommandPalette(legHint = null, presetMinUsd = null) {
    this.cmdPalette?.open(legHint, presetMinUsd);
  }

  switchTab(tabName, opts = {}) {
    const { updateHistory = true, replaceHistory = false } = opts;
    this.activeTab = tabName;

    document.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.view-panel').forEach((panel) => {
      panel.classList.toggle('hidden', panel.id !== `view-${tabName}`);
    });

    if (updateHistory) {
      syncUrlForTab(tabName, replaceHistory);
    }

    if (tabName === 'calculator') this.views.calculator?.render();
    if (tabName === 'scanner') this.views.scanner?.render();
    if (tabName === 'tracker') this.views.tracker?.render();
    if (tabName === 'academy') this.views.academy?.render();
    if (tabName === 'about') this.views.about?.render();
  }

  applyItemToLeg(item, legNum) {
    const s = this.settings;
    const m = evaluateItemMetrics(item, {
      marketplace: s.marketplace,
      buyFeePct: s.buyFeePct,
      sellFeePct: s.sellFeePct,
      withdrawFeePct: s.withdrawFeePct,
      steamFeeMode: s.steamFeeMode,
      steamCustomFeePct: s.steamCustomFeePct,
      useBuyOrderForLeg2: s.useBuyOrderForLeg2,
      conservativeSteamPrice: s.conservativeSteamPrice
    });

    if (legNum === 1) {
      s.leg1 = {
        name: item.n,
        marketUsd: m.marketBuyUsd,
        steamUsd: m.steamUsd
      };
    } else {
      s.leg2 = {
        name: item.n,
        steamUsd: m.steamUsd,
        marketUsd: m.marketSellUsd
      };
    }

    this.saveSettings();
    this.switchTab('calculator');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    this.toast(isTr() ? `"${item.n}" ${legNum}. Yöne aktarıldı.` : `"${item.n}" loaded into Leg ${legNum}.`);
  }

  applyPair(item1, item2, m1, m2) {
    this.settings.leg1 = {
      name: item1.n,
      marketUsd: m1.marketBuyUsd,
      steamUsd: m1.steamUsd
    };
    this.settings.leg2 = {
      name: item2.n,
      steamUsd: m2.steamUsd,
      marketUsd: m2.marketSellUsd
    };
    this.saveSettings();
    this.switchTab('calculator');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    this.toast(isTr() ? `Strateji uygulandı: ${item1.n} → ${item2.n}` : `Strategy applied: ${item1.n} → ${item2.n}`);
  }

  toggleWatchlist(itemName) {
    const idx = this.watchlist.indexOf(itemName);
    if (idx >= 0) {
      this.watchlist.splice(idx, 1);
      this.toast(isTr() ? `"${itemName}" izleme listesinden çıkarıldı.` : `Removed "${itemName}" from watchlist.`);
    } else {
      this.watchlist.unshift(itemName);
      this.toast(isTr() ? `"${itemName}" izleme listesine eklendi.` : `Added "${itemName}" to watchlist.`);
    }
    Vault.saveWatchlist(this.watchlist);
    this.views.scanner?.render();
  }

  addCustomItems(newItems) {
    this.customItems = [...newItems, ...this.customItems];
    Vault.saveCustomItems(this.customItems);
    this.items = this.market.rebuildWithCustomItems(this.customItems);
    this.rebuildItemIndex();
    this.renderAll();
    this.toast(isTr() ? `${newItems.length} özel eşya yerel kasaya eklendi.` : `Added ${newItems.length} custom item(s) to local vault.`);
  }

  deleteCustomItem(customId) {
    this.customItems = this.customItems.filter((x) => x.id !== customId);
    Vault.saveCustomItems(this.customItems);
    this.items = this.market.rebuildWithCustomItems(this.customItems);
    this.rebuildItemIndex();
    this.renderAll();
    this.toast(isTr() ? 'Özel eşya silindi.' : 'Custom item removed.');
  }

  createTrackedCycleFromCalculator() {
    const d = this.latestMetrics;
    if (!d || d.capitalUsd <= 0) {
      this.toast(isTr() ? 'Takibe almak için geçerli bir sermaye girin.' : 'Enter a valid starting capital first.', 'warn');
      return;
    }

    const s = this.settings;
    const c1 = d.firstCycle;
    const item1 = this.findItemByName(s.leg1.name);
    const item2 = this.findItemByName(s.leg2.name);
    const nowIso = new Date().toISOString();

    this.cycles.unshift({
      id: `cyc-${Date.now()}`,
      marketplace: s.marketplace,
      capitalUsd: Math.round(d.capitalUsd * 100) / 100,
      item1Name: s.leg1.name,
      item1Img: item1?.img || '',
      qty1: c1.q1,
      item2Name: s.leg2.name,
      item2Img: item2?.img || '',
      qty2: c1.q2,
      expectedEndUsd: Math.round(c1.cashEquivPortfolio * 100) / 100,
      expectedProfitUsd: Math.round(c1.netProfit * 100) / 100,
      expectedRoiPct: Math.round(c1.netRoiPct * 100) / 100,
      actualEndUsd: null,
      actualProfitUsd: null,
      note: '',
      phase: 1,
      phaseStartedAt: nowIso,
      cycleStartedAt: nowIso,
      completedAt: null
    });

    this.saveCycles();
    this.switchTab('tracker');
    this.toast(isTr() ? 'Döngü Faz 1 (Gün 0–7) olarak takibe alındı.' : 'Cycle added to Tracker (Phase 1 • Day 0–7).');
  }

  loadSampleCycles() {
    const now = Date.now();
    const hour = 3600 * 1000;
    const rev = this.findItemByName('Revolution Case');
    const red = this.findItemByName('AK-47 | Redline (Field-Tested)');
    const kw = this.findItemByName('Kilowatt Case');
    const awp = this.findItemByName('AWP | Asiimov (Field-Tested)');
    const tr = isTr();

    this.cycles = [
      {
        id: `cyc-demo-${Date.now()}-1`,
        marketplace: 'CSFLOAT',
        capitalUsd: 200,
        item1Name: rev?.n || 'Revolution Case',
        item1Img: rev?.img || '',
        qty1: 350,
        item2Name: red?.n || 'AK-47 | Redline (Field-Tested)',
        item2Img: red?.img || '',
        qty2: 11,
        expectedEndUsd: 244.8,
        expectedProfitUsd: 44.8,
        expectedRoiPct: 22.4,
        actualEndUsd: null,
        actualProfitUsd: null,
        note: tr ? 'Örnek aktif Faz 1 döngüsü' : 'Sample active Phase 1 cycle',
        phase: 1,
        phaseStartedAt: new Date(now - 134 * hour).toISOString(),
        cycleStartedAt: new Date(now - 134 * hour).toISOString(),
        completedAt: null
      },
      {
        id: `cyc-demo-${Date.now()}-2`,
        marketplace: 'CSFLOAT',
        capitalUsd: 350,
        item1Name: kw?.n || 'Kilowatt Case',
        item1Img: kw?.img || '',
        qty1: 420,
        item2Name: awp?.n || 'AWP | Asiimov (Field-Tested)',
        item2Img: awp?.img || '',
        qty2: 4,
        expectedEndUsd: 432.5,
        expectedProfitUsd: 82.5,
        expectedRoiPct: 23.57,
        actualEndUsd: null,
        actualProfitUsd: null,
        note: tr ? 'Örnek aktif Faz 2 dönüş döngüsü' : 'Sample active Phase 2 cashout cycle',
        phase: 2,
        phaseStartedAt: new Date(now - 88 * hour).toISOString(),
        cycleStartedAt: new Date(now - 256 * hour).toISOString(),
        completedAt: null
      }
    ];

    this.saveCycles();
    this.views.tracker?.render();
    this.toast(tr ? 'Örnek 2 fazlı CSFloat döngüleri yüklendi.' : 'Sample 2-phase CSFloat cycles loaded.');
  }

  exportCyclesCsv() {
    if (this.cycles.length === 0) {
      this.toast(isTr() ? 'Dışa aktarılacak döngü kaydı yok.' : 'No tracked cycles to export.', 'warn');
      return;
    }
    const csv = Vault.buildCyclesCsv(this.cycles);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spread-cycles-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.toast(isTr() ? 'Döngü defteri CSV olarak indirildi.' : 'Cycle ledger exported as CSV.');
  }

  syncHeaderControls() {
    const s = this.settings;
    document.querySelectorAll('[data-marketplace]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.marketplace === s.marketplace);
    });
    document.querySelectorAll('[data-currency]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.currency === s.currency);
    });

    const buyInp = document.getElementById('buyFeeInput');
    const sellInp = document.getElementById('sellFeeInput');
    const wInp = document.getElementById('withdrawFeeInput');
    const stInp = document.getElementById('steamFeeCustomInput');
    const stBtn = document.getElementById('steamFeeModeBtn');

    if (buyInp) buyInp.value = String(s.buyFeePct);
    if (sellInp) sellInp.value = String(s.sellFeePct);
    if (wInp) wInp.value = String(s.withdrawFeePct);
    if (stInp) stInp.value = String(s.steamCustomFeePct);
    if (stBtn) {
      if (s.steamFeeMode === 'EXACT_VALVE') {
        stBtn.textContent = 'Valve Cent';
        stBtn.className = 'fee-mode-pill';
      } else if (s.steamFeeMode === 'DIV_115') {
        stBtn.textContent = '÷ 1.15';
        stBtn.className = 'fee-mode-pill';
      } else {
        stBtn.textContent = isTr() ? 'Özel %' : 'Custom %';
        stBtn.className = 'fee-mode-pill is-custom';
      }
    }
  }

  wireHeaderControls() {
    // Brand logo click -> Home /
    document.getElementById('brandHomeLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.switchTab('calculator');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Language Switcher (EN default / TR auto-detect + persisted user choice)
    document.querySelectorAll('[data-lang-btn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextLang = btn.dataset.langBtn;
        setLang(nextLang, true);
        this.syncHeaderControls();
        syncUrlForTab(this.activeTab, true);
        this.renderAll();
        this.toast(nextLang === 'tr' ? 'Dil Türkçe olarak kaydedildi.' : 'Language saved as English.');
      });
    });

    // Marketplace selector (CSFloat primary / Youpin898 optional)
    document.querySelectorAll('[data-marketplace]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextMkt = btn.dataset.marketplace;
        if (!MARKETPLACES[nextMkt] || nextMkt === this.settings.marketplace) return;
        this.settings.marketplace = nextMkt;
        this.settings.buyFeePct = MARKETPLACES[nextMkt].defaultBuyFee;
        this.settings.sellFeePct = MARKETPLACES[nextMkt].defaultSellFee;

        const l1Item = this.findItemByName(this.settings.leg1.name);
        const l2Item = this.findItemByName(this.settings.leg2.name);
        const evalOpts = {
          marketplace: nextMkt,
          buyFeePct: this.settings.buyFeePct,
          sellFeePct: this.settings.sellFeePct,
          withdrawFeePct: this.settings.withdrawFeePct,
          steamFeeMode: this.settings.steamFeeMode,
          steamCustomFeePct: this.settings.steamCustomFeePct,
          useBuyOrderForLeg2: this.settings.useBuyOrderForLeg2,
          conservativeSteamPrice: this.settings.conservativeSteamPrice
        };
        if (l1Item) {
          const m = evaluateItemMetrics(l1Item, evalOpts);
          if (m.marketBuyUsd > 0) this.settings.leg1.marketUsd = m.marketBuyUsd;
        }
        if (l2Item) {
          const m = evaluateItemMetrics(l2Item, evalOpts);
          if (m.marketSellUsd > 0) this.settings.leg2.marketUsd = m.marketSellUsd;
        }

        this.saveSettings();
        this.syncHeaderControls();
        this.renderAll();
        this.toast(
          isTr()
            ? `Aktif pazar: ${MARKETPLACES[nextMkt].name} (Satış komisyonu %${this.settings.sellFeePct})`
            : `Marketplace switched to ${MARKETPLACES[nextMkt].name} (${this.settings.sellFeePct}% sell fee)`
        );
      });
    });

    // Currency selector
    document.querySelectorAll('[data-currency]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cur = btn.dataset.currency;
        if (!cur || cur === this.settings.currency) return;
        this.settings.currency = cur;
        this.saveSettings();
        this.syncHeaderControls();
        this.renderAll();
        this.toast(isTr() ? `Para birimi ${cur} olarak güncellendi.` : `Display currency updated to ${cur}.`);
      });
    });

    // Nav Tabs (supports clean anchor links with preventDefault for SPA speed)
    document.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.switchTab(btn.dataset.tab);
      });
    });

    // Browser Back / Forward navigation
    window.addEventListener('popstate', () => {
      const tab = resolveTabFromPathname(window.location.pathname);
      this.switchTab(tab, { updateHistory: false });
    });

    // Fee Inputs
    document.getElementById('buyFeeInput')?.addEventListener('input', (e) => {
      this.settings.buyFeePct = Math.max(0, Math.min(50, parseFloat(e.target.value) || 0));
      this.saveSettings();
      this.renderAll();
    });

    document.getElementById('sellFeeInput')?.addEventListener('input', (e) => {
      this.settings.sellFeePct = Math.max(0, Math.min(50, parseFloat(e.target.value) || 0));
      this.saveSettings();
      this.renderAll();
    });

    document.getElementById('withdrawFeeInput')?.addEventListener('input', (e) => {
      this.settings.withdrawFeePct = Math.max(0, Math.min(30, parseFloat(e.target.value) || 0));
      this.saveSettings();
      this.renderAll();
    });

    document.getElementById('steamFeeCustomInput')?.addEventListener('input', (e) => {
      this.settings.steamCustomFeePct = Math.max(0, Math.min(50, parseFloat(e.target.value) || 0));
      this.settings.steamFeeMode = 'CUSTOM';
      this.saveSettings();
      this.syncHeaderControls();
      this.renderAll();
    });

    document.getElementById('steamFeeModeBtn')?.addEventListener('click', () => {
      const order = ['EXACT_VALVE', 'DIV_115', 'CUSTOM'];
      const next = order[(order.indexOf(this.settings.steamFeeMode) + 1) % order.length];
      this.settings.steamFeeMode = next;
      this.saveSettings();
      this.syncHeaderControls();
      this.renderAll();
      const labels = isTr()
        ? {
            EXACT_VALVE: 'Gerçek Valve Cent Hesabı ($0.01 taban kesinti dahil)',
            DIV_115: 'Klasik ÷ 1.15 Oransal Formül',
            CUSTOM: 'Özel Steam Komisyon Yüzdesi'
          }
        : {
            EXACT_VALVE: 'Exact Valve Cent Solver (incl. $0.01 floor fees)',
            DIV_115: 'Classic ÷ 1.15 Flat Proportional Formula',
            CUSTOM: 'Custom Steam Fee Percentage'
          };
      this.toast(isTr() ? `Steam kesinti modu: ${labels[next]}` : `Steam fee mode: ${labels[next]}`);
    });

    // Theme toggle
    document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      const next = current === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      Vault.saveTheme(next);
      this.views.calculator?.render();
    });

    // Manual Live Sync Button
    document.getElementById('syncLiveBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('syncLiveBtn');
      btn.disabled = true;
      btn.textContent = t('hdr.refreshing');
      try {
        const res = await this.market.syncLive(this.customItems, true);
        this.items = res.items;
        this.rebuildItemIndex();
        this.renderAll();
        if (res.marketUpdated) {
          this.toast(
            isTr()
              ? `Canlı fiyatlar yenilendi (${this.items.length.toLocaleString('tr-TR')} eşya).`
              : `Live market prices refreshed (${this.items.length.toLocaleString('en-US')} items).`
          );
        } else {
          this.toast(
            isTr() ? 'Canlı API şu an ulaşılamıyor; yerel önbellek aktif.' : 'Live API temporarily unavailable; local cache active.',
            'warn'
          );
        }
      } catch {
        this.toast(isTr() ? 'Canlı senkronizasyon başarısız oldu.' : 'Live refresh failed.', 'warn');
      } finally {
        btn.disabled = false;
        btn.textContent = t('hdr.refresh');
      }
    });

    // Global Keyboard Shortcuts (Ctrl+K, /, 1-4, Esc)
    document.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.openCommandPalette(null);
        return;
      }
      if (e.key === 'Escape') {
        this.cmdPalette?.close();
        this.vaultModal?.close();
        this.shareSupport?.closeShare();
        this.shareSupport?.closeSupport();
        this.shareSupport?.closeFilterGuide();
        document.getElementById('completeCycleModal')?.classList.add('hidden');
        return;
      }
      if (!inInput) {
        if (e.key === '/') {
          e.preventDefault();
          this.openCommandPalette(null);
        } else if (e.key === '1') {
          this.switchTab('calculator');
        } else if (e.key === '2') {
          this.switchTab('scanner');
        } else if (e.key === '3') {
          this.switchTab('tracker');
        } else if (e.key === '4') {
          this.switchTab('academy');
        } else if (e.key === '5') {
          this.switchTab('about');
        }
      }
    });
  }

  hydrateDefaultPairIfEmpty() {
    const s = this.settings;
    if (s.leg1.marketUsd > 0 && s.leg1.steamUsd > 0 && s.leg2.steamUsd > 0 && s.leg2.marketUsd > 0) {
      return;
    }

    const pairs = findOptimalPairs(
      this.items,
      {
        marketplace: s.marketplace,
        buyFeePct: s.buyFeePct,
        sellFeePct: s.sellFeePct,
        withdrawFeePct: s.withdrawFeePct,
        steamFeeMode: s.steamFeeMode,
        steamCustomFeePct: s.steamCustomFeePct,
        useBuyOrderForLeg2: s.useBuyOrderForLeg2,
        conservativeSteamPrice: s.conservativeSteamPrice
      },
      s.capitalUsd
    );

    if (pairs.length > 0) {
      const best = pairs[0];
      s.leg1 = {
        name: best.leg1.item.n,
        marketUsd: best.leg1.m.marketBuyUsd,
        steamUsd: best.leg1.m.steamUsd
      };
      s.leg2 = {
        name: best.leg2.item.n,
        steamUsd: best.leg2.m.steamUsd,
        marketUsd: best.leg2.m.marketSellUsd
      };
    } else {
      const rev = this.findItemByName('Revolution Case') || this.items[0];
      const red = this.findItemByName('AK-47 | Redline (Field-Tested)') || this.items[1];
      if (rev) {
        s.leg1 = { name: rev.n, marketUsd: rev.cf || rev.yp || 0.5, steamUsd: rev.s || 0.8 };
      }
      if (red) {
        s.leg2 = { name: red.n, steamUsd: red.s || 20, marketUsd: red.cf || red.yp || 18.2 };
      }
    }
    this.saveSettings();
  }

  renderAll() {
    const tasks = [
      ['ticker', () => renderLiveTicker(this)],
      ['calculator', () => this.views.calculator?.render()],
      ['scanner', () => this.views.scanner?.render()],
      ['tracker', () => this.views.tracker?.render()],
      ['academy', () => this.views.academy?.render()],
      ['about', () => this.views.about?.render()]
    ];
    for (const [name, fn] of tasks) {
      try {
        fn();
      } catch (err) {
        console.error(`[SPREAD] View render error (${name}):`, err);
      }
    }
  }

  async boot() {
    // 0. Language resolution: ?lang > localStorage > navigator (TR -> tr, others -> en)
    const initialLang = detectInitialLanguage();
    setLang(initialLang, false);

    this.cmdPalette = initCommandPalette(this);
    this.vaultModal = initVaultModal(this);
    this.shareSupport = initShareAndSupportModals(this);
    this.views.calculator = initCalculatorView(this);
    this.views.scanner = initScannerView(this);
    this.views.tracker = initTrackerView(this);
    this.views.academy = initAcademyView();
    this.views.about = initAboutView(this);

    this.wireHeaderControls();

    // Check for incoming shared deep-link setup (/?l1=...&l2=...)
    const sharedSetup = parseSharedSetupFromUrl(window.location.search);
    if (sharedSetup) {
      this.settings = { ...this.settings, ...sharedSetup };
      this.saveSettings();
      this.activeTab = 'calculator';
      const banner = document.getElementById('sharedLoadedBanner');
      banner?.classList.remove('hidden');
      document.getElementById('dismissSharedBannerBtn')?.addEventListener('click', () => {
        banner?.classList.add('hidden');
        window.history.replaceState({ tab: 'calculator' }, '', '/');
      });
    } else {
      this.activeTab = resolveTabFromPathname(window.location.pathname);
    }

    this.syncHeaderControls();

    // 1. Instant boot from bundled ByMykel catalog + fresh snapshot (strictly isolated from UI rendering)
    let catalogLoaded = false;
    try {
      this.items = await this.market.loadInitial(this.customItems);
      this.rebuildItemIndex();
      this.hydrateDefaultPairIfEmpty();
      catalogLoaded = true;
    } catch (err) {
      console.error('[SPREAD] Initial catalog load failed:', err);
      this.toast(
        isTr()
          ? 'Piyasa kataloğu yüklenemedi. Sayfayı yenileyin veya "Canlı Yenile"ye basın.'
          : 'Market catalog could not load. Please refresh the page or click "Refresh Live".',
        'warn'
      );
    }

    try {
      this.switchTab(this.activeTab, { updateHistory: true, replaceHistory: true });
      this.renderAll();
      if (catalogLoaded && sharedSetup) {
        this.toast(isTr() ? 'Paylaşılan arbitraj kurulumu yüklendi!' : 'Shared arbitrage setup loaded!');
      }
    } catch (err) {
      console.error('[SPREAD] Initial render error:', err);
    }

    // 2. Non-blocking live API upgrade (/api/market + /api/fx)
    this.market
      .syncLive(this.customItems, false)
      .then((res) => {
        if (res.marketUpdated || res.fxRates) {
          this.items = res.items;
          this.rebuildItemIndex();
          this.renderAll();
        }
      })
      .catch(() => {
        // Silent graceful fallback to snapshot
      });

    // 3. Non-destructive 1-second countdown ticker for Tracker view
    setInterval(() => {
      this.views.tracker?.tickCountdowns();
    }, 1000);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new SpreadApp();
  app.boot();
});
