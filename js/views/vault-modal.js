/**
 * SPREAD (spread.haking.tr) — Local Data Vault Modal (JSON Backup/Restore + SHA-256 Check)
 */

import { Vault } from '../services/vault-storage.js';
import { clearNode, el } from '../core/security.js';
import { fmtShortDate } from '../core/formatters.js';

export function initVaultModal(app) {
  const modal = document.getElementById('vaultModal');
  const openBtn = document.getElementById('openVaultBtn');
  const closeBtn = document.getElementById('closeVaultBtn');
  const statsBox = document.getElementById('vaultStatsGrid');
  const exportBtn = document.getElementById('vaultExportJsonBtn');
  const exportCsvBtn = document.getElementById('vaultExportCsvBtn');
  const fileInput = document.getElementById('vaultFileInput');
  const previewBox = document.getElementById('vaultImportPreview');
  const resetBtn = document.getElementById('vaultResetBtn');

  let pendingBackup = null;
  let resetArmed = false;

  function renderStats() {
    clearNode(statsBox);
    const usage = Vault.getUsageStats();
    const cards = [
      { lbl: 'Takip Edilen Döngüler', val: String(app.cycles.length) },
      { lbl: 'Özel Eşyalar', val: String(app.customItems.length) },
      { lbl: 'İzleme Listesi', val: String(app.watchlist.length) },
      { lbl: 'Yerel Disk Kullanımı', val: `${usage.kb} KB` }
    ];

    for (const item of cards) {
      statsBox.appendChild(
        el(
          'div',
          { className: 'fee-lab-box' },
          el('div', { className: 'kpi-card-label' }, item.lbl),
          el('div', { className: 'num', style: { fontSize: '18px', fontWeight: '700', marginTop: '4px' } }, item.val)
        )
      );
    }
  }

  function renderPreview() {
    clearNode(previewBox);
    if (!pendingBackup) {
      previewBox.classList.add('hidden');
      return;
    }

    previewBox.classList.remove('hidden');
    const b = pendingBackup;
    previewBox.appendChild(
      el(
        'div',
        { className: 'panel panel-pad', style: { background: 'var(--bg-inset)', display: 'flex', flexDirection: 'column', gap: '10px' } },
        el(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' } },
          el('strong', { style: { fontSize: '13px' } }, `Yedek Önizlemesi (${b.app})`),
          el(
            'span',
            { className: `pill ${b.checksumValid ? 'pill-mint' : 'pill-amber'}` },
            b.checksumValid ? '✓ SHA-256 Bütünlüğü Doğrulandı' : '⚠ Dosya Manuel Düzenlenmiş'
          )
        ),
        el(
          'div',
          { className: 'txt-sec num', style: { fontSize: '12px' } },
          `Tarih: ${fmtShortDate(b.exportedAt)} • ${b.data.cycles.length} döngü • ${b.data.customItems.length} özel eşya • ${b.data.watchlist.length} favori`
        ),
        el(
          'div',
          { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          el(
            'button',
            {
              type: 'button',
              className: 'btn btn-primary btn-sm',
              onClick: () => {
                Vault.applyBackup(b.data, 'merge');
                pendingBackup = null;
                app.reloadFromVault();
                close();
                app.toast('JSON yedeği mevcut verilerle birleştirildi.');
              }
            },
            'Mevcut Verilerle Birleştir'
          ),
          el(
            'button',
            {
              type: 'button',
              className: 'btn btn-sm',
              onClick: () => {
                Vault.applyBackup(b.data, 'replace');
                pendingBackup = null;
                app.reloadFromVault();
                close();
                app.toast('JSON yedeği başarıyla geri yüklendi.');
              }
            },
            'Tamamen Üzerine Yaz'
          ),
          el(
            'button',
            {
              type: 'button',
              className: 'btn btn-ghost btn-sm',
              onClick: () => {
                pendingBackup = null;
                renderPreview();
              }
            },
            'İptal'
          )
        )
      )
    );
  }

  function open() {
    resetArmed = false;
    if (resetBtn) resetBtn.textContent = 'Tüm Yerel Verileri Temizle';
    pendingBackup = null;
    renderStats();
    renderPreview();
    modal.classList.remove('hidden');
  }

  function close() {
    modal.classList.add('hidden');
  }

  openBtn?.addEventListener('click', open);
  closeBtn?.addEventListener('click', close);
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  exportBtn?.addEventListener('click', async () => {
    const envelope = await Vault.createBackupEnvelope();
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const dateTag = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spread-haking-tr-backup-${dateTag}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    app.toast('SHA-256 doğrulamalı JSON yedeği indirildi.');
  });

  exportCsvBtn?.addEventListener('click', () => {
    app.exportCyclesCsv();
  });

  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      pendingBackup = await Vault.parseAndVerifyBackup(text);
      renderPreview();
    } catch (err) {
      pendingBackup = null;
      renderPreview();
      app.toast(err.message || 'Yedek dosyası okunamadı.', 'err');
    } finally {
      fileInput.value = '';
    }
  });

  resetBtn?.addEventListener('click', () => {
    if (!resetArmed) {
      resetArmed = true;
      resetBtn.textContent = 'Emin misin? Tekrar Tıkla (Sıfırla)';
      return;
    }
    Vault.clearAll();
    resetArmed = false;
    app.reloadFromVault();
    close();
    app.toast('Tüm yerel kasa verileri sıfırlandı.', 'warn');
  });

  return { open, close };
}
