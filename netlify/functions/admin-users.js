// Manajemen pengguna (admin). Setiap request diverifikasi ulang di server: token valid + profil aktif + role admin dari database.
// Perubahan role/status lewat RPC SECURITY DEFINER dengan token admin (is_admin() diperiksa lagi di database + audit di dalamnya).
import { json, route, readJson, isUuid, isEmail, HttpError } from './_lib/core.js';
import { authenticate, sb, sbJson, sbCount, audit } from './_lib/supabase.js';

const BAN = '876000h';
const enc = encodeURIComponent;

async function authAdmin(path, method, body) {
  const res = await sb(`/auth/v1/admin/users${path}`, { method, body });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}
function rpcError(e) {
  const m = String(e.message || '');
  if (e.status === 403 || /42501|Akses ditolak/.test(m)) return new HttpError(403, 'forbidden', 'Akses ditolak.');
  if (/admin aktif terakhir|menonaktifkan akun sendiri|P0002|tidak ditemukan/i.test(m) || e.status === 400 || e.status === 409) return new HttpError(409, 'conflict', m.slice(0, 200) || 'Operasi ditolak.');
  return new HttpError(502, 'upstream_error', 'Operasi gagal.');
}
function checkPassword(p, fields) {
  if (typeof p !== 'string' || p.length < 8 || p.length > 72) fields.password = 'Password 8–72 karakter.';
  else if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) fields.password = 'Password harus mengandung huruf dan angka.';
}

