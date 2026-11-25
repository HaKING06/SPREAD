/**
 * SPREAD (spread.haking.tr) — High-DPI Bespoke Canvas 2D Charting Engine
 *
 * Zero third-party charting dependencies:
 *  1. 12-Cycle Compound Growth Chart (Cash-Equivalent Realistic vs Theoretical Curve + Hover Crosshair)
 *  2. 5x5 Spread Sensitivity Risk Heatmap (Steam Hold Drop x Cashout Price Shift)
 *  3. Inline 90d -> 30d -> 7d -> 24h Sparklines for the Live Scanner
 */

import { isTr } from '../core/i18n.js';

function getChartColors() {
  const styles = getComputedStyle(document.documentElement);
  const v = (name, fb) => styles.getPropertyValue(name).trim() || fb;
  return {
    bg: v('--bg-inset', '#0a0c10'),
    grid: v('--border-hair', 'rgba(255,255,255,0.08)'),
    text: v('--text-muted', '#636c7e'),
    textStrong: v('--text-primary', '#f2efe9'),
    gold: v('--gold', '#f0b90b'),
    mint: v('--mint', '#10d981'),
    crimson: v('--crimson', '#f43f5e'),
    amber: v('--amber', '#f59e0b')
  };
}

function setupHiDpiCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(240, Math.floor(rect.width));
  const height = Math.max(160, Math.floor(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

/**
 * Interactive 12-Cycle Compounding Growth Curve
 */
export function renderCompoundChart(canvas, tooltipEl, cycles, capitalUsd, fmtMoneyFn) {
  if (!canvas || !cycles || cycles.length === 0) return;

  const { ctx, width, height } = setupHiDpiCanvas(canvas);
  const c = getChartColors();

  const pad = { top: 20, right: 20, bottom: 32, left: 66 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const pointsReal = [{ cycle: 0, val: capitalUsd }, ...cycles.map((r) => ({ cycle: r.cycle, val: r.cashEquivPortfolio }))];
  const pointsTheo = [{ cycle: 0, val: capitalUsd }, ...cycles.map((r) => ({ cycle: r.cycle, val: r.theoPortfolio }))];

  const allVals = [...pointsReal.map((p) => p.val), ...pointsTheo.map((p) => p.val)];
  let minVal = Math.min(...allVals, capitalUsd * 0.9);
  let maxVal = Math.max(...allVals, capitalUsd * 1.15);
  if (maxVal <= minVal) maxVal = minVal + 100;
  const span = maxVal - minVal;
  minVal = Math.max(0, minVal - span * 0.08);
  maxVal = maxVal + span * 0.1;

  const xAt = (cycleIdx) => pad.left + (cycleIdx / 12) * plotW;
  const yAt = (val) => pad.top + plotH - ((val - minVal) / (maxVal - minVal)) * plotH;

  function draw(hoverIdx = -1) {
    ctx.clearRect(0, 0, width, height);

    // Horizontal gridlines & Y labels
    ctx.font = '10.5px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const val = minVal + ((maxVal - minVal) * i) / steps;
      const y = yAt(val);
      ctx.strokeStyle = c.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();

      ctx.fillStyle = c.text;
      ctx.fillText(fmtMoneyFn(val), pad.left - 8, y);
    }

    // X axis labels
    const tr = isTr();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const k of [0, 2, 4, 6, 8, 10, 12]) {
      const x = xAt(k);
      ctx.fillStyle = c.text;
      ctx.fillText(k === 0 ? (tr ? 'G0' : 'D0') : `${tr ? 'D' : 'C'}${k}`, x, height - pad.bottom + 9);
    }

    // Baseline Capital0 dashed line
    const baseY = yAt(capitalUsd);
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = c.text;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(pad.left, baseY);
    ctx.lineTo(width - pad.right, baseY);
    ctx.stroke();
    ctx.restore();

    // Theoretical dashed Mint curve
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = c.mint;
    ctx.lineWidth = 1.75;
    ctx.beginPath();
    pointsTheo.forEach((pt, idx) => {
      const x = xAt(pt.cycle);
      const y = yAt(pt.val);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();

    // Realistic Gold gradient fill
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
    grad.addColorStop(0, 'rgba(240, 185, 11, 0.24)');
    grad.addColorStop(1, 'rgba(240, 185, 11, 0.01)');

    ctx.beginPath();
    pointsReal.forEach((pt, idx) => {
      const x = xAt(pt.cycle);
      const y = yAt(pt.val);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(xAt(12), pad.top + plotH);
    ctx.lineTo(xAt(0), pad.top + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Realistic Gold solid stroke
    ctx.strokeStyle = c.gold;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    pointsReal.forEach((pt, idx) => {
      const x = xAt(pt.cycle);
      const y = yAt(pt.val);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Data nodes
    pointsReal.forEach((pt) => {
      const x = xAt(pt.cycle);
      const y = yAt(pt.val);
      ctx.beginPath();
      ctx.arc(x, y, pt.cycle === hoverIdx ? 5 : 2.8, 0, Math.PI * 2);
      ctx.fillStyle = pt.cycle === hoverIdx ? c.textStrong : c.gold;
      ctx.fill();
    });

    // Hover crosshair
    if (hoverIdx >= 0 && hoverIdx <= 12) {
      const hx = xAt(hoverIdx);
      ctx.save();
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = c.gold;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(hx, pad.top);
      ctx.lineTo(hx, pad.top + plotH);
      ctx.stroke();
      ctx.restore();

      const ty = yAt(pointsTheo[hoverIdx].val);
      ctx.beginPath();
      ctx.arc(hx, ty, 4, 0, Math.PI * 2);
      ctx.fillStyle = c.mint;
      ctx.fill();
    }
  }

  draw(-1);

  canvas.onmousemove = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const rawIdx = Math.round(((mx - pad.left) / plotW) * 12);
    const idx = Math.max(0, Math.min(12, rawIdx));
    draw(idx);

    if (tooltipEl) {
      const realVal = pointsReal[idx].val;
      const theoVal = pointsTheo[idx].val;
      const days = idx * 14;
      tooltipEl.classList.remove('hidden');
      tooltipEl.textContent = '';
      const tr = isTr();
      const lines = [
        idx === 0
          ? tr ? 'Başlangıç (Gün 0)' : 'Start (Day 0)'
          : tr ? `${idx}. Döngü • ${days} Gün` : `Cycle ${idx} • ${days} Days`,
        `${tr ? 'Gerçekçi' : 'Realistic'}: ${fmtMoneyFn(realVal)}`,
        `${tr ? 'Teorik' : 'Theoretic'}: ${fmtMoneyFn(theoVal)}`
      ];
      lines.forEach((line, li) => {
        const div = document.createElement('div');
        div.textContent = line;
        if (li === 0) div.style.color = c.gold;
        if (li === 1) div.style.color = c.textStrong;
        if (li === 2) div.style.color = c.mint;
        tooltipEl.appendChild(div);
      });

      const tx = xAt(idx);
      const leftPos = tx > width * 0.62 ? tx - 172 : tx + 14;
      tooltipEl.style.left = `${Math.max(8, leftPos)}px`;
      tooltipEl.style.top = '18px';
    }
  };

  canvas.onmouseleave = () => {
    draw(-1);
    if (tooltipEl) tooltipEl.classList.add('hidden');
  };
}

/**
 * 5x5 Spread Sensitivity Risk Heatmap
 */
export function renderSensitivityHeatmap(canvas, tooltipEl, matrix) {
  if (!canvas || !matrix) return;

  const { ctx, width, height } = setupHiDpiCanvas(canvas);
  const c = getChartColors();
  const { shifts, grid } = matrix;

  const pad = { top: 34, right: 12, bottom: 26, left: 58 };
  const n = shifts.length;
  const cellW = (width - pad.left - pad.right) / n;
  const cellH = (height - pad.top - pad.bottom) / n;

  function cellColor(roi) {
    if (roi >= 20) return 'rgba(16, 217, 129, 0.36)';
    if (roi >= 10) return 'rgba(16, 217, 129, 0.24)';
    if (roi >= 2) return 'rgba(16, 217, 129, 0.14)';
    if (roi >= -2) return 'rgba(245, 158, 11, 0.20)';
    if (roi >= -10) return 'rgba(244, 63, 94, 0.20)';
    return 'rgba(244, 63, 94, 0.36)';
  }

  function draw(hoverCell = null) {
    ctx.clearRect(0, 0, width, height);

    // Axis titles
    const tr = isTr();
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = c.text;
    ctx.textAlign = 'center';
    ctx.fillText(
      tr ? '2. Yön Satış Fiyat Değişimi (%)' : 'Leg 2 Cashout Price Shift (%)',
      pad.left + (cellW * n) / 2,
      11
    );

    // Column headers
    shifts.forEach((sh, ci) => {
      ctx.fillStyle = sh === 0 ? c.gold : c.text;
      ctx.fillText(`${sh > 0 ? '+' : ''}${sh}%`, pad.left + ci * cellW + cellW / 2, 25);
    });

    // Row headers & cells
    ctx.textBaseline = 'middle';
    grid.forEach((row, ri) => {
      const y = pad.top + ri * cellH;
      const sh = shifts[ri];
      ctx.textAlign = 'right';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = sh === 0 ? c.gold : c.text;
      ctx.fillText(`S1 ${sh > 0 ? '+' : ''}${sh}%`, pad.left - 8, y + cellH / 2);

      row.forEach((cell, ci) => {
        const x = pad.left + ci * cellW;
        const inset = 2;
        ctx.fillStyle = cellColor(cell.roiPct);
        ctx.beginPath();
        ctx.roundRect(x + inset, y + inset, cellW - inset * 2, cellH - inset * 2, 5);
        ctx.fill();

        const isHover = hoverCell && hoverCell.ri === ri && hoverCell.ci === ci;
        if (cell.isCenter || isHover) {
          ctx.strokeStyle = isHover ? c.textStrong : c.gold;
          ctx.lineWidth = isHover ? 1.8 : 1.5;
          ctx.stroke();
        }

        ctx.textAlign = 'center';
        ctx.font = '600 11px "JetBrains Mono", monospace';
        ctx.fillStyle = cell.roiPct >= 0 ? c.mint : c.crimson;
        const sign = cell.roiPct >= 0 ? '+' : '';
        ctx.fillText(`${sign}${cell.roiPct.toFixed(1)}%`, x + cellW / 2, y + cellH / 2);
      });
    });

    ctx.textAlign = 'center';
    ctx.font = '9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = c.text;
    ctx.fillText(
      tr ? 'Altın çerçeve = Mevcut fiyat senaryosu (0% / 0%)' : 'Gold border = Current price baseline (0% / 0%)',
      pad.left + (cellW * n) / 2,
      height - 10
    );
  }

  draw(null);

  canvas.onmousemove = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const ci = Math.floor((mx - pad.left) / cellW);
    const ri = Math.floor((my - pad.top) / cellH);
    if (ri >= 0 && ri < n && ci >= 0 && ci < n) {
      const cell = grid[ri][ci];
      draw({ ri, ci });
      if (tooltipEl) {
        tooltipEl.classList.remove('hidden');
        tooltipEl.textContent = '';
        const tr = isTr();
        const l1 = document.createElement('div');
        l1.textContent = `Steam (S1): ${cell.s1Shift >= 0 ? '+' : ''}${cell.s1Shift}% | ${tr ? 'Nakit' : 'Cash'} (M2): ${cell.m2Shift >= 0 ? '+' : ''}${cell.m2Shift}%`;
        l1.style.color = c.text;
        const l2 = document.createElement('div');
        l2.textContent = `${tr ? 'Net Döngü ROI' : 'Net Cycle ROI'}: ${cell.roiPct >= 0 ? '+' : ''}${tr ? '%' : ''}${cell.roiPct.toFixed(2)}${tr ? '' : '%'}`;
        l2.style.color = cell.roiPct >= 0 ? c.mint : c.crimson;
        l2.style.fontWeight = '700';
        tooltipEl.appendChild(l1);
        tooltipEl.appendChild(l2);
        tooltipEl.style.left = '12px';
        tooltipEl.style.top = '12px';
      }
    } else {
      draw(null);
      if (tooltipEl) tooltipEl.classList.add('hidden');
    }
  };

  canvas.onmouseleave = () => {
    draw(null);
    if (tooltipEl) tooltipEl.classList.add('hidden');
  };
}

/**
 * Tiny inline Steam price history sparkline (90d -> 30d -> 7d -> 24h)
 */
export function drawSparkline(canvas, values) {
  if (!canvas || !Array.isArray(values) || values.length < 2) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = 68;
  const h = 24;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const valid = values.filter((v) => Number.isFinite(v) && v > 0);
  if (valid.length < 2) return;

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = max - min || 1;
  const trendUp = valid[valid.length - 1] >= valid[0];
  const color = trendUp ? '#10d981' : '#f43f5e';

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  valid.forEach((v, i) => {
    const x = 3 + (i / (valid.length - 1)) * (w - 6);
    const y = h - 4 - ((v - min) / range) * (h - 8);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  const lastX = w - 3;
  const lastY = h - 4 - ((valid[valid.length - 1] - min) / range) * (h - 8);
  ctx.beginPath();
  ctx.arc(lastX, lastY, 2.2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}
