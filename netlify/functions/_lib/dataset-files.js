// Mengambil isi CSV sebuah dataset: dari Supabase Storage (bucket privat), atau dataset bawaan v1.0.0 dari layanan inferensi.
import { HttpError } from './core.js';
import { sb, inference } from './supabase.js';

export const BUCKET = 'datasets';
export const objectPath = (filePath) => filePath.replace(/^datasets\//, '');

export async function getCsv(row) {
  const res = await sb(`/storage/v1/object/${BUCKET}/${objectPath(row.file_path).split('/').map(encodeURIComponent).join('/')}`);
  if (res.ok) return new Uint8Array(await res.arrayBuffer());
  if (row.version === 'v1.0.0') {
    const r = await inference('/admin/dataset/builtin', { raw: true });
    if (r.ok && r.raw) return r.raw;
  }
  throw new HttpError(404, 'file_missing', 'Berkas dataset tidak ditemukan di penyimpanan.');
}
