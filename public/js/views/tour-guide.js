/**
 * SPREAD (spread.haking.tr) — Interactive Spotlight Onboarding Tour (EN/TR, Zero-Dependency, Strict CSP)
 *
 * Guides newcomers step-by-step directly over live UI elements with:
 *  - Smooth spotlight cutout highlighting the active target
 *  - Smart viewport-clamped popover card
 *  - Back / Next / Skip Tutorial controls + Keyboard (ArrowRight / ArrowLeft / Escape)
 */

import { STORAGE_KEYS } from '../core/config.js';
import { clearNode, el } from '../core/security.js';
import { isTr } from '../core/i18n.js';

function getTourSteps() {
  const tr = isTr();
  return [
    {
      selector: '.capital-box',
      title: tr ? '1. Bütçeni Belirle' : '1. Set Your Budget',
      body: tr
        ? 'CSFloat veya Youpin898 hesabındaki bütçeni buraya yaz ya da hazır tutarlardan birini seç. Tüm stratejiler bütçene göre anlık yeniden hesaplanır.'
        : 'Enter your cash budget on CSFloat or Youpin898 here, or tap a quick preset. Every strategy recalculates live to fit your exact budget.'
    },
    {
      selector: '#spreadAgentCard',
      title: tr ? '2. SPREAD Agent Teklifi' : '2. SPREAD Agent Live Pick',
      body: tr
        ? 'SPREAD Agent 6 canlı kaynağı (CSFloat, Buff163, Steam, Skinport, Market.CSGO, Youpin) analiz ederek bütçen için en kârlı ve mantıklı hamleyi tek kutuda sunar.'
        : 'SPREAD Agent analyzes 6 live feeds (CSFloat, Buff163, Steam, Skinport, Market.CSGO, Youpin) and recommends the smartest risk-adjusted move in one card.'
    },
    {
      selector: '.advisor-toolbar',
      title: tr ? '3. Akıllı Filtreler & Rehber' : '3. Smart Filters & Guide',
      body: tr
        ? 'Tek tıkla "Az İşlem (≤10)", "En Hızlı Nakit", "Sadece Kasalar" veya "Yüksek Kâr / Bıçak" moduna geç. İstediğin zaman "ⓘ Filtre Rehberi"ne basabilirsin.'
        : 'Switch instantly between Few Items (≤10), Fastest Cash, Cases Only, or High Profit / Knives — or open "ⓘ Filter Guide" anytime.'
    },
    {
      selector: '.legs-grid',
      title: tr ? '4. 1. Adım & 2. Adım Masası' : '4. Step 1 & Step 2 Trade Desk',
      body: tr
        ? 'Sol kartta ucuza alıp Steam’de satacağın eşyayı, sağ kartta Steam bakiyesini en az kayıpla nakde çevireceğin skini görürsün. Canlı Steam 24s hacmi otomatik doğrulanır.'
        : 'Left card shows your discounted buy → Steam sale; right card shows your low-loss cashout skin. Live Steam 24h sold volume & fast-sell median verify automatically.'
    },
    {
      selector: '.hero-actions',
      title: tr ? '5. 14 Günlük Takip & Paylaşım' : '5. 14-Day Tracker & Share Link',
      body: tr
        ? 'Karar verdiğin döngüyü "+ Bu Döngüyü Takibe Al" ile 7+7 gün sayaçlı defterine ekle veya "↗ Paylaş" ile birebir aynı kurulumu arkadaşına link olarak gönder.'
        : 'Click "+ Track This Cycle" to start a live 7+7 day hold countdown in your local ledger, or click "↗ Share" to send this exact setup via link.'
    },
    {
      selector: '.header-controls',
      title: tr ? '6. Pazar, Kur, Arama & Yedek' : '6. Market, Currency, Search & Vault',
      body: tr
        ? 'CSFloat / Youpin898 seçimi, para birimi ($/₺/¥/€), dil (EN/TR), hızlı fiyat aralıklı skin araması (Ctrl+K) ve SHA-256 yerel JSON yedeği buradadır.'
        : 'Switch CSFloat / Youpin898, currency ($/₺/¥/€), language (EN/TR), search skins by price range (Ctrl+K), or export a SHA-256 local JSON backup.'
    },
    {
      selector: '.main-nav',
      title: tr ? '7. Tarayıcı, Rehber & Güven' : '7. Scanner, Guide & Trust',
      body: tr
        ? '4.500+ skini Canlı Tarayıcıda filtrele, Arbitraj Rehberinde Steam $0.01 komisyon laboratuvarını dene, Hakkında & Güven sekmesinden canlı kaynakları izle.'
        : 'Filter all 4,500+ skins in Live Scanner, test Steam’s $0.01 fee trap in the Guide, and inspect live 6-source telemetry in About & Trust.'
    }
  ];
}

