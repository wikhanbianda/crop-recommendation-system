// Gateway prediksi: verifikasi sesi -> validasi -> layanan inferensi Python (model joblib asli) -> simpan -> audit.
// Tidak ada hasil tiruan: bila layanan model tidak tersedia, pengguna mendapat error 503 yang jelas dan tidak ada data tersimpan.
import { json, route, readJson, memLimit, HttpError } from './_lib/core.js';
import { authenticate, sbJson, sbCount, getSettings, audit, inference } from './_lib/supabase.js';
import { validateFeatures } from './_lib/validate.js';

export default route(['POST'], async (req) => {
  const auth = await authenticate(req);
  const settings = await getSettings();
  if (settings.maintenance_mode === true && auth.profile.role !== 'admin') throw new HttpError(503, 'maintenance', 'Aplikasi sedang dalam pemeliharaan.');
  const perMin = Number(settings.prediction_rate_per_minute) || 20;
  memLimit(`pred:${auth.profile.id}`, perMin, 60000);
  const recent = await sbCount(`/rest/v1/examinations?user_id=eq.${auth.profile.id}&created_at=gte.${encodeURIComponent(new Date(Date.now() - 60000).toISOString())}`);
  if (recent >= perMin) { const e = new HttpError(429, 'rate_limited', 'Terlalu banyak pemeriksaan dalam semenit. Coba lagi sebentar lagi.'); e.retryAfter = 30; throw e; }

  const body = await readJson(req, 2048);
  const features = validateFeatures(body.features);

  const active = (await sbJson('/rest/v1/model_versions?status=eq.active&select=id,version,algorithm'))?.[0];
  if (!active) throw new HttpError(503, 'no_active_model', 'Belum ada model aktif. Hubungi administrator.');

  const r = await inference('/predict', { method: 'POST', body: { features } });
  if (r.status === 422) throw new HttpError(422, 'validation_error', 'Ada isian yang tidak valid.', r.data?.fields);
  if (!r.ok || !r.data?.predicted_crop) {
    await audit(req, auth, 'examination.create', 'Prediksi gagal: layanan model', 'failure', { upstream_status: r.status });
    throw new HttpError(503, 'inference_unavailable', 'Layanan model Machine Learning sedang tidak tersedia. Tidak ada hasil yang dibuat; coba lagi nanti.');
  }
  if (r.data.model_version !== active.version) {
    await audit(req, auth, 'examination.create', 'Prediksi dibatalkan: versi model tidak sinkron', 'failure', { service: r.data.model_version, database: active.version });
    throw new HttpError(503, 'model_mismatch', 'Versi model pada layanan tidak sama dengan model aktif di database. Hubungi administrator.');
  }

  const row = {
    user_id: auth.profile.id, nitrogen: features.N, phosphorus: features.P, potassium: features.K,
    temperature: features.temperature, humidity: features.humidity, ph: features.ph, rainfall: features.rainfall,
    predicted_crop: r.data.predicted_crop, prediction_probabilities: r.data.probabilities ?? null,
    out_of_training_range: r.data.out_of_training_range || [], model_version_id: active.id,
  };
  const saved = await sbJson('/rest/v1/examinations', { method: 'POST', headers: { prefer: 'return=representation' }, body: row });
  const exam = saved[0];
  await audit(req, auth, 'examination.create', `Pemeriksaan: ${exam.predicted_crop}`, 'success', { examination_id: exam.id, model_version: active.version });
  return json(201, { examination: exam, model: { version: active.version, algorithm: active.algorithm }, probabilities: r.data.probabilities, out_of_training_range: r.data.out_of_training_range || [] });
});
