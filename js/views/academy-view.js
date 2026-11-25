/**
 * SPREAD (spread.haking.tr) — Interactive CS2 Arbitrage Academy View
 *
 * Includes interactive Steam $0.01+$0.01 Min-Fee Trap Lab comparing Exact Valve
 * cent-by-cent rounding against naive /1.15 calculation.
 */

import { calcExactValveSteamFee } from '../core/math-engine.js';

export function initAcademyView() {
  const slider = document.getElementById('feeLabRange');
  const numInput = document.getElementById('feeLabInput');
  const outNet = document.getElementById('feeLabNet');
  const outEff = document.getElementById('feeLabEff');
  const outDiff = document.getElementById('feeLabDiff');
  const outNote = document.getElementById('feeLabVerdict');

  function updateLab(valUsd) {
    const p = Math.max(0.03, Math.min(200, Number(valUsd) || 0.76));
    const exact = calcExactValveSteamFee(p);
    const naiveNet = p / 1.15;
    const diffUsd = exact.netUsd - naiveNet;

    if (outNet) outNet.textContent = `$${exact.netUsd.toFixed(2)}`;
    if (outEff) {
      outEff.textContent = `%${exact.effectiveFeePct.toFixed(2)}`;
      outEff.className = `metric-cell-val ${exact.isMinFeeTrap ? 'txt-crimson' : 'txt-mint'}`;
    }
    if (outDiff) {
      const sign = diffUsd >= 0 ? '+' : '';
      outDiff.textContent = `${sign}$${diffUsd.toFixed(4)} / adet`;
    }
    if (outNote) {
      if (exact.isMinFeeTrap) {
        outNote.textContent =
          `DİKKAT — Minimum Komisyon Tuzağı! $${p.toFixed(2)} satışta Steam $0.01 + CS2 $0.01 taban kesintisi yüzünden gerçek kesinti %${exact.effectiveFeePct.toFixed(2)} olur (klasik %13.04 varsayımından çok daha pahalı).`;
        outNote.className = 'alert-banner is-danger';
      } else {
        outNote.textContent =
          `Normal Bant: $${p.toFixed(2)} satışta Steam kesintisi $${exact.steamFeeUsd.toFixed(2)}, CS2 kesintisi $${exact.cs2FeeUsd.toFixed(2)} — net elinize $${exact.netUsd.toFixed(2)} geçer.`;
        outNote.className = 'alert-banner';
      }
    }
  }

  slider?.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    if (numInput) numInput.value = v.toFixed(2);
    updateLab(v);
  });

  numInput?.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    if (Number.isFinite(v) && v >= 0.03) {
      if (slider) slider.value = Math.min(25, v);
      updateLab(v);
    }
  });

  document.querySelectorAll('[data-lab-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = parseFloat(btn.dataset.labPreset);
      if (numInput) numInput.value = v.toFixed(2);
      if (slider) slider.value = Math.min(25, v);
      updateLab(v);
    });
  });

  updateLab(0.15);
}