export function initInteractiveTour(app) {
  let active = false;
  let stepIndex = 0;
  let steps = [];
  let rootEl = null;
  let spotlightEl = null;
  let popoverEl = null;

  function ensureDom() {
    if (rootEl) return;
    spotlightEl = el('div', { id: 'tourSpotlight', className: 'tour-spotlight' });
    popoverEl = el('div', { id: 'tourPopover', className: 'tour-popover', role: 'dialog', 'aria-modal': 'true' });
    rootEl = el(
      'div',
      {
        id: 'tourOverlayRoot',
        className: 'tour-overlay hidden',
        onClick: (e) => {
          if (e.target === rootEl) stop(true);
        }
      },
      spotlightEl,
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

  function positionForCurrentStep() {
    if (!active || !rootEl || !spotlightEl || !popoverEl) return;
    const step = steps[stepIndex];
    if (!step) return;

    const target = document.querySelector(step.selector);
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (!target || target.offsetParent === null) {
      spotlightEl.style.opacity = '0';
      popoverEl.style.left = `${Math.max(16, Math.round((vw - 360) / 2))}px`;
      popoverEl.style.top = `${Math.max(24, Math.round((vh - 210) / 2))}px`;
      return;
    }

    const rect = target.getBoundingClientRect();
    const pad = 8;
    const left = Math.max(6, rect.left - pad);
    const top = Math.max(6, rect.top - pad);
    const width = Math.min(vw - 12, rect.width + pad * 2);
    const height = Math.min(vh - 12, rect.height + pad * 2);

    spotlightEl.style.opacity = '1';
    spotlightEl.style.left = `${left}px`;
    spotlightEl.style.top = `${top}px`;
    spotlightEl.style.width = `${width}px`;
    spotlightEl.style.height = `${height}px`;

    // Measure popover & clamp inside viewport
    const popW = Math.min(370, vw - 24);
    popoverEl.style.width = `${popW}px`;
    const popRect = popoverEl.getBoundingClientRect();
    const popH = Math.max(175, popRect.height || 195);

    let popTop = top + height + 14;
    if (popTop + popH > vh - 14) {
      popTop = top - popH - 14;
    }
    if (popTop < 14) {
      popTop = Math.max(14, Math.min(vh - popH - 14, top + 16));
    }

    let popLeft = left;
    if (popLeft + popW > vw - 14) {
      popLeft = vw - popW - 14;
    }
    popLeft = Math.max(12, popLeft);

    popoverEl.style.left = `${Math.round(popLeft)}px`;
    popoverEl.style.top = `${Math.round(popTop)}px`;
  }

  function renderStep() {
    if (!active) return;
    steps = getTourSteps();
    if (stepIndex < 0) stepIndex = 0;
    if (stepIndex >= steps.length) {
      stop(true);
      return;
    }

    const tr = isTr();
    const step = steps[stepIndex];
    const isLast = stepIndex === steps.length - 1;
    const target = document.querySelector(step.selector);

    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    clearNode(popoverEl);
    popoverEl.appendChild(
      el(
        'div',
        { className: 'tour-pop-head' },
        el('span', { className: 'pill pill-gold' }, `${tr ? 'ADIM' : 'STEP'} ${stepIndex + 1} / ${steps.length}`),
        el(
          'button',
          {
            type: 'button',
            className: 'btn btn-sm btn-ghost',
            onClick: () => stop(true)
          },
          tr ? 'Turu Atla ✕' : 'Skip Tour ✕'
        )
      )
    );
    popoverEl.appendChild(el('h4', { className: 'tour-pop-title' }, step.title));
    popoverEl.appendChild(el('p', { className: 'tour-pop-body' }, step.body));

    const dots = el(
      'div',
      { className: 'tour-dots' },
      steps.map((_, idx) =>
        el('span', { className: `tour-dot ${idx === stepIndex ? 'is-active' : idx < stepIndex ? 'is-done' : ''}` })
      )
    );

    const actions = el(
      'div',
      { className: 'tour-pop-foot' },
      dots,
      el(
        'div',
        { style: { display: 'flex', gap: '6px' } },
        stepIndex > 0
          ? el(
              'button',
              {
                type: 'button',
                className: 'btn btn-sm',
                onClick: () => {
                  stepIndex -= 1;
                  renderStep();
                }
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
                app.toast(tr ? 'Tur tamamlandı! Artık arbitraj masasına hazırsın.' : 'Tour complete! Ready to trade.');
              } else {
                stepIndex += 1;
                renderStep();
              }
            }
          },
          isLast ? (tr ? '✓ Başla' : '✓ Finish') : (tr ? 'Sonraki →' : 'Next →')
        )
      )
    );
    popoverEl.appendChild(actions);

    positionForCurrentStep();
    setTimeout(positionForCurrentStep, 260);
    setTimeout(positionForCurrentStep, 520);
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
    if (rootEl) rootEl.classList.add('hidden');
    if (completed) markCompleted();
  }

  window.addEventListener('resize', positionForCurrentStep);
  window.addEventListener('scroll', positionForCurrentStep, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      stop(true);
    } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault();
      if (stepIndex >= steps.length - 1) stop(true);
      else {
        stepIndex += 1;
        renderStep();
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (stepIndex > 0) {
        stepIndex -= 1;
        renderStep();
      }
    }
  });

  document.getElementById('startInteractiveTourBtn')?.addEventListener('click', start);

  return {
    start,
    stop,
    isActive: () => active,
    refresh: () => {
      if (active) renderStep();
    }
  };
}
