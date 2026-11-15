// Login/logout lewat server agar percobaan (berhasil/gagal) tercatat di audit log dan dibatasi lajunya.
// Browser tetap memegang token dan me-refresh langsung ke Supabase Auth.
import { json, route, readJson, isEmail, memLimit, clientIp, HttpError } from './_lib/core.js';
import { sb, sbJson, sbCount, authenticate, audit } from './_lib/supabase.js';

const WINDOW_MIN = 15; const MAX_FAILS = 8;

async function login(req) {
  const b = await readJson(req, 4096);
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  const fields = {};
  if (!isEmail(email)) fields.email = 'Format email tidak valid.';
  if (!password) fields.password = 'Password wajib diisi.'; else if (password.length > 200) fields.password = 'Password terlalu panjang.';
  if (Object.keys(fields).length) throw new HttpError(422, 'validation_error', 'Periksa kembali isian Anda.', fields);

  const ip = clientIp(req) || 'unknown';
  memLimit(`login-ip:${ip}`, 30, 5 * 60000);
  memLimit(`login-em:${email}`, 10, 5 * 60000);
  const since = new Date(Date.now() - WINDOW_MIN * 60000).toISOString();
  const fails = await sbCount(`/rest/v1/audit_logs?action=eq.auth.login_failed&actor_email=eq.${encodeURIComponent(email)}&created_at=gte.${encodeURIComponent(since)}`);
  if (fails >= MAX_FAILS) {
    const e = new HttpError(429, 'too_many_attempts', `Terlalu banyak percobaan login gagal. Coba lagi dalam ${WINDOW_MIN} menit.`); e.retryAfter = WINDOW_MIN * 60; throw e;
  }

  const res = await sb('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, anonOnly: true });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && data.error_code === 'user_banned') {
    // GoTrue hanya mengembalikan user_banned SETELAH password benar, jadi tidak membocorkan keberadaan email.
    await audit(req, null, 'auth.login_failed', 'Login ditolak: akun nonaktif', 'failure', { email });
    throw new HttpError(403, 'account_inactive', 'Akun Anda dinonaktifkan. Hubungi administrator.');
  }
  if (!res.ok) {
    await audit(req, null, 'auth.login_failed', 'Login gagal', 'failure', { email });
    // pesan generik: tidak membocorkan apakah email terdaftar
    throw new HttpError(401, 'invalid_credentials', 'Email atau password salah.');
  }
  const rows = await sbJson(`/rest/v1/profiles?id=eq.${encodeURIComponent(data.user.id)}&select=id,email,full_name,role,status`);
  const profile = rows && rows[0];
  if (!profile || profile.status !== 'active') {
    await audit(req, profile ? { profile } : null, 'auth.login_failed', 'Login ditolak: akun nonaktif', 'failure', { email });
    throw new HttpError(403, 'account_inactive', 'Akun Anda dinonaktifkan. Hubungi administrator.');
  }
  await audit(req, { profile }, 'auth.login', 'Login berhasil');
  return json(200, { session: { access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in, expires_at: data.expires_at, token_type: data.token_type }, user: { id: profile.id, email: profile.email, full_name: profile.full_name, role: profile.role, status: profile.status } });
}

async function logout(req) {
  const a = await authenticate(req).catch(() => null);
  if (a) { await audit(req, a, 'auth.logout', 'Logout'); await sb('/auth/v1/logout?scope=global', { token: a.token, method: 'POST' }).catch(() => {}); }
  return json(200, { ok: true });
}

// Profil + role dari database (sumber kebenaran). Dipakai frontend untuk menentukan halaman; bukan untuk keamanan.
async function me(req) { const a = await authenticate(req); return json(200, { user: { id: a.profile.id, email: a.profile.email, full_name: a.profile.full_name, role: a.profile.role, status: a.profile.status } }); }

export default route(['GET', 'POST'], async (req) => {
  if (req.method === 'GET') return me(req);
  const action = new URL(req.url).searchParams.get('action');
  if (action === 'login') return login(req);
  if (action === 'logout') return logout(req);
  throw new HttpError(400, 'bad_action', 'Aksi tidak dikenal.');
});
