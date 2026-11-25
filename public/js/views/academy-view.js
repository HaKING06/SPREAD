/**
 * SPREAD (spread.haking.tr) — Bilingual Interactive Steam Fee Trap Lab (Academy View)
 */

import { calcExactValveSteamFee } from '../core/math-engine.js';
import { isTr } from '../core/i18n.js';

export function initAcademyView() {
  const slider = document.getElementById('feeLabRange');
  const numInput = document.getElementById('feeLabInput');
  const outNet = document.getElementById('feeLabNet');
  const outEff = document.getElementById('feeLabEff');
  const outDiff = document.getElementById('feeLabDiff');
  const outNote = document.getElementById('feeLabVerdict');

  let currentVal = 0.15;

  function updateLab(valUsd) {
    const tr = isTr();
    const p = Math.max(0.03, Math.min(200, Number(valUsd) || 0.15));
    currentVal = p;
    const exact = calcExactValveSteamFee(p);
    const naiveNet = p / 1.15;
    const diffUsd = exact.netUsd - naiveNet;

    if (outNet) outNet.textContent = `$${exact.netUsd.toFixed(2)}`;
    if (outEff) {
      outEff.textContent = tr ? `%${exact.effectiveFeePct.toFixed(2)}` : `${exact.effectiveFeePct.toFixed(2)}%`;
      outEff.className = `metric-cell-val ${exact.isMinFeeTrap ? 'txt-crimson' : 'txt-mint'}`;
    }
    if (outDiff) {
      const sign = diffUsd >= 0 ? '+' : '';
      outDiff.textContent = `${sign}$${diffUsd.toFixed(4)} / ${tr ? 'adet' : 'unit'}`;
    }
    if (outNote) {
      if (exact.isMinFeeTrap) {
        outNote.textContent = tr
          ? `DİKKAT — Minimum Komisyon Tuzağı! $${p.toFixed(2)} satışta Steam $0.01 + CS2 $0.01 taban kesintisi yüzünden gerçek kesinti %${exact.effectiveFeePct.toFixed(2)} olur (klasik %13.04 varsayımından çok daha pahalı).`
          : `WARNING — Minimum Fee Trap! At $${p.toFixed(2)}, Valve's $0.01 Steam + $0.01 CS2 minimum floor pushes your real cut to ${exact.effectiveFeePct.toFixed(2)}% (far higher than the naive 13.04% estimate).`;
        outNote.className = 'alert-banner is-danger';
      } else {
        outNote.textContent = tr
          ? `Normal Bant: $${p.toFixed(2)} satışta Steam kesintisi $${exact.steamFeeUsd.toFixed(2)}, CS2 kesintisi $${exact.cs2FeeUsd.toFixed(2)} — net elinize $${exact.netUsd.toFixed(2)} geçer.`
          : `Standard Band: At $${p.toFixed(2)}, Steam fee is $${exact.steamFeeUsd.toFixed(2)} and CS2 fee is $${exact.cs2FeeUsd.toFixed(2)} — you receive $${exact.netUsd.toFixed(2)} net.`;
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

  updateLab(currentVal);

  return {
    render: () => updateLab(currentVal)
  };
}
