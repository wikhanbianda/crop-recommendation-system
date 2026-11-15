// Asisten AI: seluruh komunikasi ke penyedia lewat sini. API key hanya ada di environment server.
import { json, route, readJson, memLimit, isUuid, HttpError, env } from './_lib/core.js';
import { authenticate, sbJson, sbCount, getSettings, audit } from './_lib/supabase.js';
import { chatComplete, SYSTEM_PROMPT, aiConfig } from './_lib/ai.js';

const MAX_MSG = 2000; const HISTORY = 10;
// Pola injeksi berkeyakinan tinggi -> ditolak tanpa memanggil penyedia (tetap dicatat). Pertahanan utama tetap system prompt;
// ini lapisan tambahan dan tidak diklaim sempurna.
const INJECTION = [
  /(abaikan|lupakan|ignore|disregard|forget)\s+(semua\s+|seluruh\s+|all\s+|any\s+)?(instruksi|aturan|perintah|petunjuk|instructions?|rules?|prompts?)(\s+\w+){0,3}\s+(sebelumnya|di atas|previous|above|prior|earlier)/i,
  /(tampilkan|tunjukkan|bocorkan|ungkapkan|reveal|show|print|repeat|ulangi)\s+(\w+\s+){0,3}(system\s*prompt|instruksi\s+sistem|prompt\s+sistem|developer\s+message)/i,
  /\b(jailbreak|DAN\s+mode|developer\s+mode)\b/i,
  /<\/?\s*(system|pesan_pengguna|instruction)\s*>/i,
];
const sanitize = (t) => t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/<\/?pesan_pengguna>/gi, '').trim();

async function examContext(userId, examId) {
  const rows = await sbJson(`/rest/v1/examinations?id=eq.${examId}&user_id=eq.${userId}&select=*,model_versions(version,algorithm)`);   // hanya milik sendiri
  const e = rows?.[0]; if (!e) throw new HttpError(404, 'exam_not_found', 'Data pemeriksaan tidak ditemukan.');
  const probs = Array.isArray(e.prediction_probabilities) ? e.prediction_probabilities.map((p) => `${p.crop} ${(p.probability * 100).toFixed(1)}%`).join(', ') : 'tidak tersedia';
  return `DATA PEMERIKSAAN (hasil model Machine Learning, hanya untuk dibaca; tidak berisi data pribadi):
N=${e.nitrogen}, P=${e.phosphorus}, K=${e.potassium}, suhu=${e.temperature}°C, kelembapan=${e.humidity}%, pH=${e.ph}, curah hujan=${e.rainfall} mm.
Rekomendasi model (${e.model_versions?.algorithm || 'model'} ${e.model_versions?.version || ''}): ${e.predicted_crop}. Kandidat teratas: ${probs}.${(e.out_of_training_range || []).length ? ` Catatan: nilai di luar rentang data latih: ${e.out_of_training_range.join(', ')}.` : ''}`;
}

const dayAgo = () => encodeURIComponent(new Date(Date.now() - 86400000).toISOString());

