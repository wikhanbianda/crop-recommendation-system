import { boot, pageHead, $, h, icon, fmtDate, renderPager, loadInto, modal, confirmBox, toast, toastError, debounce, setErrors, pwField, pwToggle, textField, refreshIcons, emptyState } from '../ui.js';
import { adminUsers } from '../../../services/api.js';
import { passwordProblem } from '../../../services/auth.js';

boot({ role: 'admin', nav: 'users', title: 'Pengguna', crumbs: [['Administrasi']] }, async (main, me) => {
  const st = { page: 1, size: 15, q: '', role: '', status: '' };
  main.innerHTML = pageHead('Manajemen pengguna', 'Tambah, ubah, nonaktifkan, dan hapus akun. Semua tindakan diverifikasi ulang di server dan dicatat di audit log.', `<button class="btn" id="add">${icon('user-plus')} Tambah pengguna</button>`) +
  `<div class="card flush"><div style="padding:1rem 1rem 0"><div class="filters"><div class="field grow"><label for="q">Cari nama/email</label><input id="q" type="search" maxlength="80"></div>
  <div class="field"><label for="r">Role</label><select id="r"><option value="">Semua</option><option value="admin">Admin</option><option value="user">User</option></select></div>
  <div class="field"><label for="s">Status</label><select id="s"><option value="">Semua</option><option value="active">Aktif</option><option value="inactive">Nonaktif</option></select></div></div></div><div id="t"></div><div id="p"></div></div>`;
  const load = () => loadInto($('#t'), async (el) => {
    const r = await adminUsers.list({ page: st.page, size: st.size, q: st.q, role: st.role, status: st.status });
    if (!r.users.length) { el.innerHTML = emptyState('Tidak ada pengguna', 'Tidak ada akun yang cocok dengan filter.'); $('#p').innerHTML = ''; refreshIcons(); return; }
    el.innerHTML = `<div class="table-wrap"><table class="stack-table"><thead><tr><th>Nama</th><th>Email</th><th>Role</th><th>Status</th><th>Terdaftar</th><th>Aksi</th></tr></thead><tbody>${r.users.map((u) => `<tr><td data-l="Nama">${h(u.full_name || '–')}</td><td data-l="Email">${h(u.email)}</td><td data-l="Role"><span class="badge ${u.role === 'admin' ? 'blue' : ''}">${u.role === 'admin' ? 'Admin' : 'User'}</span></td><td data-l="Status"><span class="badge ${u.status === 'active' ? 'green' : 'red'}">${u.status === 'active' ? 'Aktif' : 'Nonaktif'}</span></td><td data-l="Terdaftar" class="nowrap">${fmtDate(u.created_at, false)}</td>
      <td data-l="Aksi" class="nowrap"><button class="btn sm secondary" data-a="detail" data-id="${h(u.id)}">Detail</button> <button class="btn sm ghost" data-a="edit" data-id="${h(u.id)}">Ubah</button> <button class="btn sm ghost" data-a="toggle" data-id="${h(u.id)}">${u.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}</button> <button class="btn sm ghost" data-a="del" data-id="${h(u.id)}" aria-label="Hapus ${h(u.email)}">${icon('trash-2')}</button></td></tr>`).join('')}</tbody></table></div>`;
    const by = (id) => r.users.find((u) => u.id === id);
    el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => act(b.dataset.a, by(b.dataset.id))));
    renderPager($('#p'), { page: st.page, size: st.size, total: r.total, onPage: (p) => { st.page = p; load(); } }); refreshIcons();
  });
  async function act(a, u) {
    try {
      if (a === 'detail') { const d = await adminUsers.get(u.id); return modal({ title: 'Detail pengguna', size: 'lg', body: `<dl class="kv mb"><dt>Nama</dt><dd>${h(d.profile.full_name || '–')}</dd><dt>Email</dt><dd>${h(d.profile.email)}</dd><dt>Role</dt><dd>${d.profile.role}</dd><dt>Status</dt><dd>${d.profile.status}</dd><dt>Terdaftar</dt><dd>${fmtDate(d.profile.created_at)}</dd><dt>Login terakhir</dt><dd>${fmtDate(d.last_sign_in_at)}</dd><dt>Jumlah pemeriksaan</dt><dd>${d.examinations}</dd></dl><h3>Riwayat aktivitas (30 terakhir)</h3>${d.activity.length ? `<div class="table-wrap"><table><thead><tr><th>Waktu</th><th>Aksi</th><th>Keterangan</th><th>Status</th></tr></thead><tbody>${d.activity.map((x) => `<tr><td class="nowrap">${fmtDate(x.created_at)}</td><td>${h(x.action)}</td><td>${h(x.description)}</td><td><span class="badge ${x.status === 'success' ? 'green' : 'red'}">${h(x.status)}</span></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Belum ada aktivitas.</p>'}` }); }
      if (a === 'edit') return form(u);
      if (a === 'toggle') { const to = u.status === 'active' ? 'inactive' : 'active'; if (!(await confirmBox({ title: `${to === 'inactive' ? 'Nonaktifkan' : 'Aktifkan'} akun?`, text: `${u.email}${to === 'inactive' ? ' tidak akan bisa login sampai diaktifkan kembali.' : ' akan dapat login kembali.'}`, danger: to === 'inactive' }))) return; await adminUsers.update({ id: u.id, status: to }); toast('Status diperbarui.'); return load(); }
      if (a === 'del') { if (!(await confirmBox({ title: 'Hapus akun permanen?', text: `${u.email} beserta seluruh riwayat pemeriksaan dan percakapan AI-nya akan dihapus. Untuk sekadar menutup akses, gunakan “Nonaktifkan”.`, confirm: 'Hapus permanen', danger: true }))) return; await adminUsers.remove(u.id); toast('Akun dihapus.'); return load(); }
    } catch (e) { toastError(e); }
  }
  function form(u) {   // u = null -> tambah
    const body = document.createElement('form'); body.noValidate = true;
    body.innerHTML = `${textField('full_name', 'Nama lengkap', { max: 120 })}${u ? '' : textField('email', 'Email', { type: 'email', max: 254 })}<div class="field"><label for="f-role">Role</label><select id="f-role" name="role"><option value="user">User</option><option value="admin">Admin</option></select><span class="hint">Memberi role Admin memberi akses penuh ke seluruh data.</span><span class="error"></span></div>
    ${u ? '<div class="field"><label for="f-password">Atur ulang password (opsional)</label><div class="pw"><input id="f-password" name="password" type="password" autocomplete="new-password" maxlength="72"><button type="button" class="icon-btn" aria-label="Tampilkan password"><i data-lucide="eye"></i></button></div><span class="hint">Kosongkan jika tidak diubah.</span><span class="error"></span></div>' : pwField('password', 'Password awal', 'new-password', 'Minimal 8 karakter, huruf dan angka.')}`;
    if (u) { body.full_name.value = u.full_name || ''; body.role.value = u.role; }
    return modal({ title: u ? 'Ubah pengguna' : 'Tambah pengguna', body, buttons: [{ label: 'Batal', cls: 'ghost' }, { label: 'Simpan', value: true, onClick: async () => {
      setErrors(body); const errs = {}; const n = body.full_name.value.trim();
      if (n.length < 2) errs.full_name = 'Nama minimal 2 karakter.';
      if (!u && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.value.trim())) errs.email = 'Format email tidak valid.';
      const pw = body.password.value; if (!u || pw) { const pp = passwordProblem(pw); if (pp) errs.password = pp; }
      if (Object.keys(errs).length) { setErrors(body, errs); return false; }
      try {
        if (!u) await adminUsers.create({ full_name: n, email: body.email.value.trim(), password: pw, role: body.role.value });
        else { const ch = { id: u.id }; if (n !== u.full_name) ch.full_name = n; if (body.role.value !== u.role) ch.role = body.role.value; if (pw) ch.password = pw; if (Object.keys(ch).length === 1) { toast('Tidak ada perubahan.', 'info'); return true; } await adminUsers.update(ch); }
      } catch (e) { if (e.fields) setErrors(body, e.fields); throw e; }
      toast(u ? 'Pengguna diperbarui.' : 'Pengguna ditambahkan.'); load(); return true; } }], onOpen: (b) => { pwToggle(b); refreshIcons(); } });
  }
  $('#add').addEventListener('click', () => form(null));
  $('#q').addEventListener('input', debounce((e) => { st.q = e.target.value; st.page = 1; load(); })); $('#r').addEventListener('change', (e) => { st.role = e.target.value; st.page = 1; load(); }); $('#s').addEventListener('change', (e) => { st.status = e.target.value; st.page = 1; load(); });
  load();
});
