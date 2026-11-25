/**
 * SPREAD (spread.haking.tr) — 2-Phase 14-Day Cycle Tracker & Actual P&L Ledger
 *
 * Improvements over legacy code:
 *  - Zero innerHTML XSS (100% safe DOM construction via el())
 *  - Multi-currency normalized KPI totals (stored in USD, converted live to active currency)
 *  - Non-destructive 1-second timer ticking (patches only countdown text & progress widths)
 *  - Actual vs Expected profit capture modal upon completing Phase 2
 */

import { MARKETPLACES, SEVEN_DAYS_MS, buildImageUrl } from '../core/config.js';
import { cleanText, clearNode, el } from '../core/security.js';
import { fmtCountdown, fmtMoneyFromUsd, fmtPct, fmtShortDate, fromUsd, toUsd } from '../core/formatters.js';
import { isTr, t } from '../core/i18n.js';

export function initTrackerView(app) {
  let statusFilter = 'ALL'; // 'ALL' | 'ACTIVE' | 'DONE'
  let completingCycleId = null;

  const listEl = document.getElementById('cyclesContainer');
  const completeModal = document.getElementById('completeCycleModal');
  const actualEndInput = document.getElementById('actualEndAmountInput');
  const actualNoteInput = document.getElementById('actualCycleNoteInput');
  const completeSummaryEl = document.getElementById('completeCycleSummary');

  function openCompleteModal(cycle) {
    completingCycleId = cycle.id;
    const cur = app.settings.currency;
    const fx = app.market.fxRates;
    actualEndInput.value = fromUsd(cycle.expectedEndUsd, cur, fx).toFixed(2);
    actualNoteInput.value = cycle.note || '';
    const tr = isTr();
    completeSummaryEl.textContent = tr
      ? `${cycle.item1Name} → ${cycle.item2Name} | Beklenen dönüş: ${fmtMoneyFromUsd(cycle.expectedEndUsd, cur, fx)}`
      : `${cycle.item1Name} → ${cycle.item2Name} | Expected return: ${fmtMoneyFromUsd(cycle.expectedEndUsd, cur, fx)}`;
    completeModal.classList.remove('hidden');
    setTimeout(() => actualEndInput.focus(), 20);
  }

  function closeCompleteModal() {
    completingCycleId = null;
    completeModal.classList.add('hidden');
  }

  document.getElementById('closeCompleteModalBtn')?.addEventListener('click', closeCompleteModal);
  document.getElementById('cancelCompleteBtn')?.addEventListener('click', closeCompleteModal);
  completeModal?.addEventListener('click', (e) => {
    if (e.target === completeModal) closeCompleteModal();
  });

  document.getElementById('confirmCompleteForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!completingCycleId) return;
    const cyc = app.cycles.find((c) => c.id === completingCycleId);
    if (!cyc) return;

    const valDisp = parseFloat(actualEndInput.value);
    const actualEndUsd = Number.isFinite(valDisp) && valDisp >= 0
      ? toUsd(valDisp, app.settings.currency, app.market.fxRates)
      : cyc.expectedEndUsd;

    cyc.phase = 3;
    cyc.actualEndUsd = Math.round(actualEndUsd * 100) / 100;
    cyc.actualProfitUsd = Math.round((cyc.actualEndUsd - cyc.capitalUsd) * 100) / 100;
    cyc.note = cleanText(actualNoteInput.value, 240);
    cyc.completedAt = new Date().toISOString();

    app.saveCycles();
    closeCompleteModal();
    render();
    app.toast(isTr() ? 'Döngü tamamlandı ve gerçekleşen kâr deftere işlendi.' : 'Cycle completed and realized profit recorded to ledger.');
  });

  document.querySelectorAll('[data-tracker-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      statusFilter = btn.dataset.trackerFilter;
      document.querySelectorAll('[data-tracker-filter]').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.trackerFilter === statusFilter);
      });
      render();
    });
  });

  document.getElementById('loadSampleCyclesBtn')?.addEventListener('click', () => {
    app.loadSampleCycles();
  });

  document.getElementById('exportCyclesCsvBtn')?.addEventListener('click', () => {
    app.exportCyclesCsv();
  });

  function render() {
    const now = Date.now();
    const cur = app.settings.currency;
    const fx = app.market.fxRates;
    const money = (u, withSign = false) => fmtMoneyFromUsd(u, cur, fx, { withSign });

    const navBadge = document.getElementById('trackerNavBadge');
    const activeCount = app.cycles.filter((c) => c.phase < 3).length;
    if (navBadge) navBadge.textContent = String(activeCount);

    let activeCapitalUsd = 0;
    let expectedProfitUsd = 0;
    let realizedProfitUsd = 0;
    let readyCount = 0;

    for (const c of app.cycles) {
      if (c.phase < 3) {
        activeCapitalUsd += c.capitalUsd;
        expectedProfitUsd += c.expectedProfitUsd;
        const elapsed = now - new Date(c.phaseStartedAt).getTime();
        if (elapsed >= SEVEN_DAYS_MS) readyCount += 1;
      } else {
        realizedProfitUsd += c.actualProfitUsd !== null ? c.actualProfitUsd : c.expectedProfitUsd;
      }
    }

    const tr = isTr();
    document.getElementById('trActiveCount').textContent = tr
      ? `${activeCount} aktif / ${app.cycles.length} toplam`
      : `${activeCount} active / ${app.cycles.length} total`;
    document.getElementById('trActiveCapital').textContent = money(activeCapitalUsd);

    const expEl = document.getElementById('trExpectedProfit');
    expEl.textContent = money(expectedProfitUsd, true);
    expEl.className = `kpi-card-value ${expectedProfitUsd >= 0 ? 'txt-mint' : 'txt-crimson'}`;

    const realEl = document.getElementById('trRealizedProfit');
    realEl.textContent = money(realizedProfitUsd, true);
    realEl.className = `kpi-card-value ${realizedProfitUsd >= 0 ? 'txt-gold' : 'txt-crimson'}`;

    document.getElementById('trReadySub').textContent =
      readyCount > 0
        ? tr ? `${readyCount} döngü faz geçişine hazır` : `${readyCount} cycle(s) ready to advance`
        : tr ? 'Tüm aktif döngüler takas kilidinde' : 'All active cycles currently in trade hold';

    clearNode(listEl);

    const visible = app.cycles.filter((c) => {
      if (statusFilter === 'ACTIVE') return c.phase < 3;
      if (statusFilter === 'DONE') return c.phase === 3;
      return true;
    });

    if (visible.length === 0) {
      listEl.appendChild(
        el(
          'div',
          { className: 'panel panel-pad ta-center txt-muted', style: { padding: '38px 20px', fontSize: '13px' } },
          t('tr.empty')
        )
      );
      return;
    }

    for (const c of visible) {
      const mkt = MARKETPLACES[c.marketplace] || MARKETPLACES.CSFLOAT;
      const startMs = new Date(c.phaseStartedAt).getTime();
      const remainingMs = Math.max(0, startMs + SEVEN_DAYS_MS - now);
      const pct = c.phase === 3 ? 100 : Math.min(100, Math.max(0, ((now - startMs) / SEVEN_DAYS_MS) * 100));
      const phaseReady = c.phase === 3 || remainingMs <= 0;

      let badgeCls = 'pill-amber';
      let badgeTxt = tr ? 'Faz 1 • 7G Hold' : 'Phase 1 • 7D Hold';
      let headline = tr
        ? `Faz 1 (Gün 0–7): ${mkt.name} Alındı → Steam Satışı Bekleniyor`
        : `Phase 1 (Day 0–7): Bought on ${mkt.name} → Awaiting Steam Sell`;
      let subline = tr
        ? `${c.qty1}x ${c.item1Name} için 7 günlük Valve Trade Protection kilidi`
        : `7-day Valve Trade Protection lock for ${c.qty1}x ${c.item1Name}`;

      if (c.phase === 1 && phaseReady) {
        badgeCls = 'pill-mint';
        badgeTxt = tr ? "Faz 1 Hazır • Steam'de Satın" : 'Phase 1 Ready • Sell on Steam';
      } else if (c.phase === 2) {
        headline = tr
          ? `Faz 2 (Gün 7–14): Steam Dönüş Eşyası Alındı → ${mkt.name} Nakit Dönüş Bekleniyor`
          : `Phase 2 (Day 7–14): Exit Skin Bought on Steam → Awaiting ${mkt.name} Cashout`;
        subline = tr
          ? `${c.qty2}x ${c.item2Name} için 7 günlük takas kilidi`
          : `7-day trade lock for ${c.qty2}x ${c.item2Name}`;
        badgeCls = phaseReady ? 'pill-mint' : 'pill-ice';
        badgeTxt = phaseReady
          ? tr ? `Faz 2 Hazır • ${mkt.name}'te Satın` : `Phase 2 Ready • Sell on ${mkt.name}`
          : tr ? 'Faz 2 • 7G Hold' : 'Phase 2 • 7D Hold';
      } else if (c.phase === 3) {
        headline = tr ? 'Tamamlandı • Döngü Deftere İşlendi' : 'Completed • Recorded to Ledger';
        subline = `${c.qty1}x ${c.item1Name} → ${c.qty2}x ${c.item2Name}${c.note ? ` • ${tr ? 'Not' : 'Note'}: ${c.note}` : ''}`;
        badgeCls = 'pill-gold';
        badgeTxt = tr ? 'Tamamlandı' : 'Completed';
      }

      const displayProfit = c.phase === 3 && c.actualProfitUsd !== null ? c.actualProfitUsd : c.expectedProfitUsd;
      const displayEnd = c.phase === 3 && c.actualEndUsd !== null ? c.actualEndUsd : c.expectedEndUsd;
      const displayRoi = c.capitalUsd > 0 ? (displayProfit / c.capitalUsd) * 100 : 0;

      const hasMultiBasket = (c.basketLeg1?.length || 0) > 1 || (c.basketLeg2?.length || 0) > 1;
      const renderBasketChips = (itemsArr, label, cls) =>
        el(
          'div',
          { className: 'tracker-basket-group' },
          el('span', { className: `tracker-basket-tag ${cls}` }, label),
          el(
            'div',
            { className: 'tracker-basket-pills' },
            itemsArr.map((it) =>
              el(
                'span',
                { className: 'tracker-basket-chip num' },
                it.img ? el('img', { src: buildImageUrl(it.img), alt: it.name, className: 'tracker-chip-img' }) : null,
                el('span', null, `${it.qty}x ${it.name}`)
              )
            )
          )
        );

      const card = el(
        'article',
        { className: 'panel cycle-card', dataset: { cycleId: c.id } },
        // Top row
        el(
          'div',
          { className: 'cycle-top' },
          el(
            'div',
            null,
            el(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
              el('span', { className: `pill ${badgeCls}`, dataset: { cycleBadge: c.id } }, badgeTxt),
              el('span', { className: 'pill pill-muted' }, mkt.name),
              hasMultiBasket
                ? el(
                  'span',
                  { className: 'pill pill-ice num' },
                  tr
                    ? `🔀 Sepet (${c.basketLeg1?.length || 1}→${c.basketLeg2?.length || 1})`
                    : `🔀 Basket (${c.basketLeg1?.length || 1}→${c.basketLeg2?.length || 1})`
                )
                : null,
              el('span', { className: 'txt-muted num', style: { fontSize: '11px' } }, `${tr ? 'Başlangıç' : 'Started'}: ${fmtShortDate(c.cycleStartedAt)}`)
            ),
            el(
              'div',
              { className: 'cycle-route' },
              el(
                'div',
                { className: 'cycle-thumbs' },
                el(
                  'div',
                  { className: 'pair-mini-thumb' },
                  el('img', { src: buildImageUrl(c.item1Img), alt: c.item1Name })
                ),
                el('span', { className: 'txt-gold num' }, '→'),
                el(
                  'div',
                  { className: 'pair-mini-thumb' },
                  el('img', { src: buildImageUrl(c.item2Img), alt: c.item2Name })
                )
              ),
              el(
                'div',
                null,
                el('h4', { style: { fontSize: '14px' } }, headline),
                el('p', { className: 'txt-sec', style: { fontSize: '12px', marginTop: '2px' } }, subline),
                hasMultiBasket
                  ? el(
                    'div',
                    { className: 'tracker-basket-box' },
                    c.basketLeg1?.length ? renderBasketChips(c.basketLeg1, tr ? '1. ADIM ALIM' : 'STEP 1 BUY', 'txt-mint') : null,
                    c.basketLeg2?.length ? renderBasketChips(c.basketLeg2, tr ? '2. ADIM ÇIKIŞ' : 'STEP 2 EXIT', 'txt-gold') : null
                  )
                  : null
              )
            )
          ),
          el(
            'div',
            { className: 'cycle-numbers' },
            el(
              'div',
              { className: 'cycle-stat' },
              el('div', { className: 'cycle-stat-lbl' }, tr ? 'Başlangıç' : 'Capital'),
              el('div', { className: 'cycle-stat-val' }, money(c.capitalUsd))
            ),
            el(
              'div',
              { className: 'cycle-stat' },
              el('div', { className: 'cycle-stat-lbl' }, c.phase === 3 ? (tr ? 'Gerçekleşen Son' : 'Actual End') : (tr ? 'Hedef Dönüş' : 'Target End')),
              el('div', { className: 'cycle-stat-val' }, money(displayEnd))
            ),
            el(
              'div',
              { className: 'cycle-stat' },
              el('div', { className: 'cycle-stat-lbl' }, c.phase === 3 ? (tr ? 'Gerçekleşen Kâr' : 'Realized Profit') : (tr ? 'Beklenen Kâr' : 'Expected Profit')),
              el(
                'div',
                { className: `cycle-stat-val ${displayProfit >= 0 ? 'txt-mint' : 'txt-crimson'}` },
                `${money(displayProfit, true)} (${fmtPct(displayRoi, true)})`
              )
            )
          )
        ),
        // Progress Rails
        el(
          'div',
          { className: 'phase-rail-wrap' },
          el(
            'div',
            { className: 'phase-rail-meta num' },
            el(
              'span',
              { className: 'txt-sec', dataset: { countdownText: c.id } },
              c.phase === 3
                ? tr
                  ? `14 Günlük Döngü Tamamlandı (${fmtShortDate(c.completedAt || c.phaseStartedAt)})`
                  : `14-Day Cycle Completed (${fmtShortDate(c.completedAt || c.phaseStartedAt)})`
                : phaseReady
                  ? tr ? '7G Kilidi Açıldı — Sonraki Faza Geçebilirsiniz' : '7D Hold Cleared — Ready for Next Phase'
                  : `${tr ? 'Kalan Süre' : 'Remaining'}: ${fmtCountdown(remainingMs)}`
            ),
            el(
              'span',
              { className: 'txt-gold', dataset: { countdownPct: c.id } },
              c.phase === 3
                ? (tr ? '%100' : '100%')
                : tr ? `Faz ${c.phase}/2 • %${pct.toFixed(0)}` : `Phase ${c.phase}/2 • ${pct.toFixed(0)}%`
            )
          ),
          el(
            'div',
            { className: 'phase-bars-2col' },
            el(
              'div',
              { className: 'phase-track' },
              el('div', {
                className: `phase-fill ${c.phase > 1 || phaseReady ? 'is-done' : ''}`,
                dataset: { barP1: c.id },
                style: { width: `${c.phase > 1 ? 100 : pct}%` }
              })
            ),
            el(
              'div',
              { className: 'phase-track' },
              el('div', {
                className: `phase-fill ${c.phase === 3 || (c.phase === 2 && phaseReady) ? 'is-done' : ''}`,
                dataset: { barP2: c.id },
                style: { width: `${c.phase === 1 ? 0 : c.phase === 3 ? 100 : pct}%` }
              })
            )
          )
        ),
        // Footer Actions
        el(
          'div',
          { className: 'cycle-foot' },
          el(
            'span',
            { className: 'txt-muted', style: { fontSize: '11.5px' } },
            `${c.item1Name} → ${c.item2Name}`
          ),
          el(
            'div',
            { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
            c.phase === 1
              ? el(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-primary btn-sm',
                  onClick: () => {
                    c.phase = 2;
                    c.phaseStartedAt = new Date().toISOString();
                    app.saveCycles();
                    render();
                    app.toast(isTr() ? 'Faz 2 başlatıldı (7 günlük dönüş takas kilidi aktif).' : 'Phase 2 started (7-day return trade hold active).');
                  }
                },
                tr ? 'Faz 2’ye Geç →' : 'Advance to Phase 2 →'
              )
              : null,
            c.phase === 2
              ? el(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-mint btn-sm',
                  onClick: () => openCompleteModal(c)
                },
                tr ? '✓ Döngüyü Tamamla (Kâr İşle)' : '✓ Complete Cycle (Log P&L)'
              )
              : null,
            el(
              'button',
              {
                type: 'button',
                className: 'btn btn-sm',
                onClick: () => {
                  const nowIso = new Date().toISOString();
                  c.phase = 1;
                  c.phaseStartedAt = nowIso;
                  c.cycleStartedAt = nowIso;
                  c.actualEndUsd = null;
                  c.actualProfitUsd = null;
                  c.completedAt = null;
                  app.saveCycles();
                  render();
                  app.toast(isTr() ? 'Döngü Faz 1 başlangıcına sıfırlandı.' : 'Cycle reset back to Phase 1.');
                }
              },
              tr ? 'Sıfırla' : 'Reset'
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'btn btn-sm btn-danger',
                onClick: () => {
                  app.cycles = app.cycles.filter((x) => x.id !== c.id);
                  app.saveCycles();
                  render();
                  app.toast(isTr() ? 'Döngü kaydı silindi.' : 'Cycle deleted.');
                }
              },
              tr ? 'Sil' : 'Delete'
            )
          )
        )
      );

      listEl.appendChild(card);
    }
  }

  /**
   * Non-destructive 1-second tick: updates ONLY countdown labels and bar widths.
   */
  function tickCountdowns() {
    if (app.activeTab !== 'tracker') return;
    const now = Date.now();
    const tr = isTr();
    for (const c of app.cycles) {
      if (c.phase >= 3) continue;
      const startMs = new Date(c.phaseStartedAt).getTime();
      const rem = Math.max(0, startMs + SEVEN_DAYS_MS - now);
      const pct = Math.min(100, Math.max(0, ((now - startMs) / SEVEN_DAYS_MS) * 100));

      const txtNode = listEl?.querySelector(`[data-countdown-text="${CSS.escape(c.id)}"]`);
      const pctNode = listEl?.querySelector(`[data-countdown-pct="${CSS.escape(c.id)}"]`);
      const b1 = listEl?.querySelector(`[data-bar-p1="${CSS.escape(c.id)}"]`);
      const b2 = listEl?.querySelector(`[data-bar-p2="${CSS.escape(c.id)}"]`);

      if (txtNode) {
        txtNode.textContent =
          rem <= 0
            ? tr ? '7G Kilidi Açıldı — Sonraki Faza Geçebilirsiniz' : '7D Hold Cleared — Ready for Next Phase'
            : `${tr ? 'Kalan Süre' : 'Remaining'}: ${fmtCountdown(rem)}`;
      }
      if (pctNode) {
        pctNode.textContent = tr ? `Faz ${c.phase}/2 • %${pct.toFixed(0)}` : `Phase ${c.phase}/2 • ${pct.toFixed(0)}%`;
      }
      if (b1 && c.phase === 1) b1.style.width = `${pct}%`;
      if (b2 && c.phase === 2) b2.style.width = `${pct}%`;
    }
  }

  return { render, tickCountdowns };
}
