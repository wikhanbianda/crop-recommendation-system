// Manajemen dataset (admin): upload -> validasi (layanan Python) -> simpan di Storage privat -> catat versi.
// Dataset baru TIDAK mengganti model aktif; lihat models.js (latih -> evaluasi -> persetujuan admin).
import { json, route, isUuid, HttpError } from './_lib/core.js';
import { authenticate, sb, sbJson, audit, inference } from './_lib/supabase.js';
import { getCsv, BUCKET } from './_lib/dataset-files.js';

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set(['text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel', 'application/octet-stream', '']);
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const sha256 = async (buf) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
export default route(['GET', 'POST'], async (req) => {
  const auth = await authenticate(req, { admin: true });
  const q = new URL(req.url).searchParams;

  if (req.method === 'GET') {
    const id = q.get('id');
    if (!id) {
      const rows = await sbJson('/rest/v1/datasets?select=*,profiles:uploaded_by(email,full_name)&order=created_at.desc');
      return json(200, { datasets: rows });
    }
    if (!isUuid(id)) throw new HttpError(422, 'validation_error', 'id tidak valid.');
    const [row] = await sbJson(`/rest/v1/datasets?id=eq.${id}&select=*`);
    if (!row) throw new HttpError(404, 'not_found', 'Dataset tidak ditemukan.');
    const bytes = await getCsv(row);
    const r = await inference('/admin/validate', { method: 'POST', raw: true, body: bytes, headers: { 'content-type': 'text/csv' }, timeout: 30000 });
    if (!r.ok) throw new HttpError(503, 'inference_unavailable', 'Layanan model tidak dapat memproses dataset saat ini.');
    return json(200, { dataset: row, report: r.data });
  }

  // POST: upload. Body = isi CSV mentah; metadata lewat query/header.
  const filename = (req.headers.get('x-filename') || '').trim();
  const mime = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^[\w][\w .()-]{0,100}\.csv$/i.test(filename)) throw new HttpError(422, 'invalid_file', 'Nama berkas harus berakhiran .csv (huruf, angka, spasi, titik, strip).');
  if (!ALLOWED_MIME.has(mime)) throw new HttpError(415, 'invalid_mime', 'Tipe berkas harus CSV (text/csv).');
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new HttpError(413, 'file_too_large', 'Ukuran berkas maksimal 2 MB.');
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new HttpError(413, 'file_too_large', 'Ukuran berkas maksimal 2 MB.');
  if (buf.length === 0) throw new HttpError(422, 'invalid_file', 'Berkas kosong.');

  const version = (q.get('version') || `ds-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`).trim();
  if (!VERSION_RE.test(version)) throw new HttpError(422, 'validation_error', 'Versi hanya huruf, angka, titik, strip, garis bawah (maks 40).', { version: 'tidak valid' });
  const name = (q.get('name') || filename).trim().slice(0, 160) || filename;
  const existing = await sbJson(`/rest/v1/datasets?version=eq.${encodeURIComponent(version)}&select=id`);
  if (existing?.length) throw new HttpError(409, 'version_exists', 'Versi dataset sudah ada.');

  const r = await inference('/admin/validate', { method: 'POST', raw: true, body: buf, headers: { 'content-type': 'text/csv' }, timeout: 30000 });
  if (!r.ok) throw new HttpError(503, 'inference_unavailable', 'Layanan validasi dataset tidak tersedia. Dataset tidak disimpan.');
  const rep = r.data; const hash = await sha256(buf);
  const safeName = filename.replace(/[^\w.() -]/g, '_').replace(/ /g, '_');
  const filePath = `datasets/${version}/${safeName}`;
  const up = await sb(`/storage/v1/object/${BUCKET}/${version}/${encodeURIComponent(safeName)}`, { method: 'POST', raw: true, body: buf, headers: { 'content-type': 'text/csv', 'x-upsert': 'false' } });
  if (!up.ok) throw new HttpError(502, 'storage_error', 'Gagal menyimpan berkas ke penyimpanan. Pastikan bucket privat "datasets" sudah dibuat.');
  const status = rep.valid ? 'validated' : 'invalid';
  const [row] = await sbJson('/rest/v1/datasets', { method: 'POST', headers: { prefer: 'return=representation' }, body: {
    dataset_name: name, file_path: filePath, sha256: hash, total_rows: rep.rows_clean ?? rep.rows_in_file ?? 0, total_features: rep.n_features ?? 0,
    total_classes: rep.n_classes ?? 0, version, status, uploaded_by: auth.profile.id,
    validation_report: { valid: rep.valid, errors: rep.errors, rows_raw: rep.rows_raw, rows_clean: rep.rows_clean, duplicates_removed: rep.duplicates_removed, missing_per_column: rep.missing_per_column, class_counts: rep.class_counts } } });
  await audit(req, auth, 'dataset.upload', `Upload dataset ${version} (${status})`, rep.valid ? 'success' : 'failure', { dataset_id: row.id, version, sha256: hash, bytes: buf.length });
  return json(201, { dataset: row, report: rep });
});
