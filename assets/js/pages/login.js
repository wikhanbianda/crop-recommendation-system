import { $, url, withLoading, setErrors, pwToggle, pwField, textField } from '../ui.js';
import { authPage, note } from './_auth.js';
import { login, homeFor, me } from '../../../services/auth.js';
import { getSession, getConfig } from '../../../services/supabase.js';

authPage(`<h2 style="font-size:1.6rem">Masuk</h2><p class="muted">Gunakan akun yang diberikan administrator.</p>
<div id="msg" class="alert err" hidden></div>
<form id="f" novalidate>${textField('email', 'Email', { type: 'email', auto: 'username', max: 254 })}${pwField('password', 'Password')}
<div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;margin-bottom:1rem"><label class="checks"><input type="checkbox" name="remember"> <span>Ingat saya di perangkat ini</span></label><a href="${url('forgot-password.html')}">Lupa password?</a></div>
<button class="btn" style="width:100%" type="submit">Masuk</button></form>
<p class="center muted mt" id="reg" hidden>Belum punya akun? <a href="${url('register.html')}">Daftar</a></p>`, { title: 'Masuk' });
pwToggle();
const f = $('#f'), msg = $('#msg');
const q = new URLSearchParams(location.search);
if (q.get('expired')) note(msg, 'warn', 'Sesi Anda berakhir. Silakan masuk kembali.');
getConfig().then((c) => { if (c.registrationEnabled) $('#reg').hidden = false; }).catch((e) => note(msg, 'err', e.message));
if (getSession()) me().then((u) => location.replace(url(homeFor(u.role)))).catch(() => {});
f.addEventListener('submit', async (e) => {
  e.preventDefault(); msg.hidden = true; setErrors(f);
  const email = f.email.value.trim(), password = f.password.value; const errs = {};
  if (!email) errs.email = 'Email wajib diisi.'; else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = 'Format email tidak valid.';
  if (!password) errs.password = 'Password wajib diisi.';
  if (Object.keys(errs).length) return setErrors(f, errs);
  await withLoading($('button[type=submit]', f), async () => {
    try { const u = await login(email, password, f.remember.checked); location.replace(url(homeFor(u.role))); }
    catch (err) { if (err.fields) setErrors(f, err.fields); note(msg, 'err', err.message); }
  });
});
