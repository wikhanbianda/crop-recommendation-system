import { boot, pageHead, $, h, fmtDate, fmtNum, icon, drawChart, loadInto, url, skeleton } from '../ui.js';
import { from } from '../../../services/supabase.js';
import { cropName, cropEmoji } from '../crops.js';

boot({ role: 'user', nav: 'dashboard', title: 'Dashboard' }, async (main, user) => {
  main.innerHTML = pageHead(`Selamat datang, ${user.full_name || user.email}`, 'Ringkasan aktivitas pemeriksaan Anda.', `<a class="btn" href="${url('user/prediction.html')}">${icon('sprout')} Mulai pemeriksaan</a>`) + '<div id="body"></div>';
  await loadInto($('#body', main), async (el) => {
    const [{ data: recent, count }, { data: all }] = await Promise.all([
      from('examinations').select('id,predicted_crop,created_at').order('created_at', false).limit(5).count().run(),
      from('examinations').select('predicted_crop,created_at').order('created_at', false).limit(500).run()]);
    const last = recent[0];
    el.innerHTML = `<div class="stats"><div class="card stat"><span class="ico">${icon('clipboard-list')}</span><div><div class="v">${fmtNum(count, 0)}</div><div class="l">Total pemeriksaan</div></div></div>
      <div class="card stat blue"><span class="ico">${icon('calendar')}</span><div><div class="v" style="font-size:1.05rem">${last ? fmtDate(last.created_at) : 'Belum ada'}</div><div class="l">Pemeriksaan terakhir</div></div></div>
      <div class="card stat amber"><span class="ico">${icon('sprout')}</span><div><div class="v">${last ? `${cropEmoji(last.predicted_crop)} ${h(cropName(last.predicted_crop))}` : '–'}</div><div class="l">Rekomendasi terakhir</div></div></div>
      <div class="card stat violet"><span class="ico">${icon('user-round')}</span><div><div class="v" style="font-size:1.05rem">${h(user.email)}</div><div class="l">Akun Anda</div></div></div></div>
    <div class="grid cols-2"><div class="card"><h2>Riwayat pemeriksaan (14 hari terakhir)</h2><div class="chart-box sm" id="c1"></div></div>
      <div class="card"><h2>Rekomendasi yang paling sering</h2><div class="chart-box sm" id="c2"></div></div></div>
    <div class="grid cols-2 mt"><div class="card flush"><div style="padding:1.1rem 1.1rem 0"><h2>Pemeriksaan terbaru</h2></div>${recent.length ? `<div class="table-wrap"><table class="stack-table"><thead><tr><th>Tanggal</th><th>Rekomendasi</th><th></th></tr></thead><tbody>${recent.map((r) => `<tr><td data-l="Tanggal">${fmtDate(r.created_at)}</td><td data-l="Rekomendasi">${cropEmoji(r.predicted_crop)} ${h(cropName(r.predicted_crop))}</td><td><a class="btn sm secondary" href="${url('user/result.html?id=' + r.id)}">Detail</a></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${icon('inbox')}<h3>Belum ada pemeriksaan</h3><p>Mulai pemeriksaan pertama Anda untuk mendapat rekomendasi tanaman.</p><a class="btn" href="${url('user/prediction.html')}">Mulai pemeriksaan</a></div>`}</div>
      <div class="card"><h2>Tentang sistem ini</h2><p>Sistem memakai model Machine Learning yang dilatih dari dataset Crop Recommendation (2.200 data, 22 tanaman) untuk merekomendasikan tanaman dari kadar <b>N, P, K</b>, <b>suhu</b>, <b>kelembapan</b>, <b>pH</b>, dan <b>curah hujan</b>.</p><p class="muted small">Hasil berupa rekomendasi berbasis data, bukan jaminan hasil panen.</p><a class="btn secondary" href="${url('ai-assistant/assistant.html')}">${icon('sparkles')} Tanya Asisten AI</a></div></div>`;
    const days = []; for (let i = 13; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5); days.push(d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jayapura' })); }
    const cnt = Object.fromEntries(days.map((d) => [d, 0])); const byCrop = {};
    for (const r of all) { const d = new Date(r.created_at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Jayapura' }); if (d in cnt) cnt[d]++; byCrop[r.predicted_crop] = (byCrop[r.predicted_crop] || 0) + 1; }
    drawChart($('#c1', el), { type: 'bar', labels: days.map((d) => d.slice(5)), datasets: [{ label: 'Pemeriksaan', data: days.map((d) => cnt[d]) }] });
    const top = Object.entries(byCrop).sort((a, b) => b[1] - a[1]).slice(0, 6);
    drawChart($('#c2', el), { type: 'bar', horizontal: true, labels: top.map(([c]) => cropName(c)), datasets: [{ label: 'Jumlah', data: top.map(([, n]) => n) }] });
  }, { skel: skeleton(4) });
});
