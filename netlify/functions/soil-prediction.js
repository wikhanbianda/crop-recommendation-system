// Fitur tambahan: rekomendasi tanaman dari FOTO tanah. Gateway: sesi -> validasi gambar -> layanan Python (model gambar asli).
// GET  -> status model gambar (sudah dilatih atau belum)
// POST -> body = bytes JPEG (browser selalu mengecilkan & mengenkode ulang ke JPEG); gambar TIDAK disimpan, hanya hasil di audit log.
import { json, route, memLimit, HttpError } from './_lib/core.js';
import { authenticate, getSettings, audit, inference } from './_lib/supabase.js';

const MAX_BYTES = 1_500_000;

export default route(['GET', 'POST'], async (req) => {
  const auth = await authenticate(req);
  const settings = await getSettings();
  if (settings.maintenance_mode === true && auth.profile.role !== 'admin') throw new HttpError(503, 'maintenance', 'Aplikasi sedang dalam pemeliharaan.');

  if (req.method === 'GET') {
    const r = await inference('/soil-model');
    if (r.status === 503 && r.data?.error === 'no_soil_model') return json(200, { available: false });
    if (!r.ok) throw new HttpError(503, 'inference_unavailable', 'Layanan model Machine Learning sedang tidak tersedia.');
    return json(200, { available: true, model: r.data });
  }

  memLimit(`soil:${auth.profile.id}`, Number(settings.prediction_rate_per_minute) || 20, 60000);
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new HttpError(413, 'payload_too_large', 'Ukuran gambar terlalu besar (maksimal 1,5 MB).');
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.length === 0) throw new HttpError(422, 'invalid_image', 'Gambar kosong.');
  if (buf.length > MAX_BYTES) throw new HttpError(413, 'payload_too_large', 'Ukuran gambar terlalu besar (maksimal 1,5 MB).');
  if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) throw new HttpError(422, 'invalid_image', 'Berkas harus berupa gambar JPEG.');

  const r = await inference('/predict-soil', { method: 'POST', body: buf, raw: true, headers: { 'content-type': 'application/octet-stream' }, timeout: 25000 });
  if (r.status === 503 && r.data?.error === 'no_soil_model') throw new HttpError(503, 'no_soil_model', 'Model gambar tanah belum dilatih. Hubungi administrator.');
  if (r.status === 422 && r.data?.error === 'not_soil') {
    await audit(req, auth, 'soil.rejected', 'Foto ditolak: bukan tanah', 'failure', { bytes: buf.length });
    throw new HttpError(422, 'not_soil', r.data.message || 'Foto ini tidak terdeteksi sebagai tanah.');
  }
  if (r.status === 422) throw new HttpError(422, 'invalid_image', r.data?.message || 'Gambar tidak dapat diproses.');
  if (!r.ok || !r.data?.predicted_soil) {
    await audit(req, auth, 'soil.predict', 'Prediksi foto tanah gagal: layanan model', 'failure', { upstream_status: r.status });
    throw new HttpError(503, 'inference_unavailable', 'Layanan model Machine Learning sedang tidak tersedia. Tidak ada hasil yang dibuat; coba lagi nanti.');
  }
  await audit(req, auth, 'soil.predict', `Foto tanah: ${r.data.predicted_soil}`, 'success', { model_version: r.data.model_version, bytes: buf.length });
  return json(200, r.data);
});
