// Profil + ganti password (dipakai admin dan user). Nama diubah lewat RLS (kolom full_name saja); role/status/email tidak bisa diubah dari sini.
import { boot, pageHead, $, h, icon, setErrors, withLoading, toast, fmtDate, pwToggle, pwField, textField, refreshIcons } from '../ui.js';
import { from } from '../../../services/supabase.js';
import { changePassword, passwordProblem } from '../../../services/auth.js';

const role = document.body.dataset.role;
boot({ role, nav: 'profile', title: role === 'admin' ? 'Profil Admin' : 'Profil' }, async (main, user) => {
  const { data } = await from('profiles').select('*').eq('id', user.id).run(); const p = data[0] || user;
  main.innerHTML = pageHead('Profil & keamanan akun') + `<div class="grid cols-2">
  <form class="card" id="pf" novalidate><h2>Informasi akun</h2>${textField('full_name', 'Nama lengkap', { auto: 'name', max: 120 })}
    <dl class="kv mb"><dt>Email</dt><dd>${h(p.email)}</dd><dt>Role</dt><dd>${p.role === 'admin' ? 'Administrator' : 'Pengguna'}</dd><dt>Status</dt><dd>${p.status === 'active' ? 'Aktif' : 'Nonaktif'}</dd><dt>Terdaftar</dt><dd>${fmtDate(p.created_at)}</dd></dl>
    <p class="muted small">Email dan role hanya dapat diubah oleh administrator.</p><button class="btn" type="submit">Simpan perubahan</button></form>
  <form class="card" id="pw" novalidate><h2>Ganti password</h2>${pwField('current', 'Password saat ini')}${pwField('next', 'Password baru', 'new-password', 'Minimal 8 karakter, mengandung huruf dan angka.')}${pwField('again', 'Ulangi password baru', 'new-password')}<button class="btn" type="submit">Ubah password</button></form></div>`;
  pwToggle(main); refreshIcons();
  const pf = $('#pf'); pf.full_name.value = p.full_name || '';
  pf.addEventListener('submit', async (e) => {
    e.preventDefault(); setErrors(pf); const n = pf.full_name.value.trim().replace(/\s+/g, ' ');
    if (n.length < 2 || n.length > 120) return setErrors(pf, { full_name: 'Nama 2–120 karakter.' });
    await withLoading($('button', pf), async () => { try { await from('profiles').eq('id', user.id).update({ full_name: n }).run(); toast('Profil disimpan.'); $('.who b')?.replaceChildren(n); } catch (err) { toast(err.message, 'error'); } });
  });
  const pw = $('#pw');
  pw.addEventListener('submit', async (e) => {
    e.preventDefault(); setErrors(pw); const errs = {};
    if (!pw.current.value) errs.current = 'Password saat ini wajib diisi.';
    const pp = passwordProblem(pw.next.value); if (pp) errs.next = pp; else if (pw.next.value === pw.current.value) errs.next = 'Password baru harus berbeda.';
    if (pw.again.value !== pw.next.value) errs.again = 'Password tidak sama.';
    if (Object.keys(errs).length) return setErrors(pw, errs);
    await withLoading($('button', pw), async () => { try { await changePassword(user.email, pw.current.value, pw.next.value); pw.reset(); toast('Password berhasil diubah.'); } catch (err) { if (err.fields) setErrors(pw, err.fields); toast(err.message, 'error'); } });
  });
});
