import { boot, pageHead, $, h, icon, fmtDate, fmtNum, loadInto, modal, confirmBox, toast, toastError, setErrors, withLoading, refreshIcons, emptyState } from '../ui.js';
import { datasets, models } from '../../../services/api.js';
import { cropName } from '../crops.js';

const STAT = { uploaded: ['Diunggah', ''], validated: ['Tervalidasi', 'blue'], invalid: ['Tidak valid', 'red'], trained: ['Sudah dilatih', 'amber'], active: ['Aktif', 'green'], archived: ['Diarsipkan', ''] };
boot({ role: 'admin', nav: 'datasets', title: 'Dataset', crumbs: [['Data & Model']] }, async (main) => {
  main.innerHTML = pageHead('Manajemen dataset', 'Dataset baru tidak langsung mengganti model aktif: harus divalidasi, dilatih, dievaluasi, lalu disetujui di halaman Model ML.', `<button class="btn" id="up">${icon('upload')} Upload dataset</button>`) +
  `<div class="alert info">${icon('info')}<div>Format: CSV maksimal 2 MB dengan kolom <code>N, P, K, temperature, humidity, ph, rainfall, label</code>. Berkas disimpan di bucket privat; tidak ada tautan publik.</div></div><div class="card flush" id="t"></div>`;
  const load = () => loadInto($('#t'), async (el) => {
    const { datasets: rows } = await datasets.list();
    if (!rows.length) { el.innerHTML = emptyState('Belum ada dataset', 'Upload dataset CSV pertama.'); refreshIcons(); return; }
    el.innerHTML = `<div class="table-wrap"><table class="stack-table"><thead><tr><th>Nama</th><th>Versi</th><th class="num">Baris</th><th class="num">Fitur</th><th class="num">Kelas</th><th>Status</th><th>Diunggah</th><th>Aksi</th></tr></thead><tbody>${rows.map((d) => `<tr><td data-l="Nama">${h(d.dataset_name)}</td><td data-l="Versi"><code>${h(d.version)}</code></td><td class="num" data-l="Baris">${fmtNum(d.total_rows, 0)}</td><td class="num" data-l="Fitur">${d.total_features}</td><td class="num" data-l="Kelas">${d.total_classes}</td><td data-l="Status"><span class="badge ${(STAT[d.status] || [])[1]}">${h((STAT[d.status] || [d.status])[0])}</span></td><td data-l="Diunggah" class="nowrap">${fmtDate(d.created_at, false)}<br><span class="muted small">${h(d.profiles?.email || '–')}</span></td>
      <td data-l="Aksi" class="nowrap"><button class="btn sm secondary" data-v="${h(d.id)}">Lihat</button> ${['validated', 'trained'].includes(d.status) ? `<button class="btn sm" data-t="${h(d.id)}">Latih model</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
    el.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => view(b.dataset.v)));
    el.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => train(rows.find((d) => d.id === b.dataset.t))));
    refreshIcons();
  });
  async function view(id) {
    try {
      const r = await datasets.preview(id); const rep = r.report; const cc = Object.entries(rep.class_counts || {});
      modal({ title: `Dataset ${r.dataset.version}`, size: 'lg', body: `${rep.valid ? '<div class="alert ok">Dataset valid.</div>' : `<div class="alert err"><div><b>Dataset tidak valid:</b><ul>${(rep.errors || []).map((e) => `<li>${h(e)}</li>`).join('')}</ul></div></div>`}
      <div class="grid cols-2"><div><h3>Ringkasan</h3><dl class="kv"><dt>Baris mentah</dt><dd>${fmtNum(rep.rows_raw, 0)}</dd><dt>Duplikat dihapus</dt><dd>${fmtNum(rep.duplicates_removed, 0)}</dd><dt>Baris bersih</dt><dd>${fmtNum(rep.rows_clean, 0)}</dd><dt>Fitur</dt><dd>${rep.n_features}</dd><dt>Kelas</dt><dd>${rep.n_classes}</dd><dt>SHA-256</dt><dd class="small">${h(r.dataset.sha256 || '–')}</dd></dl></div>
      <div><h3>Struktur kolom</h3>${rep.columns ? `<table><thead><tr><th>Kolom</th><th>Tipe</th><th class="num">Kosong</th></tr></thead><tbody>${rep.columns.map((c) => `<tr><td>${h(c.name ?? c)}</td><td>${h(c.dtype || '')}</td><td class="num">${fmtNum(c.missing ?? (rep.missing_per_column || {})[c.name ?? c], 0)}</td></tr>`).join('')}</tbody></table>` : `<table><thead><tr><th>Kolom</th><th class="num">Kosong</th></tr></thead><tbody>${Object.entries(rep.missing_per_column || {}).map(([k, v]) => `<tr><td>${h(k)}</td><td class="num">${v}</td></tr>`).join('')}</tbody></table>`}</div></div>
      ${cc.length ? `<h3 class="mt">Jumlah data per kelas</h3><p class="small">${cc.map(([k, v]) => `<span class="badge">${h(cropName(k))}: ${v}</span>`).join(' ')}</p>` : ''}
      ${rep.sample ? `<h3>Sampel data</h3><div class="table-wrap"><table><thead><tr>${Object.keys(rep.sample[0] || {}).map((k) => `<th>${h(k)}</th>`).join('')}</tr></thead><tbody>${rep.sample.map((r2) => `<tr>${Object.values(r2).map((v) => `<td>${h(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}` });
    } catch (e) { toastError(e); }
  }
  async function train(d) {
    if (!(await confirmBox({ title: 'Latih model dari dataset ini?', text: 'Training berjalan di layanan Python (beberapa menit). Hasilnya menjadi KANDIDAT dan tidak mengganti model aktif sebelum Anda menyetujuinya di halaman Model ML.' }))) return;
    try { const r = await models.train(d.id); toast('Training dimulai: ' + r.version, 'info'); location.assign(new URL('models.html?watch=' + encodeURIComponent(r.version), location.href).href); } catch (e) { toastError(e); }
  }
  $('#up').addEventListener('click', () => {
    const f = document.createElement('form'); f.noValidate = true;
    f.innerHTML = `<div class="field"><label for="u-file">Berkas CSV</label><input id="u-file" name="file" type="file" accept=".csv,text/csv"><span class="hint">Maksimal 2 MB, ekstensi .csv.</span><span class="error"></span></div><div class="field"><label for="u-name">Nama dataset (opsional)</label><input id="u-name" name="name" type="text" maxlength="160"><span class="error"></span></div><div class="field"><label for="u-ver">Versi (opsional)</label><input id="u-ver" name="version" type="text" maxlength="40" placeholder="mis. ds-2026-11"><span class="hint">Huruf, angka, titik, strip, garis bawah. Kosong = dibuat otomatis.</span><span class="error"></span></div>`;
    modal({ title: 'Upload dataset', body: f, buttons: [{ label: 'Batal', cls: 'ghost' }, { label: 'Upload & validasi', value: true, onClick: async () => {
      setErrors(f); const file = f.file.files[0]; const errs = {};
      if (!file) errs.file = 'Pilih berkas CSV.'; else if (!/\.csv$/i.test(file.name)) errs.file = 'Berkas harus berekstensi .csv.'; else if (file.size > 2 * 1024 * 1024) errs.file = 'Ukuran maksimal 2 MB.'; else if (file.size === 0) errs.file = 'Berkas kosong.';
      if (Object.keys(errs).length) { setErrors(f, errs); return false; }
      try { const r = await datasets.upload(file, { name: f.name.value.trim(), version: f.version.value.trim() }); toast(r.report.valid ? 'Dataset valid dan tersimpan.' : 'Dataset tersimpan tetapi TIDAK valid.', r.report.valid ? 'success' : 'warn'); load(); return true; }
      catch (e) { if (e.fields) setErrors(f, e.fields); throw e; } } }] });
  });
  load();
});