export default route(['GET', 'POST'], async (req) => {
  const auth = await authenticate(req);
  const settings = await getSettings();
  const limit = Number(settings.ai_daily_limit); const dailyLimit = Number.isFinite(limit) ? limit : 30;

  if (req.method === 'GET') {
    let configured = true; let provider = null; let model = null;
    try { const c = aiConfig(); provider = c.provider; model = c.model; } catch { configured = false; }
    const used = await sbCount(`/rest/v1/ai_messages?user_id=eq.${auth.profile.id}&role=eq.user&created_at=gte.${dayAgo()}`);
    return json(200, { enabled: settings.ai_enabled === true, configured, dailyLimit, usedLast24h: used,
      ...(auth.profile.role === 'admin' ? { provider, model } : {}) });
  }

  const body = await readJson(req, 8192);

  if (body.action === 'ping') {   // admin: uji koneksi & kuota penyedia dengan 1 permintaan kecil
    if (auth.profile.role !== 'admin') throw new HttpError(403, 'forbidden', 'Hanya administrator.');
    const t0 = Date.now();
    try {
      const r = await chatComplete({ system: 'Balas dengan satu kata: OK', messages: [{ role: 'user', content: 'ping' }], maxTokens: 16 });
      await audit(req, auth, 'ai.ping', 'Uji koneksi AI', 'success', { provider: r.provider, model: r.model });
      return json(200, { ok: true, provider: r.provider, model: r.model, latencyMs: Date.now() - t0 });
    } catch (e) { await audit(req, auth, 'ai.ping', 'Uji koneksi AI gagal', 'failure', { code: e.code }); throw e; }
  }

  if (settings.ai_enabled !== true) throw new HttpError(503, 'ai_disabled', 'Asisten AI sedang dinonaktifkan oleh administrator.');
  if (settings.maintenance_mode === true && auth.profile.role !== 'admin') throw new HttpError(503, 'maintenance', 'Aplikasi sedang dalam pemeliharaan.');

  const raw = typeof body.message === 'string' ? body.message : '';
  const message = sanitize(raw);
  if (!message) throw new HttpError(422, 'validation_error', 'Pesan tidak boleh kosong.', { message: 'wajib diisi' });
  if (message.length > MAX_MSG) throw new HttpError(422, 'validation_error', `Pesan maksimal ${MAX_MSG} karakter.`, { message: `maksimal ${MAX_MSG} karakter` });
  if (body.conversation_id != null && !isUuid(body.conversation_id)) throw new HttpError(422, 'validation_error', 'conversation_id tidak valid.');
  if (body.exam_id != null && !isUuid(body.exam_id)) throw new HttpError(422, 'validation_error', 'exam_id tidak valid.');

  memLimit(`ai:${auth.profile.id}`, 8, 60000);
  const used = await sbCount(`/rest/v1/ai_messages?user_id=eq.${auth.profile.id}&role=eq.user&created_at=gte.${dayAgo()}`);
  if (used >= dailyLimit) throw new HttpError(429, 'ai_daily_limit', `Batas ${dailyLimit} pesan AI per 24 jam sudah tercapai. Coba lagi besok.`);

  // percakapan: harus milik pengguna ini (diperiksa di server dengan filter user_id)
  let convId = body.conversation_id || null; let history = [];
  if (convId) {
    const c = await sbJson(`/rest/v1/ai_conversations?id=eq.${convId}&user_id=eq.${auth.profile.id}&select=id`);
    if (!c?.[0]) throw new HttpError(404, 'conversation_not_found', 'Percakapan tidak ditemukan.');
    const h = await sbJson(`/rest/v1/ai_messages?conversation_id=eq.${convId}&select=role,content&order=created_at.desc&limit=${HISTORY}`);
    history = (h || []).reverse();
  }

  const flagged = INJECTION.some((re) => re.test(message));
  let answer; let provider = null; let model = null;
  if (flagged) {
    await audit(req, auth, 'ai.injection_blocked', 'Pesan diblokir: pola prompt injection', 'failure', { length: message.length });
    answer = 'Maaf, saya tidak bisa menuruti permintaan tersebut. Saya hanya dapat membantu seputar pertanian: kondisi tanah, iklim, dan cara memahami hasil rekomendasi tanaman. Silakan ajukan pertanyaan terkait topik itu.';
  } else {
    const parts = [];
    if (body.exam_id) parts.push(await examContext(auth.profile.id, body.exam_id));   // hanya atas izin eksplisit pengguna (exam_id dikirim)
    parts.push(`<pesan_pengguna>\n${message}\n</pesan_pengguna>`);
    const msgs = [...history.map((m) => ({ role: m.role, content: m.role === 'user' ? `<pesan_pengguna>\n${m.content}\n</pesan_pengguna>` : m.content })),
      { role: 'user', content: parts.join('\n\n') }];
    const r = await chatComplete({ system: SYSTEM_PROMPT, messages: msgs });   // error penyedia dilempar apa adanya (tanpa fallback)
    answer = r.text; provider = r.provider; model = r.model;
  }

  if (!convId) {
    const created = await sbJson('/rest/v1/ai_conversations', { method: 'POST', headers: { prefer: 'return=representation' }, body: { user_id: auth.profile.id, title: message.slice(0, 60) || 'Percakapan baru' } });
    convId = created[0].id;
  }
  const t = Date.now();
  await sbJson('/rest/v1/ai_messages', { method: 'POST', body: [
    { conversation_id: convId, user_id: auth.profile.id, role: 'user', content: message, created_at: new Date(t).toISOString() },
    { conversation_id: convId, user_id: auth.profile.id, role: 'assistant', content: answer, created_at: new Date(t + 1).toISOString() }] });
  await sbJson(`/rest/v1/ai_conversations?id=eq.${convId}`, { method: 'PATCH', body: { updated_at: new Date().toISOString() } });
  if (!flagged) await audit(req, auth, 'ai.chat', 'Pesan AI', 'success', { conversation_id: convId, with_exam_context: !!body.exam_id, provider, model });
  return json(200, { conversation_id: convId, reply: answer, blocked: flagged, usedLast24h: used + 1, dailyLimit });
});
