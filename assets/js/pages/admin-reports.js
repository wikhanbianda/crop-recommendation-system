import { boot, pageHead, $, h, icon, fmtNum, fmtDate, drawChart, loadInto, toast, toastError, printPage, downloadCsv, refreshIcons, skeleton } from '../ui.js';
import { rpc, from } from '../../../services/supabase.js';
import { cropOptions } from './_exam.js';
import { cropName } from '../crops.js';

boot({ role: 'admin', nav: 'reports', title: 'Laporan', crumbs: [['Administrasi']] }, async (main) => {
  main.innerHTML = pageHead('Laporan & statistik', 'Dihitung langsung dari data database dengan filter.', `<button class="btn secondary" id="csv">${icon('download')} Export CSV</button><button class="btn secondary" id="pdf">${icon('file-down')} Export PDF</button>`) +
  `<div class="card mb no-print"><div class="filters"><div class="field"><label for="f1">Dari tanggal</label><input id="f1" type="date"></div><div class="field"><label for="f2">Sampai tanggal</label><input id="f2" type="date"></div>
  <div class="field"><label for="fu">Pengguna</label><select id="fu"><option value="">Semua pengguna</option></select></div><div class="field"><label for="fc">Tanaman</label><select id="fc">${cropOptions()}</select></div><button class="btn" id="go">Terapkan</button></div></div><div id="rep"></div>`;
  from('profiles').select('id,email,full_name').order('email', true).limit(500).run().then(({ data }) => { $('#fu').insertAdjacentHTML('beforeend', data.map((u) => `<option value="${h(u.id)}">${h(u.full_name || u.email)} (${h(u.email)})</option>`).join('')); }).catch(toastError);
  let cur = null;
  const args = () => ({ p_from: $('#f1').value || null, p_to: $('#f2').value || null, p_user: $('#fu').value || null, p_crop: $('#fc').value || null });
  const load = () => loadInto($('#rep'), async (el) => {
    const a = args(); if (a.p_from && a.p_to && a.p_from > a.p_to) throw new Error('Tanggal awal tidak boleh setelah tanggal akhir.');
    const r = cur = await rpc('admin_report_summary', a);
    const A = r.avg || {};
    el.innerHTML = `<div class="print-only"><h2>Laporan Crop Recommendation System</h2><p>Dicetak ${fmtDate(new Date())}. Filter: ${a.p_from || a.p_to ? `${h(a.p_from || 'awal')} s/d ${h(a.p_to || 'sekarang')}` : 'semua tanggal'}</p></div>
    <div class="stats"><div class="card stat"><span class="ico">${icon('clipboard-list')}</span><div><div class="v">${fmtNum(r.total, 0)}</div><div class="l">Pemeriksaan</div></div></div><div class="card stat blue"><span class="ico">${icon('users')}</span><div><div class="v">${fmtNum(r.users, 0)}</div><div class="l">Pengguna aktif</div></div></div><div class="card stat amber"><span class="ico">${icon('sprout')}</span><div><div class="v">${r.by_crop.length}</div><div class="l">Jenis tanaman direkomendasikan</div></div></div></div>
    ${r.total ? `<div class="grid cols-2"><div class="card"><h2>Rekomendasi tanaman</h2><div class="chart-box" id="g1"></div></div><div class="card"><h2>Pemeriksaan per hari</h2><div class="chart-box" id="g2"></div></div></div>
    <div class="grid cols-2 mt"><div class="card"><h2>Rata-rata parameter masukan</h2><dl class="kv"><dt>Nitrogen (N)</dt><dd>${A.N}</dd><dt>Fosfor (P)</dt><dd>${A.P}</dd><dt>Kalium (K)</dt><dd>${A.K}</dd><dt>Suhu</dt><dd>${A.temperature} °C</dd><dt>Kelembapan</dt><dd>${A.humidity} %</dd><dt>pH</dt><dd>${A.ph}</dd><dt>Curah hujan</dt><dd>${A.rainfall} mm</dd></dl></div>
    <div class="card flush"><div style="padding:1.1rem 1.1rem 0"><h2>Laporan rekomendasi tanaman</h2></div><div class="table-wrap"><table><thead><tr><th>Tanaman</th><th class="num">Jumlah</th><th class="num">%</th></tr></thead><tbody>${r.by_crop.map((c) => `<tr><td>${h(cropName(c.crop))}</td><td class="num">${c.count}</td><td class="num">${(c.count / r.total * 100).toFixed(1)}</td></tr>`).join('')}</tbody></table></div></div></div>
    <div class="card flush mt"><div style="padding:1.1rem 1.1rem 0"><h2>Laporan aktivitas pengguna</h2></div><div class="table-wrap"><table><thead><tr><th>Pengguna</th><th>Email</th><th class="num">Pemeriksaan</th><th>Terakhir</th></tr></thead><tbody>${r.by_user.map((u) => `<tr><td>${h(u.name || '–')}</td><td>${h(u.email)}</td><td class="num">${u.count}</td><td>${fmtDate(u.last)}</td></tr>`).join('')}</tbody></table></div></div>` : '<div class="card"><div class="empty"><h3>Tidak ada data</h3><p>Tidak ada pemeriksaan pada filter ini.</p></div></div>'}`;
    if (r.total) { drawChart($('#g1', el), { type: 'bar', horizontal: true, labels: r.by_crop.slice(0, 12).map((c) => cropName(c.crop)), datasets: [{ label: 'Jumlah', data: r.by_crop.slice(0, 12).map((c) => c.count) }] });
      drawChart($('#g2', el), { type: 'line', labels: r.by_day.map((d) => d.date.slice(5)), datasets: [{ label: 'Pemeriksaan', data: r.by_day.map((d) => d.count) }] }); }
    refreshIcons();
  }, { skel: skeleton(4) });
  $('#go').addEventListener('click', load);
  $('#pdf').addEventListener('click', () => { if (!cur) return toast('Muat laporan terlebih dahulu.', 'warn'); printPage(); });
  $('#csv').addEventListener('click', () => { if (!cur || !cur.total) return toast('Tidak ada data untuk diekspor.', 'warn'); const a = args();
    downloadCsv('laporan.csv', ['Bagian', 'Nama', 'Email', 'Jumlah', 'Keterangan'], [['Filter', (a.p_from || a.p_to ? `${a.p_from || 'awal'} s/d ${a.p_to || 'sekarang'}` : 'semua tanggal'), '', cur.total, `${cur.users} pengguna`], ...cur.by_crop.map((c) => ['Rekomendasi', cropName(c.crop), '', c.count, '']), ...cur.by_day.map((d) => ['Per hari', d.date, '', d.count, '']), ...cur.by_user.map((u) => ['Pengguna', u.name || '', u.email, u.count, fmtDate(u.last)])]); toast('CSV diekspor.'); });
  load();
});
