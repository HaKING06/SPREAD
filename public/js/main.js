/**
 * SPREAD (spread.haking.tr) — Main Application Orchestrator
 * Includes Clean History API Routing (/ , /tarayici, /takip, /akademi) & Shareable Deep-Links.
 */

import { MARKETPLACES } from './core/config.js';
import { el } from './core/security.js';
import { evaluateItemMetrics, findOptimalPairs } from './core/math-engine.js';
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
    this.toast(`"${item.n}" ${legNum}. Yöne aktarıldı.`);
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
    this.toast(`Strateji uygulandı: ${item1.n} → ${item2.n}`);
  }

  toggleWatchlist(itemName) {
    const idx = this.watchlist.indexOf(itemName);
    if (idx >= 0) {
      this.watchlist.splice(idx, 1);
      this.toast(`"${itemName}" izleme listesinden çıkarıldı.`);
    } else {
      this.watchlist.unshift(itemName);
      this.toast(`"${itemName}" izleme listesine eklendi.`);
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
    this.toast(`${newItems.length} özel eşya yerel kasaya eklendi.`);
  }

  deleteCustomItem(customId) {
    this.customItems = this.customItems.filter((x) => x.id !== customId);
    Vault.saveCustomItems(this.customItems);
    this.items = this.market.rebuildWithCustomItems(this.customItems);
    this.rebuildItemIndex();
    this.renderAll();
    this.toast('Özel eşya silindi.');
  }

  createTrackedCycleFromCalculator() {
    const d = this.latestMetrics;
    if (!d || d.capitalUsd <= 0) {
      this.toast('Takibe almak için geçerli bir sermaye girin.', 'warn');
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
    this.toast('Döngü Faz 1 (Gün 0–7) olarak takibe alındı.');
  }

  loadSampleCycles() {
    const now = Date.now();
    const hour = 3600 * 1000;
    const rev = this.findItemByName('Revolution Case');
    const red = this.findItemByName('AK-47 | Redline (Field-Tested)');
    const kw = this.findItemByName('Kilowatt Case');
    const awp = this.findItemByName('AWP | Asiimov (Field-Tested)');

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
        note: 'Örnek aktif Faz 1 döngüsü',
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
        note: 'Örnek aktif Faz 2 dönüş döngüsü',
        phase: 2,
        phaseStartedAt: new Date(now - 88 * hour).toISOString(),
        cycleStartedAt: new Date(now - 256 * hour).toISOString(),
        completedAt: null
      }
    ];

    this.saveCycles();
    this.views.tracker?.render();
    this.toast('Örnek 2 fazlı CSFloat döngüleri yüklendi.');
  }

  exportCyclesCsv() {
    if (this.cycles.length === 0) {
      this.toast('Dışa aktarılacak döngü kaydı yok.', 'warn');
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
    this.toast('Döngü defteri CSV olarak indirildi.');
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
        stBtn.textContent = 'Özel %';
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
        this.toast(`Aktif pazar: ${MARKETPLACES[nextMkt].name} (Satış komisyonu %${this.settings.sellFeePct})`);
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
        this.toast(`Para birimi ${cur} olarak güncellendi.`);
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
      const labels = {
        EXACT_VALVE: 'Gerçek Valve Cent Hesabı ($0.01 taban kesinti dahil)',
        DIV_115: 'Klasik ÷ 1.15 Oransal Formül',
        CUSTOM: 'Özel Steam Komisyon Yüzdesi'
      };
      this.toast(`Steam kesinti modu: ${labels[next]}`);
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
      btn.textContent = 'Güncelleniyor...';
      try {
        const res = await this.market.syncLive(this.customItems, true);
        this.items = res.items;
        this.rebuildItemIndex();
        this.renderAll();
        if (res.marketUpdated) {
          this.toast(`Canlı fiyatlar yenilendi (${this.items.length.toLocaleString('tr-TR')} eşya).`);
        } else {
          this.toast('Canlı API şu an ulaşılamıyor; yerel önbellek aktif.', 'warn');
        }
      } catch {
        this.toast('Canlı senkronizasyon başarısız oldu.', 'warn');
      } finally {
        btn.disabled = false;
        btn.textContent = '↻ Canlı Yenile';
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
    renderLiveTicker(this);
    this.views.calculator?.render();
    this.views.scanner?.render();
    this.views.tracker?.render();
  }

  async boot() {
    this.cmdPalette = initCommandPalette(this);
    this.vaultModal = initVaultModal(this);
    this.shareSupport = initShareAndSupportModals(this);
    this.views.calculator = initCalculatorView(this);
    this.views.scanner = initScannerView(this);
    this.views.tracker = initTrackerView(this);
    initAcademyView();

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

    // 1. Instant boot from bundled ByMykel catalog + fresh snapshot
    try {
      this.items = await this.market.loadInitial(this.customItems);
      this.rebuildItemIndex();
      this.hydrateDefaultPairIfEmpty();
      this.switchTab(this.activeTab, { updateHistory: true, replaceHistory: true });
      this.renderAll();
      if (sharedSetup) {
        this.toast('Paylaşılan arbitraj kurulumu yüklendi!');
      }
    } catch (err) {
      this.toast('Yerel katalog yüklenemedi. Lütfen HTTP sunucusu üzerinden açın.', 'err');
      console.error(err);
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
