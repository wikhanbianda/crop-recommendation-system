import { boot, pageHead, $, h, icon, fmtNum, fmtDate, pct, drawChart, loadInto, skeleton, url, refreshIcons } from '../ui.js';
import { rpc } from '../../../services/supabase.js';
import { cropName } from '../crops.js';
import { recentExamTable } from './_admin-exams.js';

boot({ role: 'admin', nav: 'dashboard', title: 'Dashboard Admin' }, async (main) => {
  main.innerHTML = pageHead('Dashboard Admin', 'Ringkasan penggunaan aplikasi dari data terbaru di database.', `<a class="btn secondary" href="${url('admin/reports.html')}">${icon('bar-chart-3')} Laporan</a>`) + '<div id="body"></div><div id="recent" class="mt"></div>';
  await loadInto($('#body', main), async (el) => {
    const s = await rpc('admin_stats'); const am = s.active_model;
    el.innerHTML = `<div class="stats">
    <div class="card stat"><span class="ico">${icon('users')}</span><div><div class="v">${fmtNum(s.total_users, 0)}</div><div class="l">Total pengguna</div></div></div>
    <div class="card stat blue"><span class="ico">${icon('clipboard-list')}</span><div><div class="v">${fmtNum(s.total_exams, 0)}</div><div class="l">Total pemeriksaan</div></div></div>
    <div class="card stat amber"><span class="ico">${icon('zap')}</span><div><div class="v">${fmtNum(s.exams_today, 0)}</div><div class="l">Prediksi hari ini</div></div></div>
    <div class="card stat violet"><span class="ico">${icon('sprout')}</span><div><div class="v">${fmtNum(s.crops_in_model, 0)}</div><div class="l">Jenis tanaman (model) · ${fmtNum(s.crops_recommended, 0)} pernah direkomendasikan</div></div></div>
    <div class="card stat"><span class="ico">${icon('database')}</span><div><div class="v">${fmtNum(s.total_datasets, 0)}</div><div class="l">Total dataset</div></div></div>
    <div class="card stat ${am ? '' : 'amber'}"><span class="ico">${icon('brain-circuit')}</span><div><div class="v" style="font-size:1.05rem">${am ? `${h(am.algorithm)} ${h(am.version)}` : 'Belum ada model aktif'}</div><div class="l">${am ? `Aktif · akurasi uji ${pct(am.accuracy)}` : 'Status model'}</div></div></div></div>
    <div class="grid cols-2"><div class="card"><h2>Pemeriksaan per hari (30 hari)</h2><div class="chart-box" id="c1"></div></div><div class="card"><h2>Distribusi rekomendasi tanaman</h2><div class="chart-box" id="c2"></div></div>
    <div class="card"><h2>Aktivitas pengguna (teratas)</h2><div class="chart-box" id="c3"></div></div><div class="card"><h2>Pemeriksaan per bulan (12 bulan)</h2><div class="chart-box" id="c4"></div></div></div>
    <div class="card mt"><h2>Statistik penggunaan</h2><dl class="kv"><dt>Pengguna aktif 7 hari</dt><dd>${fmtNum(s.active_users_7d, 0)}</dd><dt>Pesan AI 30 hari</dt><dd>${fmtNum(s.ai_messages_30d, 0)}</dd><dt>Rata-rata pemeriksaan / pengguna</dt><dd>${s.total_users ? fmtNum(s.total_exams / s.total_users, 1) : '–'}</dd></dl></div>`;
    drawChart($('#c1', el), { type: 'line', labels: s.daily.map((d) => d.date.slice(5)), datasets: [{ label: 'Pemeriksaan', data: s.daily.map((d) => d.count) }] });
    const top = s.by_crop.slice(0, 10); drawChart($('#c2', el), { type: 'doughnut', labels: top.map((c) => cropName(c.crop)), datasets: [{ label: 'Rekomendasi', data: top.map((c) => c.count) }] });
    drawChart($('#c3', el), { type: 'bar', horizontal: true, labels: s.top_users.map((u) => u.user), datasets: [{ label: 'Pemeriksaan', data: s.top_users.map((u) => u.count) }] });
    drawChart($('#c4', el), { type: 'bar', labels: s.monthly.map((m) => m.month), datasets: [{ label: 'Pemeriksaan', data: s.monthly.map((m) => m.count) }] });
  }, { skel: skeleton(5) });
  recentExamTable($('#recent', main), { title: 'Pemeriksaan terbaru', size: 8 });
});
