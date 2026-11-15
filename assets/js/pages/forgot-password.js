import { $, url, withLoading, setErrors, textField } from '../ui.js';
import { authPage, note } from './_auth.js';
import { forgotPassword } from '../../../services/auth.js';

authPage(`<h2 style="font-size:1.6rem">Lupa password</h2><p class="muted">Masukkan email akun Anda. Jika terdaftar, tautan untuk mengatur ulang password akan dikirim.</p><div id="msg" class="alert err" hidden></div>
<form id="f" novalidate>${textField('email', 'Email', { type: 'email', auto: 'email', max: 254 })}<button class="btn" style="width:100%" type="submit">Kirim tautan reset</button></form><p class="center mt"><a href="${url('login.html')}">Kembali ke login</a></p>`, { title: 'Lupa password' });
const f = $('#f'), msg = $('#msg');
f.addEventListener('submit', async (e) => {
  e.preventDefault(); msg.hidden = true; setErrors(f); const email = f.email.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setErrors(f, { email: 'Format email tidak valid.' });
  await withLoading($('button[type=submit]', f), async () => {
    try { await forgotPassword(email); note(msg, 'ok', 'Jika email terdaftar, tautan reset password telah dikirim. Periksa kotak masuk dan folder spam.'); f.reset(); } catch (err) { note(msg, 'err', err.message); }
  });
});
