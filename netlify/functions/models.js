// Informasi & siklus hidup model (admin): lihat, latih kandidat dari dataset, pantau job, setujui/tolak.
// Prediksi tetap memakai model aktif sampai admin menyetujui kandidat.
import { json, route, readJson, isUuid, HttpError } from './_lib/core.js';
import { authenticate, sbJson, audit, inference } from './_lib/supabase.js';
import { getCsv } from './_lib/dataset-files.js';

const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const enc = encodeURIComponent;

async function finalizeJob(req, auth, version) {
  const r = await inference(`/admin/train/${enc(version)}`);
  if (r.status === 404) throw new HttpError(404, 'unknown_job', 'Job training tidak ditemukan (mungkin layanan di-restart).');
  if (!r.ok) throw new HttpError(503, 'inference_unavailable', 'Layanan model tidak tersedia.');
  const j = r.data;
  if (j.status === 'done') {
    const have = await sbJson(`/rest/v1/model_versions?version=eq.${enc(version)}&select=id`);
    if (!have?.length) {   // idempoten: tepat satu baris per versi
      const m = j.metadata; const mt = m.metrics;
      const ds = j.dataset_id && isUuid(j.dataset_id) ? j.dataset_id : null;
      await sbJson('/rest/v1/model_versions', { method: 'POST', body: {
        model_name: `${m.algorithm} ${version}`, algorithm: m.algorithm, version, accuracy: mt.accuracy, precision: mt.precision_macro, recall: mt.recall_macro,
        f1_score: mt.f1_macro, n_train: m.n_train, n_test: m.n_test, total_classes: m.dataset.n_classes, supports_proba: !!m.supports_predict_proba,
        training_date: m.trained_at, dataset_id: ds, artifact_path: version, status: 'candidate', comparison: j.comparison } });
      if (ds) await sbJson(`/rest/v1/datasets?id=eq.${ds}&status=eq.validated`, { method: 'PATCH', body: { status: 'trained' } });
      await audit(req, auth, 'model.train', `Training selesai: ${version} (${m.algorithm})`, 'success', { version, dataset_id: ds, accuracy: mt.accuracy });
    }
  } else if (j.status === 'failed') {
    await audit(req, auth, 'model.train', `Training gagal: ${version}`, 'failure', { version, error: j.error });
  }
  return { status: j.status, error: j.error, message: j.message, version };
}

export default route(['GET', 'POST'], async (req) => {
  const auth = await authenticate(req, { admin: true });
  const q = new URL(req.url).searchParams;

  if (req.method === 'GET') {
    if (q.get('job')) {
      if (!VERSION_RE.test(q.get('job'))) throw new HttpError(422, 'validation_error', 'versi tidak valid.');
      return json(200, await finalizeJob(req, auth, q.get('job')));
    }
    const versions = await sbJson('/rest/v1/model_versions?select=*,datasets:dataset_id(version,dataset_name)&order=created_at.desc');
    const active = versions.find((v) => v.status === 'active') || null;
    let service = { available: false }; let evaluation = null; let loaded = null;
    try {
      const h = await inference('/health', { timeout: 6000 });
      service = { available: h.ok, status: h.data?.status, version: h.data?.version };
      if (active) { const m = await inference('/model', { timeout: 8000 }); if (m.ok) { evaluation = m.data.evaluation; loaded = m.data.metadata; } }
    } catch { /* layanan tak terjangkau: ditampilkan apa adanya */ }
    return json(200, { versions, active, service, in_sync: !!(active && service.version === active.version), evaluation, metadata: loaded });
  }

  const b = await readJson(req, 2048);
  if (b.action === 'train') {
    if (!isUuid(b.dataset_id)) throw new HttpError(422, 'validation_error', 'dataset_id tidak valid.');
    const [ds] = await sbJson(`/rest/v1/datasets?id=eq.${b.dataset_id}&select=*`);
    if (!ds) throw new HttpError(404, 'not_found', 'Dataset tidak ditemukan.');
    if (ds.status === 'invalid') throw new HttpError(409, 'dataset_invalid', 'Dataset tidak lolos validasi, tidak dapat dilatih.');
    const version = (typeof b.version === 'string' && b.version) || `m-${ds.version}-${Date.now().toString(36)}`.slice(0, 40);
    if (!VERSION_RE.test(version)) throw new HttpError(422, 'validation_error', 'Versi model tidak valid.', { version: 'tidak valid' });
    const dup = await sbJson(`/rest/v1/model_versions?version=eq.${enc(version)}&select=id`);
    if (dup?.length) throw new HttpError(409, 'version_exists', 'Versi model sudah ada.');
    const bytes = await getCsv(ds);
    const r = await inference(`/admin/train?version=${enc(version)}&dataset_id=${ds.id}&name=${enc(ds.dataset_name)}`, { method: 'POST', raw: true, body: bytes, headers: { 'content-type': 'text/csv' }, timeout: 20000 });
    if (r.status === 422) throw new HttpError(422, 'dataset_invalid', r.data?.message || 'Dataset tidak valid.');
    if (r.status === 409) throw new HttpError(409, 'version_exists', 'Versi model sudah ada di layanan.');
    if (r.status !== 202) throw new HttpError(503, 'inference_unavailable', 'Layanan training tidak tersedia.');
    await audit(req, auth, 'model.train_start', `Mulai training ${version}`, 'success', { version, dataset_id: ds.id });
    return json(202, { status: 'running', version });
  }

  if (b.action === 'activate') {
    if (!isUuid(b.id)) throw new HttpError(422, 'validation_error', 'id tidak valid.');
    const [mv] = await sbJson(`/rest/v1/model_versions?id=eq.${b.id}&select=id,version,status`);
    if (!mv) throw new HttpError(404, 'not_found', 'Versi model tidak ditemukan.');
    if (mv.status === 'rejected') throw new HttpError(409, 'conflict', 'Versi yang ditolak tidak bisa diaktifkan.');
    const [prev] = await sbJson('/rest/v1/model_versions?status=eq.active&select=version');
    const a = await inference('/admin/activate', { method: 'POST', body: { version: mv.version } });
    if (a.status === 404) throw new HttpError(409, 'artifact_missing', 'Artefak model tidak ada di layanan inferensi (mungkin hilang saat restart). Latih ulang dari dataset.');
    if (!a.ok) throw new HttpError(503, 'inference_unavailable', 'Layanan model tidak dapat mengaktifkan versi ini.');
    try { await sbJson('/rest/v1/rpc/activate_model_version', { method: 'POST', token: auth.token, body: { p_id: mv.id } }); }
    catch (e) {   // pulihkan layanan ke versi sebelumnya agar database dan layanan tetap sinkron
      if (prev) await inference('/admin/activate', { method: 'POST', body: { version: prev.version } }).catch(() => {});
      throw new HttpError(e.status === 403 ? 403 : 409, 'activation_failed', 'Aktivasi model gagal; versi sebelumnya dipertahankan.');
    }
    return json(200, { ok: true, active: mv.version });
  }

  if (b.action === 'reject') {
    if (!isUuid(b.id)) throw new HttpError(422, 'validation_error', 'id tidak valid.');
    try { await sbJson('/rest/v1/rpc/reject_model_version', { method: 'POST', token: auth.token, body: { p_id: b.id } }); }
    catch (e) { throw new HttpError(409, 'conflict', 'Hanya model berstatus kandidat yang dapat ditolak.'); }
    return json(200, { ok: true });
  }
  throw new HttpError(400, 'bad_action', 'Aksi tidak dikenal.');
});
