import { boot, pageHead, $, h, icon, toast, withLoading, refreshIcons } from '../ui.js';
import { cropName, cropEmoji } from '../crops.js';
import { status, prepareImage, predictSoil } from '../../../services/soil.js';
import { ApiError } from '../../../services/supabase.js';

const SOIL = { alluvial: 'Tanah aluvial', black: 'Tanah hitam', red: 'Tanah merah', laterite: 'Tanah laterit', yellow: 'Tanah kuning', arid: 'Tanah kering (arid)', mountain: 'Tanah pegunungan', clay: 'Tanah liat', sandy: 'Tanah berpasir', loam: 'Tanah lempung' };
const soilName = (s) => SOIL[s] || s;
const pct = (v) => `${(v * 100).toFixed(1).replace('.', ',')}%`;

boot({ role: 'user', nav: 'soil', title: 'Rekomendasi dari foto tanah', crumbs: [['Pemeriksaan']] }, async (main) => {
  main.innerHTML = pageHead('Rekomendasi dari foto tanah', 'Unggah foto tanah, sistem mengenali jenis tanahnya lalu menampilkan tanaman yang umumnya cocok.') +
  `<div class="alert info">${icon('info')}<div>Foto sebaiknya close-up permukaan tanah, terang merata, tanpa bayangan, tanpa tangan atau daun. Foto dikecilkan di perangkat Anda dan <b>tidak disimpan</b> di server.</div></div>
  <div id="serr" class="alert err" hidden role="alert"></div><div id="state"></div>
  <form id="f" class="card" novalidate hidden><div class="field"><label for="img">${icon('image')} Foto tanah</label>
    <input id="img" type="file" accept="image/jpeg,image/png,image/webp"><span class="hint">JPG, PNG, atau WebP, maksimal 12 MB.</span></div>
    <div id="pv" class="mt" hidden><img id="pvimg" alt="Pratinjau foto tanah" style="max-width:100%;max-height:260px;border-radius:12px"></div>
    <div class="actions mt"><button class="btn" type="submit" disabled>${icon('sprout')} Kenali Tanah dan Rekomendasikan Tanaman</button></div></form>
  <div id="res" class="mt"></div>`;
  refreshIcons();
  const f = $('#f'), se = $('#serr'), btn = $('button[type=submit]', f), inp = $('#img');
  let prepared = null;
  const fail = (m) => { se.hidden = false; se.textContent = m; se.scrollIntoView({ block: 'nearest' }); };

  try {
    const s = await status();
    if (!s.available) { $('#state').innerHTML = `<div class="alert warn" role="status">${icon('alert-triangle')}<div><b>Model gambar tanah belum dilatih.</b> Fitur ini aktif setelah administrator melatih model dengan dataset gambar tanah.</div></div>`; refreshIcons(); return; }
    f.hidden = false;
    $('#state').innerHTML = `<p class="muted">Model: ${h(s.model.algorithm)} · versi ${h(s.model.version)} · akurasi uji ${pct(s.model.metrics.accuracy)} pada ${h(String(s.model.images_used))} gambar.</p>`;
  } catch (e) { fail(e instanceof ApiError ? e.message : 'Status model tidak dapat dimuat.'); return; }

  inp.addEventListener('change', async () => {
    se.hidden = true; prepared = null; btn.disabled = true; $('#pv').hidden = true; $('#res').innerHTML = '';
    if (!inp.files[0]) return;
    try { prepared = await prepareImage(inp.files[0]); $('#pvimg').src = prepared.preview; $('#pv').hidden = false; btn.disabled = false; }
    catch (e) { fail(e.message); inp.value = ''; }
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!prepared) return; se.hidden = true;
    await withLoading(btn, async () => {
      try { render(await predictSoil(prepared.blob)); }
      catch (err) { fail(err instanceof ApiError ? err.message : 'Terjadi kesalahan tak terduga.'); }
    });
  });

  function render(r) {
    const top = r.crops[0]?.score || 1;
    $('#res').innerHTML = `${r.low_confidence ? `<div class="alert warn" role="status">${icon('alert-triangle')}<div>Keyakinan model rendah (di bawah 50%). Coba foto yang lebih jelas dan terang.</div></div>` : ''}
    <div class="grid cols-2"><div class="card"><h2>Jenis tanah terdeteksi</h2><p style="font-size:1.4rem;margin:.4rem 0"><b>${h(soilName(r.predicted_soil))}</b></p>
      ${r.soil_probabilities.map((s) => `<div class="row" style="display:flex;justify-content:space-between"><span>${h(soilName(s.soil))}</span><span>${pct(s.probability)}</span></div>`).join('')}
      <p class="muted mt">Model ${h(r.algorithm)} · ${h(r.model_version)}</p></div>
    <div class="card"><h2>Tanaman yang umumnya cocok</h2>${r.crops.length ? r.crops.map((c) => `<div style="margin:.5rem 0"><div style="display:flex;justify-content:space-between"><span>${cropEmoji(c.crop)} ${h(cropName(c.crop))}</span><span>${Math.round((c.score / top) * 100)}%</span></div><div style="height:8px;background:#e5eae6;border-radius:6px"><div style="height:8px;width:${Math.round((c.score / top) * 100)}%;background:#166534;border-radius:6px"></div></div></div>`).join('') : '<p>Belum ada pemetaan tanaman untuk jenis tanah ini.</p>'}</div></div>
    <div class="alert info mt">${icon('info')}<div><b>Catatan.</b> Jenis tanah dikenali oleh model Machine Learning dari foto. Daftar tanaman berasal dari <b>pemetaan umum jenis tanah ke tanaman</b>, bukan dari model N, P, K, pH. Angka persen adalah skor kecocokan relatif, bukan peluang panen. Untuk hasil yang lebih akurat, gunakan juga menu Pemeriksaan baru dan konsultasikan dengan penyuluh pertanian.</div></div>`;
    refreshIcons();
  }
});
