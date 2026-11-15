// Bagian tampilan pemeriksaan yang dipakai bersama (riwayat, hasil, admin).
import { h, fmtDate, fmtNum, pct } from '../ui.js';
import { CROPS, cropName, cropEmoji } from '../crops.js';

export const FEATS = [['nitrogen', 'N', 'Nitrogen (N)', 'mg/kg'], ['phosphorus', 'P', 'Fosfor (P)', 'mg/kg'], ['potassium', 'K', 'Kalium (K)', 'mg/kg'],
  ['temperature', 'Suhu', 'Suhu', '°C'], ['humidity', 'Kelembapan', 'Kelembapan udara', '%'], ['ph', 'pH', 'pH tanah', ''], ['rainfall', 'Hujan', 'Curah hujan', 'mm']];
export const cropOptions = (sel = '', all = 'Semua tanaman') => `<option value="">${h(all)}</option>${Object.keys(CROPS).sort((a, b) => cropName(a).localeCompare(cropName(b), 'id')).map((c) => `<option value="${c}" ${c === sel ? 'selected' : ''}>${h(cropName(c))}</option>`).join('')}`;
export const cropBadge = (c) => `<span class="badge green">${cropEmoji(c)} ${h(cropName(c))}</span>`;
// pencarian bebas: cocokkan nama Indonesia maupun label Inggris
export const matchCrops = (q) => { const s = q.trim().toLowerCase(); return s ? Object.keys(CROPS).filter((k) => k.includes(s) || cropName(k).toLowerCase().includes(s)) : null; };
export const dayStart = (d) => `${d}T00:00:00+09:00`;
export const dayEnd = (d) => { const x = new Date(`${d}T00:00:00+09:00`); x.setDate(x.getDate() + 1); return x.toISOString(); };

export function probBars(probs, top = 5) {
  if (!Array.isArray(probs) || !probs.length) return '<p class="muted">Probabilitas tidak tersedia untuk pemeriksaan ini.</p>';
  return `<div class="bars">${probs.slice(0, top).map((p, i) => `<div class="bar-row ${i === 0 ? 'top' : ''}"><span>${cropEmoji(p.crop)} ${h(cropName(p.crop))}</span><span class="bar-track"><span class="bar-fill" style="display:block;width:${Math.max(1, p.probability * 100).toFixed(1)}%"></span></span><span class="right">${(p.probability * 100).toFixed(1)}%</span></div>`).join('')}</div>`;
}
export const featureList = (e) => `<dl class="kv">${FEATS.map(([k, , l, u]) => `<dt>${h(l)}</dt><dd>${fmtNum(e[k], 2)} ${h(u)}</dd>`).join('')}</dl>`;
export function examDetail(e, { showUser = false } = {}) {
  const mv = e.model_versions || {};
  return `<div class="crop-hero mb"><div class="emoji" aria-hidden="true">${cropEmoji(e.predicted_crop)}</div><div><span class="muted small">Rekomendasi tanaman</span><h2>${h(cropName(e.predicted_crop))}</h2><span class="muted small">${h(e.predicted_crop)}</span></div></div>
  <div class="grid cols-2"><div><h3>Parameter masukan</h3>${featureList(e)}</div><div><h3>Kandidat tanaman</h3>${probBars(e.prediction_probabilities)}</div></div>
  <hr style="border:0;border-top:1px solid var(--line);margin:1rem 0"><dl class="kv"><dt>ID pemeriksaan</dt><dd class="small">${h(e.id)}</dd><dt>Tanggal</dt><dd>${fmtDate(e.created_at)}</dd>
  <dt>Versi model</dt><dd>${h(mv.algorithm || '–')} ${h(mv.version || '')}</dd>${showUser && e.profiles ? `<dt>Pengguna</dt><dd>${h(e.profiles.full_name || '')} (${h(e.profiles.email || '')})</dd>` : ''}</dl>
  ${(e.out_of_training_range || []).length ? `<div class="alert warn mt">Nilai ${e.out_of_training_range.map(h).join(', ')} berada di luar rentang data latih; hasil perlu ditafsirkan dengan hati-hati.</div>` : ''}`;
}
export const DISCLAIMER = 'Hasil ini adalah rekomendasi berbasis data dari model Machine Learning, bukan jaminan keberhasilan panen. Pertimbangkan juga kondisi lapangan seperti jenis tanah, ketersediaan air, hama, dan musim, serta konsultasikan dengan penyuluh pertanian setempat.';
export { pct };
