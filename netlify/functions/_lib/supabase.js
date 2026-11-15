// Klien Supabase sisi server (REST murni). service_role HANYA dipakai di sini, tidak pernah dikirim ke browser.
import { env, HttpError, clientIp } from './core.js';

const base = () => { const u = env('SUPABASE_URL').replace(/\/$/, ''); if (!u) throw new HttpError(503, 'not_configured', 'Server belum dikonfigurasi (SUPABASE_URL).'); return u; };
const anon = () => { const k = env('SUPABASE_ANON_KEY'); if (!k) throw new HttpError(503, 'not_configured', 'Server belum dikonfigurasi (SUPABASE_ANON_KEY).'); return k; };
const svc = () => { const k = env('SUPABASE_SERVICE_ROLE_KEY'); if (!k) throw new HttpError(503, 'not_configured', 'Server belum dikonfigurasi (SUPABASE_SERVICE_ROLE_KEY).'); return k; };

// token = JWT pengguna (RLS berlaku); tanpa token = service role (melewati RLS, hanya untuk kode server tepercaya).
export async function sb(path, { method = 'GET', token, headers = {}, body, raw = false, anonOnly = false } = {}) {
  const key = (token || anonOnly) ? anon() : svc();
  const h = { apikey: key, authorization: `Bearer ${token || key}`, ...headers };
  if (body !== undefined && !raw && !h['content-type']) h['content-type'] = 'application/json';
  let res;
  try { res = await fetch(base() + path, { method, headers: h, body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)), signal: AbortSignal.timeout(15000) }); }
  catch { throw new HttpError(502, 'upstream_unreachable', 'Layanan database tidak dapat dihubungi.'); }
  return res;
}
export async function sbJson(path, opts) {
  const res = await sb(path, opts);
  const text = await res.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* bukan JSON */ }
  if (!res.ok) { const e = new Error((data && (data.message || data.msg || data.error_description)) || `HTTP ${res.status}`); e.status = res.status; e.data = data; throw e; }
  return data;
}

export function bearer(req) {
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]{20,4096})$/.exec(req.headers.get('authorization') || '');
  if (!m) throw new HttpError(401, 'unauthenticated', 'Silakan login terlebih dahulu.');
  return m[1];
}

// Verifikasi token ke Supabase Auth, lalu baca profil (role/status) dari database dengan service role.
export async function authenticate(req, { admin = false } = {}) {
  const token = bearer(req);
  const res = await sb('/auth/v1/user', { token });
  if (res.status === 401 || res.status === 403) throw new HttpError(401, 'invalid_token', 'Sesi tidak valid atau kedaluwarsa. Silakan login ulang.');
  if (!res.ok) throw new HttpError(502, 'upstream_error', 'Verifikasi sesi gagal.');
  const user = await res.json();
  const rows = await sbJson(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,email,full_name,role,status`);
  const profile = rows && rows[0];
  if (!profile) throw new HttpError(403, 'no_profile', 'Profil akun tidak ditemukan.');
  if (profile.status !== 'active') throw new HttpError(403, 'account_inactive', 'Akun Anda dinonaktifkan. Hubungi administrator.');
  if (admin && profile.role !== 'admin') throw new HttpError(403, 'forbidden', 'Fitur ini hanya untuk administrator.');
  return { token, user, profile };
}

export async function audit(req, auth, action, description, status = 'success', details = {}) {
  try {
    await sbJson('/rest/v1/rpc/write_audit', { method: 'POST', body: {
      p_user: auth?.profile?.id || null, p_email: auth?.profile?.email || details.email || null, p_action: action,
      p_desc: description, p_status: status, p_details: details, p_ip: req ? clientIp(req) : null } });
  } catch (e) { console.error('[audit-failed]', e.message); }
}

let settingsCache = { at: 0, v: null };
export async function getSettings(force = false) {
  if (!force && settingsCache.v && Date.now() - settingsCache.at < Number(process.env.SETTINGS_CACHE_MS ?? 5000)) return settingsCache.v;
  const rows = await sbJson('/rest/v1/application_settings?select=setting_key,setting_value');
  const v = Object.fromEntries((rows || []).map((r) => [r.setting_key, r.setting_value]));
  settingsCache = { at: Date.now(), v }; return v;
}
export const _clearSettingsCache = () => { settingsCache = { at: 0, v: null }; };

// ---- layanan inferensi Python ----
export async function inference(path, { method = 'GET', body, raw = false, headers = {}, timeout = 20000 } = {}) {
  const url = env('INFERENCE_SERVICE_URL').replace(/\/$/, ''); const key = env('INFERENCE_SERVICE_KEY');
  if (!url || !key) throw new HttpError(503, 'inference_not_configured', 'Layanan model Machine Learning belum dikonfigurasi.');
  let res;
  try {
    res = await fetch(url + path, { method, signal: AbortSignal.timeout(timeout),
      headers: { 'x-service-key': key, ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)) });
  } catch { throw new HttpError(503, 'inference_unavailable', 'Layanan model Machine Learning tidak dapat dihubungi. Tidak ada hasil yang dibuat; coba lagi nanti.'); }
  const buf = new Uint8Array(await res.arrayBuffer()); const text = new TextDecoder().decode(buf); let data = null; try { data = JSON.parse(text); } catch { /* bukan JSON */ }
  return { status: res.status, ok: res.ok, data, raw: buf };
}

// Hitung baris via PostgREST (Prefer: count=exact). `path` tanpa select/limit, mis. '/rest/v1/ai_messages?user_id=eq.X'
export async function sbCount(path, opts = {}) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await sb(`${path}${sep}select=id&limit=1`, { ...opts, headers: { prefer: 'count=exact', ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`count failed ${res.status}`);
  const m = /\/(\d+|\*)$/.exec(res.headers.get('content-range') || '');
  return m && m[1] !== '*' ? Number(m[1]) : 0;
}
