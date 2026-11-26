/**
 * SPREAD (spread.haking.tr) — V6.2 Interactive Spotlight Tour Engine (EN/TR, Zero-Dependency, Strict CSP)
 *
 * Upgraded Architecture:
 *  - 4-panel GPU-friendly backdrop shades (zero 9999px box-shadow lag, live clickable cutout!)
 *  - Sticky-header-aware scroll targeting + 60fps rAF lock (zero rubber-band lag while scrolling)
 *  - Smart dynamic selector fallback (works seamlessly whether Split Mode is ON or OFF)
 *  - Non-overlapping 4-side popover placement (bottom -> top -> right -> left -> clean bottom-right dock)
 *  - Showcases V6/V6.1 Multi-Item Split Mode & Full Basket Trade Desk with interactive live toggle
 *  - Clickable step dots + ArrowLeft/ArrowRight/Escape navigation (no Enter hijack on buttons)
 */

import { STORAGE_KEYS } from '../core/config.js';
import { clearNode, el } from '../core/security.js';
import { isTr } from '../core/i18n.js';

function getTourSteps(app) {
  const tr = isTr();
  const splitOn = Boolean(app?.settings?.splitMode);

  return [
    {
      id: 'budget',
      selectors: ['.capital-box'],
      badge: tr ? 'BAŞLANGIÇ' : 'START',
      title: tr ? '1. Bütçeni Belirle' : '1. Set Your Budget',
      body: tr
        ? 'CSFloat veya Youpin898 hesabındaki bütçeni buraya yaz ya da hazır tutarlardan ($50–$5.000) birini seç. Tüm stratejiler ve sepet dağılımları bütçene göre anlık yeniden hesaplanır.'
        : 'Enter your cash budget on CSFloat or Youpin898 here, or pick a preset ($50–$5,000). Every strategy and multi-item basket recalculates live to match your exact budget.'
    },
    {
      id: 'filters',
      selectors: ['.advisor-toolbar'],
      badge: tr ? 'FİLTRELER' : 'FILTERS',
      title: tr ? '2. Akıllı Strateji & Hız Filtreleri' : '2. Smart Strategy & Speed Filters',
      body: tr
        ? 'Tek tıkla "Az İşlem (≤10)", "En Hızlı Nakit", "Sadece Kasalar" veya "Yüksek Kâr / Bıçak" moduna geç. İstediğin zaman "ⓘ Filtre Rehberi"ne basarak tüm metrikleri görebilirsin.'
        : 'Switch instantly between Few Items (≤10), Fastest Cash, Cases Only, or High Profit / Knives — or open "ⓘ Filter Guide" anytime for plain-language explanations.'
    },
    {
      id: 'split',
      selectors: ['.basket-control-bar'],
      badge: tr ? 'YENİ • V11' : 'NEW • V11',
      title: tr ? '3. 🔀 Sepet / Bölme Modu & Meta-Hakem' : '3. 🔀 Multi-Item Split Mode & Meta-Arbitrator',
      body: tr
        ? 'Yüksek bütçede tek skinin 30 adetini satmak yerine bu modu aç! SPREAD Agent V11 Tekli Mod ile Sepet Modunu kafa kafaya kıyaslar; hangisi daha hızlı ve daha kârlıysa sağdaki butonla anında önerir.'
        : 'Instead of dumping 30x of a single skin on larger budgets, toggle Split Mode! SPREAD Agent V11 compares Single vs. Basket head-to-head and highlights the faster, higher-profit mode right next to this toggle.',
      demoAction: {
        label: splitOn
          ? tr ? '✓ Sepet Modu Açık (Kapat)' : '✓ Split Mode Active (Turn Off)'
          : tr ? '🔀 Sepet Modunu Şimdi Dene' : '🔀 Try Split Mode Live',
        onClick: () => {
          if (!app?.settings) return;
          app.settings.splitMode = !app.settings.splitMode;
          if (app.settings.splitMode) {
            app.settings.splitBuyCount = 0;
            app.settings.splitSellCount = 0;
          }
          app.saveSettings();
          app.views?.calculator?.render();
        }
      }
    },
    {
      id: 'agent',
      selectors: ['#basketBlueprintPanel', '#spreadAgentCard'],
      badge: 'SPREAD AGENT V11',
      title: tr ? '4. SPREAD Agent V11 Canlı Teklifi & Gerçek Steam Satışları' : '4. SPREAD Agent V11 Live Pick & Real Steam Sales',
      body: tr
        ? 'SPREAD Agent V11 7 canlı kaynağı (gerçek Steam 7g/30g satış geçmişi, CSFloat, Buff163, Youpin898, Skinport, Market.CSGO) ve 354+ Doppler fazını tarar; hayali ilan yerine gerçekçi satış fiyatından 500 senaryolu Monte Carlo CVaR hesaplar.'
        : 'SPREAD Agent V11 scans 7 live feeds (including real Steam 7d/30d sales history, CSFloat, Buff163, Youpin898, Skinport, Market.CSGO) plus 354+ Doppler phases, pricing Step 1 at realistic clearing value with 500-trial Monte Carlo CVaR.'
    },
    {
      id: 'desk',
      selectors: ['.legs-grid'],
      badge: tr ? 'DÖNGÜ MASASI' : 'TRADE DESK',
      title: tr ? '5. 1. Adım & 2. Adım Canlı Masası' : '5. Live Step 1 & Step 2 Trade Desk',
      body: tr
        ? '1. adımda gerçek son Steam satışlarını, tek tıkla Gerçekçi Satış / Son Satış / En Düşük İlan / Anında Sat butonlarını görürsün. Sepet yüklediğinde eşya ekleyip çıkarınca kalan adetler otomatik yeniden dengelenir.'
        : 'Step 1 displays actual recent Steam sales with 1-click Realistic Sell / Last Sale / Lowest Ask / Instant Buy-Order presets. In Basket Mode, adding or removing any skin automatically rebalances remaining quantities.',
      tallFocus: true
    },
    {
      id: 'actions',
      selectors: ['.hero-actions'],
      badge: tr ? 'TAKİP & PAYLAŞ' : 'TRACK & SHARE',
      title: tr ? '6. 14 Günlük Takip & Sepet Paylaşım Linki' : '6. 14-Day Cycle Tracker & Shareable Link',
      body: tr
        ? '"+ Bu Döngüyü Takibe Al" ile tekli çifti veya çoklu sepeti 7+7 günlük canlı sayaç defterine kaydet. "↗ Paylaş" butonu tüm sepet eşyalarını linke kodlar; arkadaşın tıkladığında birebir aynı masa açılır.'
        : 'Click "+ Track This Cycle" to save your single loop or full multi-item basket into the 7+7D hold tracker. "↗ Share" encodes all basket items into a direct URL so friends open your exact desk.'
    },
    {
      id: 'controls',
      selectors: ['.header-controls'],
      badge: tr ? 'ARAÇLAR' : 'TOOLS',
      title: tr ? '7. Pazar, Kur, 20.000+ Skin Arama & Kasa' : '7. Market, Currency, 20,000+ Search & Local Vault',
      body: tr
        ? 'CSFloat / Youpin898 geçişi, para birimi ($/₺/¥/€), dil (EN/TR), 20.000+ skin & Doppler faz araması (Ctrl+K) ve SHA-256 yerel JSON yedeği her zaman üst çubuktadır.'
        : 'Switch CSFloat / Youpin898, currency ($/₺/¥/€), language (EN/TR), 20,000+ skin & Doppler phase search (Ctrl+K), or SHA-256 local JSON backup anytime from the top bar.',
      isStickyHeader: true
    },
    {
      id: 'nav',
      selectors: ['.main-nav'],
      badge: tr ? 'SEKMELER' : 'VIEWS',
      title: tr ? '8. Canlı Tarayıcı, Rehber & Güven' : '8. Live Scanner, Guide & Trust',
      body: tr
        ? 'Canlı Tarayıcıda 6.000+ skini (354+ Doppler fazı dahil) filtrele, Arbitraj Rehberinde Valve’ın $0.01 komisyon laboratuvarını test et, Hakkında & Güven sekmesinde canlı 7 kaynak durumunu incele.'
        : 'Filter 6,000+ skins (incl. 354+ Doppler phases) in Live Scanner, test Valve’s $0.01 minimum fee lab in Arbitrage Guide, and inspect live 7-feed telemetry in About & Trust.',
      isStickyHeader: true
    }
  ];
}