export default route(['GET', 'POST', 'PATCH', 'DELETE'], async (req) => {
  const auth = await authenticate(req, { admin: true });
  const url = new URL(req.url); const q = url.searchParams;

  if (req.method === 'GET') {
    const id = q.get('id');
    if (id) {   // detail + riwayat aktivitas
      if (!isUuid(id)) throw new HttpError(422, 'validation_error', 'id tidak valid.');
      const [p] = await sbJson(`/rest/v1/profiles?id=eq.${id}&select=*`);
      if (!p) throw new HttpError(404, 'not_found', 'Pengguna tidak ditemukan.');
      const { res, data } = await authAdmin(`/${id}`, 'GET');
      const activity = await sbJson(`/rest/v1/audit_logs?user_id=eq.${id}&select=id,action,description,status,ip_address,created_at&order=created_at.desc&limit=30`);
      const exams = await sbCount(`/rest/v1/examinations?user_id=eq.${id}`);
      return json(200, { profile: p, last_sign_in_at: res.ok ? data.last_sign_in_at || null : null, examinations: exams, activity });
    }
    const page = Math.max(1, Number(q.get('page')) || 1); const size = Math.min(100, Math.max(1, Number(q.get('size')) || 20));
    const parts = [];
    const s = (q.get('q') || '').trim().slice(0, 80).replace(/[%,()*\\]/g, ' ');
    if (s) parts.push(`or=(email.ilike.*${enc(s)}*,full_name.ilike.*${enc(s)}*)`);
    if (['admin', 'user'].includes(q.get('role'))) parts.push(`role=eq.${q.get('role')}`);
    if (['active', 'inactive'].includes(q.get('status'))) parts.push(`status=eq.${q.get('status')}`);
    const res = await sb(`/rest/v1/profiles?select=*${parts.length ? '&' + parts.join('&') : ''}&order=created_at.desc`, { headers: { prefer: 'count=exact', range: `${(page - 1) * size}-${page * size - 1}`, 'range-unit': 'items' } });
    if (!res.ok) throw new HttpError(502, 'upstream_error', 'Gagal memuat pengguna.');
    const total = Number((/\/(\d+)$/.exec(res.headers.get('content-range') || '') || [])[1] || 0);
    return json(200, { users: await res.json(), total, page, size });
  }

  const b = req.method === 'DELETE' ? {} : await readJson(req, 4096);

  if (req.method === 'POST') {   // tambah pengguna
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    const fullName = typeof b.full_name === 'string' ? b.full_name.trim().replace(/\s+/g, ' ') : '';
    const role = b.role === undefined ? 'user' : b.role;
    const fields = {};
    if (!isEmail(email)) fields.email = 'Format email tidak valid.';
    if (fullName.length < 2 || fullName.length > 120) fields.full_name = 'Nama lengkap 2–120 karakter.';
    if (!['admin', 'user'].includes(role)) fields.role = 'Role tidak valid.';
    checkPassword(b.password, fields);
    if (Object.keys(fields).length) throw new HttpError(422, 'validation_error', 'Periksa kembali isian.', fields);
    const { res, data } = await authAdmin('', 'POST', { email, password: b.password, email_confirm: true, user_metadata: { full_name: fullName } });
    if (!res.ok) {
      if (res.status === 422 && (data.error_code === 'email_exists' || /already/i.test(data.msg || ''))) throw new HttpError(409, 'email_exists', 'Email sudah terdaftar.');
      throw new HttpError(502, 'upstream_error', 'Gagal membuat akun.');
    }
    if (role === 'admin') {
      try { await sbJson('/rest/v1/rpc/admin_set_role', { method: 'POST', token: auth.token, body: { target: data.id, new_role: 'admin' } }); }
      catch (e) { throw rpcError(e); }
    }
    await audit(req, auth, 'user.create', 'Admin menambah pengguna', 'success', { target: data.id, email, role });
    return json(201, { id: data.id, email, role });
  }

  if (req.method === 'PATCH') {   // ubah nama / role / status / password
    const id = b.id;
    if (!isUuid(id)) throw new HttpError(422, 'validation_error', 'id tidak valid.');
    const todo = [];
    try {
      if (b.full_name !== undefined) {
        if (typeof b.full_name !== 'string' || b.full_name.trim().length < 2 || b.full_name.length > 120) throw new HttpError(422, 'validation_error', 'Nama 2–120 karakter.', { full_name: 'Nama 2–120 karakter.' });
        await sbJson('/rest/v1/rpc/admin_update_profile', { method: 'POST', token: auth.token, body: { target: id, p_full_name: b.full_name } }); todo.push('full_name');
      }
      if (b.role !== undefined) {
        if (!['admin', 'user'].includes(b.role)) throw new HttpError(422, 'validation_error', 'Role tidak valid.', { role: 'Role tidak valid.' });
        if (id === auth.profile.id && b.role !== 'admin') throw new HttpError(409, 'conflict', 'Anda tidak dapat menurunkan role akun sendiri.');
        await sbJson('/rest/v1/rpc/admin_set_role', { method: 'POST', token: auth.token, body: { target: id, new_role: b.role } }); todo.push('role');
      }
      if (b.status !== undefined) {
        if (!['active', 'inactive'].includes(b.status)) throw new HttpError(422, 'validation_error', 'Status tidak valid.', { status: 'Status tidak valid.' });
        await sbJson('/rest/v1/rpc/admin_set_status', { method: 'POST', token: auth.token, body: { target: id, new_status: b.status } }); todo.push('status');
        // blokir juga di Supabase Auth agar token refresh tidak bisa dipakai lagi
        await authAdmin(`/${id}`, 'PUT', { ban_duration: b.status === 'inactive' ? BAN : 'none' });
      }
      if (b.password !== undefined) {
        const fields = {}; checkPassword(b.password, fields);
        if (fields.password) throw new HttpError(422, 'validation_error', fields.password, fields);
        const { res } = await authAdmin(`/${id}`, 'PUT', { password: b.password });
        if (!res.ok) throw new HttpError(502, 'upstream_error', 'Gagal mengatur ulang password.');
        await audit(req, auth, 'user.password_reset', 'Admin mengatur ulang password pengguna', 'success', { target: id }); todo.push('password');
      }
    } catch (e) { if (e instanceof HttpError) throw e; throw rpcError(e); }
    if (!todo.length) throw new HttpError(422, 'validation_error', 'Tidak ada perubahan yang dikirim.');
    return json(200, { ok: true, changed: todo });
  }

  // DELETE ?id=
  const id = q.get('id');
  if (!isUuid(id)) throw new HttpError(422, 'validation_error', 'id tidak valid.');
  if (id === auth.profile.id) throw new HttpError(409, 'conflict', 'Anda tidak dapat menghapus akun sendiri.');
  const [target] = await sbJson(`/rest/v1/profiles?id=eq.${id}&select=email,role`);
  if (!target) throw new HttpError(404, 'not_found', 'Pengguna tidak ditemukan.');
  const { res, data } = await authAdmin(`/${id}`, 'DELETE');
  if (!res.ok) {
    const m = String(data.msg || data.message || '');
    if (/admin aktif terakhir|23514/.test(m)) throw new HttpError(409, 'conflict', 'Tidak bisa menghapus admin aktif terakhir.');
    throw new HttpError(502, 'upstream_error', 'Gagal menghapus akun.');
  }
  await audit(req, auth, 'user.delete', 'Admin menghapus pengguna', 'success', { target: id, email: target.email });
  return json(200, { ok: true });
});
