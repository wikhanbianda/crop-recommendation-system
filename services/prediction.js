// Prediksi: dikirim ke backend (gateway) yang memanggil model Python asli. Tidak ada perhitungan model di browser.
import { fn } from './api.js';
import { from } from './supabase.js';

export const FIELDS = [
  { key: 'N', label: 'Nitrogen (N)', unit: 'mg/kg', min: 0, max: 200, step: 1, ph: '90', hint: 'Kandungan nitrogen tanah. Rentang 0–200. Contoh data latih: 0–140.', icon: 'flask-conical' },
  { key: 'P', label: 'Fosfor (P)', unit: 'mg/kg', min: 0, max: 200, step: 1, ph: '42', hint: 'Kandungan fosfor tanah. Rentang 0–200. Contoh data latih: 5–145.', icon: 'flask-conical' },
  { key: 'K', label: 'Kalium (K)', unit: 'mg/kg', min: 0, max: 300, step: 1, ph: '43', hint: 'Kandungan kalium tanah. Rentang 0–300. Contoh data latih: 5–205.', icon: 'flask-conical' },
  { key: 'temperature', label: 'Suhu', unit: '°C', min: 0, max: 50, step: 0.1, ph: '25.5', hint: 'Suhu rata-rata lingkungan. Rentang 0–50 °C.', icon: 'thermometer' },
  { key: 'humidity', label: 'Kelembapan udara', unit: '%', min: 0, max: 100, step: 0.1, ph: '80', hint: 'Kelembapan relatif udara. Rentang 0–100 %.', icon: 'droplets' },
  { key: 'ph', label: 'pH tanah', unit: '', min: 0, max: 14, step: 0.1, ph: '6.5', hint: 'Tingkat keasaman tanah. Rentang 0–14 (netral = 7).', icon: 'flask-conical' },
  { key: 'rainfall', label: 'Curah hujan', unit: 'mm', min: 0, max: 500, step: 0.1, ph: '200', hint: 'Curah hujan. Rentang 0–500 mm.', icon: 'cloud-rain' },
];

// Validasi di browser hanya untuk UX; backend mengulang validasi yang sama dan merupakan penentu.
export function validate(values) {
  const errors = {}; const clean = {};
  for (const f of FIELDS) {
    const raw = values[f.key];
    const s = typeof raw === 'string' ? raw.trim().replace(',', '.') : raw;
    if (s === '' || s == null) { errors[f.key] = `${f.label} wajib diisi.`; continue; }
    if (typeof s === 'string' && !/^-?\d+(\.\d+)?$/.test(s)) { errors[f.key] = `${f.label} harus berupa angka.`; continue; }
    const n = Number(s);
    if (!Number.isFinite(n)) { errors[f.key] = `${f.label} harus berupa angka.`; continue; }
    if (n < f.min || n > f.max) { errors[f.key] = `${f.label} harus antara ${f.min} dan ${f.max}.`; continue; }
    clean[f.key] = n;
  }
  return { errors, clean, ok: Object.keys(errors).length === 0 };
}

export const predict = (features) => fn('prediction', { method: 'POST', body: { features } });
export const getExamination = async (id) => {
  const { data } = await from('examinations').select('*,model_versions(version,algorithm,accuracy)').eq('id', id).run();
  return data && data[0];
};
