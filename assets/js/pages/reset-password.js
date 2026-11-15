import { $, url, withLoading, setErrors, pwToggle, pwField } from '../ui.js';
import { authPage, note } from './_auth.js';
import { recoveryToken, recoveryError, setPassword, passwordProblem } from '../../../services/auth.js';

const token = recoveryToken(); const bad = recoveryError();
authPage(`<h2 style="font-size:1.6rem">Atur password baru</h2><div id="msg" class="alert err" hidden></div>
${token ? `<form id="f" novalidate>${pwField('password', 'Password baru', 'new-password', 'Minimal 8 karakter, mengandung huruf dan angka.')}${pwField('password2', 'Ulangi password baru', 'new-password')}<button class="btn" style="width:100%" type="submit">Simpan password</button></form>`
  : `<div class="alert err">${bad ? 'Tautan tidak valid atau sudah kedaluwarsa.' : 'Halaman ini hanya dapat dibuka dari tautan di email reset password.'}</div><a class="btn secondary" href="${url('forgot-password.html')}">Minta tautan baru</a>`}`, { title: 'Reset password' });
if (token) {
  history.replaceState(null, '', location.pathname);   // buang token dari bilah alamat
  pwToggle(); const f = $('#f'), msg = $('#msg');
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); msg.hidden = true; setErrors(f); const errs = {};
    const pp = passwordProblem(f.password.value); if (pp) errs.password = pp;
    if (f.password2.value !== f.password.value) errs.password2 = 'Password tidak sama.';
    if (Object.keys(errs).length) return setErrors(f, errs);
    await withLoading($('button[type=submit]', f), async () => {
      try { await setPassword(token, f.password.value); $('#main').innerHTML = `<h2>Password diperbarui</h2><div class="alert ok">Password berhasil diubah. Silakan masuk dengan password baru.</div><a class="btn" href="${url('login.html')}">Masuk</a>`; }
      catch (err) { note(msg, 'err', err.message); }
    });
  });
}
