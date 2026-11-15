import { $, url, withLoading, setErrors, pwToggle, pwField, textField } from '../ui.js';
import { authPage, note } from './_auth.js';
import { register, passwordProblem } from '../../../services/auth.js';
import { getConfig } from '../../../services/supabase.js';

authPage(`<h2 style="font-size:1.6rem">Daftar akun</h2><div id="msg" class="alert err" hidden></div><div id="body"><div class="skel"></div></div>`, { title: 'Daftar' });
const msg = $('#msg');
getConfig().then((c) => {
  if (!c.registrationEnabled) { $('#body').innerHTML = `<div class="alert info">Pendaftaran mandiri sedang dinonaktifkan oleh administrator. Silakan hubungi administrator untuk dibuatkan akun.</div><a class="btn secondary" href="${url('login.html')}">Kembali ke login</a>`; return; }
  $('#body').innerHTML = `<form id="f" novalidate>${textField('full_name', 'Nama lengkap', { auto: 'name', max: 120 })}${textField('email', 'Email', { type: 'email', auto: 'email', max: 254 })}${pwField('password', 'Password', 'new-password', 'Minimal 8 karakter, mengandung huruf dan angka.')}${pwField('password2', 'Ulangi password', 'new-password')}<button class="btn" style="width:100%" type="submit">Buat akun</button></form><p class="center muted mt">Sudah punya akun? <a href="${url('login.html')}">Masuk</a></p>`;
  pwToggle(); const f = $('#f');
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); msg.hidden = true; setErrors(f); const errs = {};
    const name = f.full_name.value.trim().replace(/\s+/g, ' '), email = f.email.value.trim();
    if (name.length < 2) errs.full_name = 'Nama lengkap minimal 2 karakter.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = 'Format email tidak valid.';
    const pp = passwordProblem(f.password.value); if (pp) errs.password = pp;
    if (f.password2.value !== f.password.value) errs.password2 = 'Password tidak sama.';
    if (Object.keys(errs).length) return setErrors(f, errs);
    await withLoading($('button[type=submit]', f), async () => {
      try { await register({ full_name: name, email, password: f.password.value }); f.reset(); $('#body').innerHTML = `<div class="alert ok">Akun berhasil dibuat.</div><a class="btn" href="${url('login.html')}">Lanjut ke login</a>`; }
      catch (err) { if (err.fields) setErrors(f, err.fields); note(msg, 'err', err.message); }
    });
  });
}).catch((e) => { $('#body').innerHTML = ''; note(msg, 'err', e.message); });
