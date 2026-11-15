// Validasi input pemeriksaan di sisi server. Batas identik dengan ml/preprocessing/pipeline.py (DOMAIN_BOUNDS)
// dan CHECK constraint di database/schema.sql. Frontend memakai batas yang sama hanya untuk UX; ini yang menentukan.
import { HttpError } from './core.js';

export const FEATURES = ['N', 'P', 'K', 'temperature', 'humidity', 'ph', 'rainfall'];
export const BOUNDS = {
  N: [0, 200, 'Nitrogen (N)'], P: [0, 200, 'Fosfor (P)'], K: [0, 300, 'Kalium (K)'],
  temperature: [0, 50, 'Suhu'], humidity: [0, 100, 'Kelembapan'], ph: [0, 14, 'pH'], rainfall: [0, 500, 'Curah hujan'],
};

export function validateFeatures(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new HttpError(422, 'validation_error', 'Data pemeriksaan tidak valid.', { features: 'harus berupa objek' });
  const fields = {}; const clean = {};
  for (const f of FEATURES) {
    const v = obj[f];
    if (v === undefined || v === null || v === '') { fields[f] = 'wajib diisi'; continue; }
    if (typeof v !== 'number') { fields[f] = 'harus berupa angka'; continue; }   // string numerik sengaja ditolak
    if (!Number.isFinite(v)) { fields[f] = 'harus berupa angka terhingga'; continue; }
    const [lo, hi] = BOUNDS[f];
    if (v < lo || v > hi) { fields[f] = `harus antara ${lo} dan ${hi}`; continue; }
    clean[f] = v;
  }
  const extra = Object.keys(obj).filter((k) => !FEATURES.includes(k));
  if (extra.length) fields._extra = 'field tidak dikenal: ' + extra.slice(0, 5).join(', ');
  if (Object.keys(fields).length) throw new HttpError(422, 'validation_error', 'Ada isian yang tidak valid.', fields);
  return clean;
}
