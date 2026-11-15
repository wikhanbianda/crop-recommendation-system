// Autentikasi: login/registrasi lewat backend (audit + pembatasan laju), sesi di browser, penjaga halaman.
import { ApiError, getConfig, getSession, saveSession, clearSession, validToken, rpc } from './supabase.js';
import { fn } from './api.js';

export async function login(email, password, remember) {
  const d = await fn('auth', { method: 'POST', query: '?action=login', body: { email, password }, auth: false });
  saveSession(d.session, !!remember);
  return d.user;
}
export async function logout() {
  try { if (getSession()) await fn('auth', { method: 'POST', query: '?action=logout' }); } catch { /* tetap keluar secara lokal */ }
  clearSession();
}
export const register = (body) => fn('register', { method: 'POST', body, auth: false });
export const me = async () => (await fn('auth')).user;

// Lupa password: respons selalu generik agar email terdaftar tidak bisa ditebak.
export async function forgotPassword(email) {
  const cfg = await getConfig();
  const redirect = encodeURIComponent(new URL('reset-password.html', new URL('../', import.meta.url)).href);
  try { await fetch(`${cfg.supabaseUrl}/auth/v1/recover?redirect_to=${redirect}`, { method: 'POST', headers: { apikey: cfg.supabaseAnonKey, 'content-type': 'application/json' }, body: JSON.stringify({ email }) }); }
  catch { throw new ApiError(0, 'network', 'Tidak dapat menghubungi server.'); }
}

function hashParams() { return new URLSearchParams(location.hash.replace(/^#/, '')); }
export function recoveryToken() { const p = hashParams(); return p.get('type') === 'recovery' ? p.get('access_token') : null; }
export function recoveryError() { const p = hashParams(); return p.get('error_description') || null; }

export async function setPassword(token, newPassword) {
  const cfg = await getConfig();
  const r = await fetch(`${cfg.supabaseUrl}/auth/v1/user`, { method: 'PUT', headers: { apikey: cfg.supabaseAnonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ password: newPassword }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, d.error_code || 'error', d.error_code === 'weak_password' ? 'Password terlalu lemah.' : d.error_code === 'same_password' ? 'Password baru harus berbeda dari yang lama.' : 'Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru.');
}

// Ganti password: verifikasi dulu password lama (re-autentikasi), lalu ubah, lalu catat ke audit.
export async function changePassword(email, current, next) {
  const cfg = await getConfig();
  const v = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: cfg.supabaseAnonKey, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: current }) });
  if (!v.ok) throw new ApiError(401, 'invalid_credentials', 'Password saat ini salah.', { current: 'Password saat ini salah.' });
  await setPassword(await validToken(), next);
  try { await rpc('log_client_event', { p_action: 'auth.password_change', p_details: {} }); } catch { /* audit best-effort */ }
}

export function passwordProblem(p) {
  if (typeof p !== 'string' || p.length < 8) return 'Password minimal 8 karakter.';
  if (p.length > 72) return 'Password maksimal 72 karakter.';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Password harus mengandung huruf dan angka.';
  return null;
}

export const homeFor = (role) => (role === 'admin' ? 'admin/dashboard.html' : 'user/dashboard.html');

// Penjaga halaman: sesi harus ada; role diambil dari server (database), bukan dari browser.
export async function requireAuth({ role } = {}) {
  if (!getSession()) throw Object.assign(new ApiError(401, 'unauthenticated', 'Silakan login.'), { redirect: 'login' });
  let user;
  try { user = await me(); }
  catch (e) {
    if (e.status === 401 || e.status === 403) { clearSession(); throw Object.assign(e, { redirect: 'login' }); }
    throw e;
  }
  if (role && user.role !== role) throw Object.assign(new ApiError(403, 'forbidden', 'Anda tidak memiliki akses ke halaman ini.'), { redirect: 'home', user });
  return user;
}
