// Registrasi mandiri: hanya bila admin mengaktifkan registration_enabled. Akun dibuat lewat Auth Admin API
// (service role di server) sehingga pendaftaran publik langsung ke Supabase sebaiknya dinonaktifkan (lihat docs/DEPLOYMENT.md).
import { json, route, readJson, isEmail, memLimit, clientIp, HttpError } from './_lib/core.js';
import { sb, getSettings, audit } from './_lib/supabase.js';

export default route(['POST'], async (req) => {
  const ip = clientIp(req) || 'unknown';
  memLimit(`reg-ip:${ip}`, 5, 10 * 60000);
  const s = await getSettings(true);
  if (s.registration_enabled !== true) throw new HttpError(403, 'registration_disabled', 'Pendaftaran akun baru sedang dinonaktifkan oleh administrator.');
  const b = await readJson(req, 4096);
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const fullName = typeof b.full_name === 'string' ? b.full_name.trim().replace(/\s+/g, ' ') : '';
  const password = typeof b.password === 'string' ? b.password : '';
  const fields = {};
  if (!isEmail(email)) fields.email = 'Format email tidak valid.';
  if (fullName.length < 2 || fullName.length > 120) fields.full_name = 'Nama lengkap 2–120 karakter.';
  if (password.length < 8 || password.length > 72) fields.password = 'Password 8–72 karakter.';
  else if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) fields.password = 'Password harus mengandung huruf dan angka.';
  if (Object.keys(fields).length) throw new HttpError(422, 'validation_error', 'Periksa kembali isian Anda.', fields);

  // Catatan: role TIDAK dibaca dari body. Trigger database selalu membuat profil dengan role 'user'.
  const res = await sb('/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true, user_metadata: { full_name: fullName } } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String(data.msg || data.message || '').toLowerCase();
    if (res.status === 422 && (data.error_code === 'email_exists' || msg.includes('already'))) throw new HttpError(409, 'email_exists', 'Email sudah terdaftar. Silakan login.');
    if (res.status === 422 && data.error_code === 'weak_password') throw new HttpError(422, 'validation_error', 'Password terlalu lemah.', { password: 'Password terlalu lemah.' });
    throw new HttpError(502, 'upstream_error', 'Pendaftaran gagal. Coba lagi nanti.');
  }
  await audit(req, null, 'user.register', 'Pendaftaran mandiri', 'success', { email, user_id: data.id });
  return json(201, { ok: true, message: 'Akun berhasil dibuat. Silakan login.' });
});
