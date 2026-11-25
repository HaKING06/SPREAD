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
    completeSummaryEl.textContent = `${cycle.item1Name} → ${cycle.item2Name} | Beklenen dönüş: ${fmtMoneyFromUsd(cycle.expectedEndUsd, cur, fx)}`;
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
    app.toast('Döngü tamamlandı ve gerçekleşen kâr deftere işlendi.');
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

    document.getElementById('trActiveCount').textContent = `${activeCount} aktif / ${app.cycles.length} toplam`;
    document.getElementById('trActiveCapital').textContent = money(activeCapitalUsd);

    const expEl = document.getElementById('trExpectedProfit');
    expEl.textContent = money(expectedProfitUsd, true);
    expEl.className = `kpi-card-value ${expectedProfitUsd >= 0 ? 'txt-mint' : 'txt-crimson'}`;

    const realEl = document.getElementById('trRealizedProfit');
    realEl.textContent = money(realizedProfitUsd, true);
    realEl.className = `kpi-card-value ${realizedProfitUsd >= 0 ? 'txt-gold' : 'txt-crimson'}`;

    document.getElementById('trReadySub').textContent =
      readyCount > 0 ? `${readyCount} döngü faz geçişine hazır` : 'Tüm aktif döngüler takas kilidinde';

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
          'Henüz bu filtrede döngü kaydı yok. Hesaplayıcı sekmesinden "+ Bu Döngüyü Takibe Al" ile 14 günlük yeni bir döngü başlatabilirsiniz.'
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
      let badgeTxt = 'Faz 1 • 7G Hold';
      let headline = `Faz 1 (Gün 0–7): ${mkt.name} Alındı → Steam Satışı Bekleniyor`;
      let subline = `${c.qty1}x ${c.item1Name} için 7 günlük Valve Trade Protection kilidi`;

      if (c.phase === 1 && phaseReady) {
        badgeCls = 'pill-mint';
        badgeTxt = "Faz 1 Hazır • Steam'de Satın";
      } else if (c.phase === 2) {
        headline = `Faz 2 (Gün 7–14): Steam Dönüş Eşyası Alındı → ${mkt.name} Nakit Dönüş Bekleniyor`;
        subline = `${c.qty2}x ${c.item2Name} için 7 günlük takas kilidi`;
        badgeCls = phaseReady ? 'pill-mint' : 'pill-ice';
        badgeTxt = phaseReady ? `Faz 2 Hazır • ${mkt.name}'te Satın` : 'Faz 2 • 7G Hold';
      } else if (c.phase === 3) {
        headline = 'Tamamlandı • Döngü Deftere İşlendi';
        subline = `${c.qty1}x ${c.item1Name} → ${c.qty2}x ${c.item2Name}${c.note ? ` • Not: ${c.note}` : ''}`;
        badgeCls = 'pill-gold';
        badgeTxt = 'Tamamlandı';
      }

      const displayProfit = c.phase === 3 && c.actualProfitUsd !== null ? c.actualProfitUsd : c.expectedProfitUsd;
      const displayEnd = c.phase === 3 && c.actualEndUsd !== null ? c.actualEndUsd : c.expectedEndUsd;
      const displayRoi = c.capitalUsd > 0 ? (displayProfit / c.capitalUsd) * 100 : 0;

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
              el('span', { className: 'txt-muted num', style: { fontSize: '11px' } }, `Başlangıç: ${fmtShortDate(c.cycleStartedAt)}`)
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
                el('p', { className: 'txt-sec', style: { fontSize: '12px', marginTop: '2px' } }, subline)
              )
            )
          ),
          el(
            'div',
            { className: 'cycle-numbers' },
            el(
              'div',
              { className: 'cycle-stat' },
              el('div', { className: 'cycle-stat-lbl' }, 'Başlangıç'),
              el('div', { className: 'cycle-stat-val' }, money(c.capitalUsd))
            ),
            el(
              'div',
              { className: 'cycle-stat' },
              el('div', { className: 'cycle-stat-lbl' }, c.phase === 3 ? 'Gerçekleşen Son' : 'Hedef Dönüş'),
              el('div', { className: 'cycle-stat-val' }, money(displayEnd))
            ),
            el(
              'div',
              { className: 'cycle-stat' },
              el('div', { className: 'cycle-stat-lbl' }, c.phase === 3 ? 'Gerçekleşen Kâr' : 'Beklenen Kâr'),
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
                ? `14 Günlük Döngü Tamamlandı (${fmtShortDate(c.completedAt || c.phaseStartedAt)})`
                : phaseReady
                ? '7G Kilidi Açıldı — Sonraki Faza Geçebilirsiniz'
                : `Kalan Süre: ${fmtCountdown(remainingMs)}`
            ),
            el(
              'span',
              { className: 'txt-gold', dataset: { countdownPct: c.id } },
              c.phase === 3 ? '%100' : `Faz ${c.phase}/2 • %${pct.toFixed(0)}`
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
                      app.toast('Faz 2 başlatıldı (7 günlük dönüş takas kilidi aktif).');
                    }
                  },
                  'Faz 2’ye Geç →'
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
                  '✓ Döngüyü Tamamla (Kâr İşle)'
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
                  app.toast('Döngü Faz 1 başlangıcına sıfırlandı.');
                }
              },
              'Sıfırla'
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
                  app.toast('Döngü kaydı silindi.');
                }
              },
              'Sil'
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
          rem <= 0 ? '7G Kilidi Açıldı — Sonraki Faza Geçebilirsiniz' : `Kalan Süre: ${fmtCountdown(rem)}`;
      }
      if (pctNode) {
        pctNode.textContent = `Faz ${c.phase}/2 • %${pct.toFixed(0)}`;
      }
      if (b1 && c.phase === 1) b1.style.width = `${pct}%`;
      if (b2 && c.phase === 2) b2.style.width = `${pct}%`;
    }
  }

  return { render, tickCountdowns };
}
