// Klien Supabase untuk browser (REST murni, tanpa library). Hanya memakai ANON key + token pengguna; RLS yang menegakkan akses.
// service_role tidak pernah ada di sisi browser.
export class ApiError extends Error {
  constructor(status, code, message, fields) { super(message); this.status = status; this.code = code; this.fields = fields || null; }
}

const KEY = 'crop.session';
let cfgPromise = null;

export function getConfig() {
  if (!cfgPromise) {
    cfgPromise = fetch('/.netlify/functions/config', { cache: 'no-store' }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new ApiError(r.status, d.error || 'config', d.message || 'Konfigurasi server tidak tersedia.');
      return d;
    }).catch((e) => { cfgPromise = null; throw e instanceof ApiError ? e : new ApiError(0, 'network', 'Tidak dapat menghubungi server. Periksa koneksi internet Anda.'); });
  }
  return cfgPromise;
}

// ---- sesi: localStorage bila "ingat saya", selain itu sessionStorage (hilang saat tab ditutup) ----
const stores = () => { const a = []; try { a.push(localStorage); } catch { /* diblokir */ } try { a.push(sessionStorage); } catch { /* diblokir */ } return a; };
export function getSession() {
  for (const s of stores()) { try { const v = JSON.parse(s.getItem(KEY) || 'null'); if (v && v.access_token) return v; } catch { /* rusak */ } }
  return null;
}
export function clearSession() { for (const s of stores()) { try { s.removeItem(KEY); } catch { /* */ } } }
export function saveSession(sess, remember = true) {
  clearSession();
  const v = { access_token: sess.access_token, refresh_token: sess.refresh_token, expires_at: sess.expires_at || Math.floor(Date.now() / 1000) + (sess.expires_in || 3600), remember };
  const primary = remember ? localStorage : sessionStorage;
  try { primary.setItem(KEY, JSON.stringify(v)); } catch { try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch { /* tak bisa menyimpan */ } }
}

let refreshing = null;
async function refresh(s) {
  if (!refreshing) {
    refreshing = (async () => {   // satu refresh pada satu waktu agar refresh token (sekali pakai) tidak bentrok
      const cfg = await getConfig();
      const r = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: cfg.supabaseAnonKey, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.access_token) { clearSession(); throw new ApiError(401, 'session_expired', 'Sesi berakhir. Silakan login ulang.'); }
      saveSession(d, s.remember !== false);
      return d.access_token;
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}
export async function validToken({ force = false } = {}) {
  const s = getSession();
  if (!s) throw new ApiError(401, 'unauthenticated', 'Silakan login terlebih dahulu.');
  if (!force && s.expires_at * 1000 - Date.now() > 60000) return s.access_token;
  return refresh(s);
}

function dbMessage(status, data) {
  const code = data && data.code; const msg = (data && (data.message || data.msg)) || '';
  if (status === 401) return 'Sesi tidak valid. Silakan login ulang.';
  if (status === 403 || code === '42501') return 'Anda tidak memiliki akses untuk tindakan ini.';
  if (code === '23514' || code === 'P0002') return msg || 'Operasi ditolak.';
  if (status >= 500) return 'Terjadi gangguan pada server. Coba lagi nanti.';
  return msg || 'Permintaan gagal.';
}

export async function rest(path, { method = 'GET', body, headers = {}, prefer, range } = {}) {
  const cfg = await getConfig();
  let token = await validToken();
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body),
        headers: { apikey: cfg.supabaseAnonKey, authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(prefer ? { prefer } : {}), ...(range ? { range: `${range[0]}-${range[1]}`, 'range-unit': 'items' } : {}), ...headers } });
    } catch { throw new ApiError(0, 'network', 'Tidak dapat menghubungi server. Periksa koneksi internet Anda.'); }
    if (res.status === 401 && attempt === 0) { const s = getSession(); if (s) { token = await refresh(s); continue; } }
    const text = await res.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* */ }
    if (!res.ok) throw new ApiError(res.status, (data && data.code) || 'db_error', dbMessage(res.status, data));
    const m = /\/(\d+)$/.exec(res.headers.get('content-range') || '');
    return { data, count: m ? Number(m[1]) : null };
  }
  throw new ApiError(401, 'unauthenticated', 'Sesi tidak valid. Silakan login ulang.');
}

// Query builder bergaya PostgREST: from('examinations').select('*').eq('user_id', id).order('created_at', false).range(0, 9).count()
class Q {
  constructor(t) { this.t = t; this.p = new URLSearchParams(); this.m = 'GET'; this._prefer = []; this._body = undefined; this._range = null; }
  select(c = '*') { this.p.set('select', c); return this; }
  eq(c, v) { this.p.append(c, `eq.${v}`); return this; }
  gte(c, v) { this.p.append(c, `gte.${v}`); return this; }
  lte(c, v) { this.p.append(c, `lte.${v}`); return this; }
  lt(c, v) { this.p.append(c, `lt.${v}`); return this; }
  ilike(c, v) { this.p.append(c, `ilike.*${String(v).replace(/[*,()%\\]/g, ' ').trim()}*`); return this; }
  or(expr) { this.p.append('or', `(${expr})`); return this; }
  order(c, asc = true) { this.p.set('order', `${c}.${asc ? 'asc' : 'desc'}`); return this; }
  range(a, b) { this._range = [a, b]; return this; }
  limit(n) { this.p.set('limit', String(n)); return this; }
  count() { this._prefer.push('count=exact'); return this; }
  update(body) { this.m = 'PATCH'; this._body = body; return this; }
  remove() { this.m = 'DELETE'; return this; }
  run() { return rest(`${this.t}?${this.p}`, { method: this.m, body: this._body, prefer: this._prefer.join(',') || undefined, range: this._range }); }
  then(ok, err) { return this.run().then(ok, err); }
}
export const from = (t) => new Q(t);
export const rpc = (name, args) => rest(`rpc/${name}`, { method: 'POST', body: args || {} }).then((r) => r.data);
