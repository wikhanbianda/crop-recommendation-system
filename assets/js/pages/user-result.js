import { boot, pageHead, $, h, icon, printPage, url, fmtDate, errorState, refreshIcons } from '../ui.js';
import { getExamination } from '../../../services/prediction.js';
import { examDetail, DISCLAIMER } from './_exam.js';
import { cropName } from '../crops.js';

boot({ role: 'user', nav: 'history', title: 'Hasil rekomendasi', crumbs: [['Riwayat', 'user/history.html']] }, async (main, user) => {
  const q = new URLSearchParams(location.search); const id = q.get('id');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) { main.innerHTML = pageHead('Hasil rekomendasi') + `<div class="card">${errorState(new Error('x'), false).replace('Tidak dapat memuat data', 'Identitas pemeriksaan tidak valid').replace(/<p>.*?<\/p>/, '<p>Buka hasil dari halaman Riwayat.</p>')}</div>`; refreshIcons(); return; }
  const e = await getExamination(id);
  if (!e) { main.innerHTML = pageHead('Hasil tidak ditemukan') + `<div class="card empty">${icon('search-x')}<h3>Pemeriksaan tidak ditemukan</h3><p>Data tidak ada atau bukan milik Anda.</p><a class="btn" href="${url('user/history.html')}">Ke riwayat</a></div>`; refreshIcons(); return; }
  document.title = `Hasil: ${cropName(e.predicted_crop)} · Crop Recommendation System`;
  main.innerHTML = pageHead('Hasil rekomendasi', `Pemeriksaan ${fmtDate(e.created_at)}`, `<button class="btn secondary" id="pr">${icon('printer')} Cetak hasil</button><button class="btn secondary" id="pdf">${icon('file-down')} Download PDF</button><a class="btn ghost" href="${url('user/history.html')}">${icon('history')} Lihat riwayat</a><a class="btn" href="${url('user/prediction.html')}">${icon('plus')} Pemeriksaan baru</a>`) +
  `<div class="print-only"><h2>Crop Recommendation System — Hasil Pemeriksaan</h2><p>Pengguna: ${h(user.full_name || user.email)} (${h(user.email)})</p></div>
  <div class="card">${examDetail(e)}</div>
  <div class="alert warn mt">${icon('triangle-alert')}<div><b>Catatan penting.</b> ${h(DISCLAIMER)}</div></div>
  <div class="card mt no-print"><h3>Ingin memahami hasilnya?</h3><p class="muted">Asisten AI dapat menjelaskan hasil ini. Saran AI dipisahkan dari hasil model dan hanya memakai data pemeriksaan ini bila Anda mengizinkannya.</p><a class="btn secondary" href="${url('ai-assistant/assistant.html?exam=' + e.id)}">${icon('sparkles')} Tanya AI tentang hasil ini</a></div>`;
  refreshIcons();
  const doPrint = () => { const t = document.title; document.title = `Hasil-${e.predicted_crop}-${e.created_at.slice(0, 10)}`; printPage(); document.title = t; };
  $('#pr').addEventListener('click', doPrint); $('#pdf').addEventListener('click', doPrint);
  if (q.get('print') === '1') setTimeout(doPrint, 400);
});