function isVisibleEl(node) {
  if (!node) return false;
  if (node.classList?.contains('hidden')) return false;
  if (node.offsetParent === null) {
    // Allow fixed/sticky elements (like header) whose offsetParent can be null in some engines
    const rect = node.getBoundingClientRect?.();
    if (!rect || (rect.width === 0 && rect.height === 0)) return false;
  }
  const rect = node.getBoundingClientRect?.();
  return Boolean(rect && rect.width > 0 && rect.height > 0);
}

export function initInteractiveTour(app) {
  let active = false;
  let stepIndex = 0;
  let steps = [];
  let rootEl = null;
  let shadeTop = null;
  let shadeBottom = null;
  let shadeLeft = null;
  let shadeRight = null;
  let ringEl = null;
  let popoverEl = null;
  let rafId = null;
  let scrollTrackUntil = 0;
  let currentTarget = null;

  function ensureDom() {
    if (rootEl) return;
    shadeTop = el('div', { className: 'tour-shade' });
    shadeBottom = el('div', { className: 'tour-shade' });
    shadeLeft = el('div', { className: 'tour-shade' });
    shadeRight = el('div', { className: 'tour-shade' });
    ringEl = el('div', { id: 'tourSpotlight', className: 'tour-spotlight-ring' });
    popoverEl = el('div', { id: 'tourPopover', className: 'tour-popover', role: 'dialog', 'aria-modal': 'true' });

    rootEl = el(
      'div',
      { id: 'tourOverlayRoot', className: 'tour-overlay hidden' },
      shadeTop,
      shadeBottom,
      shadeLeft,
      shadeRight,
      ringEl,
      popoverEl
    );
    document.body.appendChild(rootEl);
  }

  function markCompleted() {
    try {
      localStorage.setItem(STORAGE_KEYS.TOUR_DONE, '1');
    } catch {
      // ignore
    }
  }

  function resolveTarget(step) {
    if (!step?.selectors) return null;
    for (const sel of step.selectors) {
      const node = document.querySelector(sel);
      if (isVisibleEl(node)) return node;
    }
    return null;
  }

  function getHeaderBottom() {
    const hdr = document.querySelector('.app-header');
    if (!hdr) return 86;
    const r = hdr.getBoundingClientRect();
    return Math.max(0, Math.min(180, Math.round(r.bottom)));
  }

  function applyBox(node, left, top, width, height) {
    if (!node) return;
    node.style.left = `${Math.max(0, Math.round(left))}px`;
    node.style.top = `${Math.max(0, Math.round(top))}px`;
    node.style.width = `${Math.max(0, Math.round(width))}px`;
    node.style.height = `${Math.max(0, Math.round(height))}px`;
  }

  function positionForCurrentStep() {
    if (!active || !rootEl || !ringEl || !popoverEl) return;
    const step = steps[stepIndex];
    if (!step) return;

    const target = resolveTarget(step);
    currentTarget = target;
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 800;
    const popW = Math.min(380, vw - 24);
    popoverEl.style.width = `${popW}px`;
    const popRect = popoverEl.getBoundingClientRect();
    const popH = Math.max(185, popRect.height || 210);

    if (!target) {
      // Clean full-screen shade + centered dialog fallback
      applyBox(shadeTop, 0, 0, vw, vh);
      applyBox(shadeBottom, 0, 0, 0, 0);
      applyBox(shadeLeft, 0, 0, 0, 0);
      applyBox(shadeRight, 0, 0, 0, 0);
      ringEl.style.opacity = '0';
      popoverEl.style.left = `${Math.max(12, Math.round((vw - popW) / 2))}px`;
      popoverEl.style.top = `${Math.max(24, Math.round((vh - popH) / 2))}px`;
      return;
    }

    const rect = target.getBoundingClientRect();
    const pad = 7;
    const headerBottom = step.isStickyHeader ? 4 : getHeaderBottom() + 4;

    // Clamp spotlight cleanly inside visible viewport (never covering sticky header for body elements!)
    const rawLeft = rect.left - pad;
    const rawTop = rect.top - pad;
    const rawRight = rect.right + pad;
    const rawBottom = rect.bottom + pad;

    const left = Math.max(6, Math.min(vw - 20, rawLeft));
    const top = Math.max(headerBottom, Math.min(vh - 20, rawTop));
    const right = Math.max(left + 16, Math.min(vw - 6, rawRight));
    const bottom = Math.max(top + 16, Math.min(vh - 6, rawBottom));
    const width = right - left;
    const height = bottom - top;

    // 4-panel backdrop cutout (zero 9999px box-shadow lag, live element inside hole!)
    applyBox(shadeTop, 0, 0, vw, top);
    applyBox(shadeBottom, 0, bottom, vw, Math.max(0, vh - bottom));
    applyBox(shadeLeft, 0, top, left, height);
    applyBox(shadeRight, right, top, Math.max(0, vw - right), height);

    ringEl.style.opacity = '1';
    applyBox(ringEl, left, top, width, height);

    // Non-overlapping 4-side popover placement solver (bottom -> top -> right -> left -> clean bottom-right dock)
    const gap = 14;
    const spaceBelow = vh - bottom - gap;
    const spaceAbove = top - headerBottom - gap;
    const spaceRight = vw - right - gap;
    const spaceLeft = left - gap;

    let popLeft = left;
    let popTop = bottom + gap;

    if (spaceBelow >= popH + 8) {
      popTop = bottom + gap;
      popLeft = left + width / 2 - popW / 2;
    } else if (spaceAbove >= popH + 8) {
      popTop = top - popH - gap;
      popLeft = left + width / 2 - popW / 2;
    } else if (spaceRight >= popW + 12) {
      popLeft = right + gap;
      popTop = top + Math.min(40, Math.max(0, (height - popH) / 2));
    } else if (spaceLeft >= popW + 12) {
      popLeft = left - popW - gap;
      popTop = top + Math.min(40, Math.max(0, (height - popH) / 2));
    } else {
      // Very tall full-width section (e.g. Trade Desk on laptop screen): dock cleanly bottom-right!
      popLeft = vw - popW - 18;
      popTop = vh - popH - 18;
    }

    popLeft = Math.max(12, Math.min(vw - popW - 12, popLeft));
    popTop = Math.max(12, Math.min(vh - popH - 12, popTop));

    popoverEl.style.left = `${Math.round(popLeft)}px`;
    popoverEl.style.top = `${Math.round(popTop)}px`;
  }

  function startScrollLockLoop(durationMs = 560) {
    scrollTrackUntil = Date.now() + durationMs;
    if (rafId) return;
    let frames = 0;
    let inTick = false;
    const tick = () => {
      if (!active || inTick || frames >= 45) {
        rafId = null;
        return;
      }
      inTick = true;
      frames += 1;
      positionForCurrentStep();
      inTick = false;
      if (Date.now() < scrollTrackUntil && frames < 45) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = null;
      }
    };
    rafId = requestAnimationFrame(tick);
  }

  function scrollTargetIntoClearView(step, target) {
    if (!target || step.isStickyHeader) return;
    const rect = target.getBoundingClientRect();
    const headerH = getHeaderBottom();
    const vh = window.innerHeight || 800;
    const currentY = window.scrollY || window.pageYOffset || 0;

    // Only scroll if element is clipped behind sticky header, below viewport, or leaves no room for popover
    const topClear = rect.top >= headerH + 14;
    const bottomClear = step.tallFocus ? rect.top <= headerH + 90 : rect.bottom <= vh - 190;
    if (topClear && bottomClear) return;

    let desiredY;
    if (step.tallFocus || rect.height > vh * 0.52) {
      desiredY = currentY + rect.top - (headerH + 18);
    } else {
      // Place element cleanly in upper-middle band so popover always has space below
      const targetTopOffset = Math.max(headerH + 20, Math.round((vh - rect.height - 190) / 2));
      desiredY = currentY + rect.top - targetTopOffset;
    }

    window.scrollTo({ top: Math.max(0, Math.round(desiredY)), behavior: 'smooth' });
    startScrollLockLoop(620);
  }

  function goToStep(nextIdx) {
    stepIndex = Math.max(0, Math.min(steps.length - 1, nextIdx));
    renderStep();
  }

  function renderStep() {
    if (!active) return;
    steps = getTourSteps(app);
    if (stepIndex < 0) stepIndex = 0;
    if (stepIndex >= steps.length) {
      stop(true);
      return;
    }

    const tr = isTr();
    const step = steps[stepIndex];
    const isLast = stepIndex === steps.length - 1;
    const target = resolveTarget(step);

    clearNode(popoverEl);

    popoverEl.appendChild(
      el(
        'div',
        { className: 'tour-pop-head' },
        el(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
          el('span', { className: 'pill pill-gold num' }, `${stepIndex + 1} / ${steps.length}`),
          step.badge ? el('span', { className: 'pill pill-ice' }, step.badge) : null
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'btn btn-sm btn-ghost',
            onClick: () => stop(true)
          },
          tr ? 'Turu Kapat ✕' : 'Skip Tour ✕'
        )
      )
    );

    popoverEl.appendChild(el('h4', { className: 'tour-pop-title' }, step.title));
    popoverEl.appendChild(el('p', { className: 'tour-pop-body' }, step.body));

    if (step.demoAction) {
      popoverEl.appendChild(
        el(
          'div',
          { className: 'tour-demo-row' },
          el(
            'button',
            {
              type: 'button',
              className: 'btn btn-sm btn-tour',
              onClick: () => {
                step.demoAction.onClick();
                renderStep();
              }
            },
            step.demoAction.label
          )
        )
      );
    }

    const dots = el(
      'div',
      { className: 'tour-dots', role: 'tablist' },
      steps.map((st, idx) =>
        el('button', {
          type: 'button',
          className: `tour-dot ${idx === stepIndex ? 'is-active' : idx < stepIndex ? 'is-done' : ''}`,
          title: st.title,
          'aria-label': st.title,
          onClick: () => goToStep(idx)
        })
      )
    );

    popoverEl.appendChild(
      el(
        'div',
        { className: 'tour-pop-foot' },
        dots,
        el(
          'div',
          { style: { display: 'flex', gap: '6px', flexShrink: '0' } },
          stepIndex > 0
            ? el(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-sm',
                  onClick: () => goToStep(stepIndex - 1)
                },
                tr ? '← Geri' : '← Back'
              )
            : null,
          el(
            'button',
            {
              type: 'button',
              className: `btn btn-sm ${isLast ? 'btn-mint' : 'btn-primary'}`,
              onClick: () => {
                if (isLast) {
                  stop(true);
                  app.toast(tr ? 'Tur tamamlandı! Artık SPREAD masasına hazırsın.' : 'Tour complete! Ready to trade on SPREAD.');
                } else {
                  goToStep(stepIndex + 1);
                }
              }
            },
            isLast ? (tr ? '✓ Başla' : '✓ Finish') : (tr ? 'Sonraki →' : 'Next →')
          )
        )
      )
    );

    popoverEl.appendChild(
      el(
        'div',
        { className: 'tour-kbd-hint' },
        tr ? 'İpucu: ← / → yön tuşlarıyla gezebilir, Esc ile kapatabilirsin' : 'Tip: Use ← / → arrow keys to navigate, Esc to exit'
      )
    );

    // Position immediately, then scroll smoothly while tracking at 60fps
    positionForCurrentStep();
    scrollTargetIntoClearView(step, target);
  }

  function start() {
    ensureDom();
    if (app.activeTab !== 'calculator') {
      app.switchTab('calculator');
    }
    active = true;
    stepIndex = 0;
    rootEl.classList.remove('hidden');
    renderStep();
  }

  function stop(completed = true) {
    active = false;
    currentTarget = null;
    if (rafId) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (rootEl) rootEl.classList.add('hidden');
    if (completed) markCompleted();
  }

  window.addEventListener('resize', () => {
    if (active) positionForCurrentStep();
  });
  window.addEventListener(
    'scroll',
    () => {
      if (active) positionForCurrentStep();
    },
    { passive: true }
  );

  document.addEventListener('keydown', (e) => {
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      stop(true);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (stepIndex >= steps.length - 1) stop(true);
      else goToStep(stepIndex + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (stepIndex > 0) goToStep(stepIndex - 1);
    }
  });

  document.getElementById('startInteractiveTourBtn')?.addEventListener('click', start);

  return {
    start,
    stop,
    goToStep,
    getStepCount: () => getTourSteps(app).length,
    isActive: () => active,
    refresh: () => {
      if (active) renderStep();
    }
  };
}
