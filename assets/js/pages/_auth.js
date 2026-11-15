// Tata letak halaman autentikasi (login, daftar, lupa/reset password).
import { url, h, icon, refreshIcons } from '../ui.js';
import { getConfig } from '../../../services/supabase.js';

export function authPage(inner, { title }) {
  document.title = `${title} · Crop Recommendation System`;
  $app().innerHTML = `<div class="auth"><section class="auth-art" aria-hidden="true"><a class="brand" style="padding:0" href="${url('index.html')}"><img src="${url('assets/images/logo.svg')}" alt=""><span>Crop Recommendation System</span></a>
  <div><h1>Rekomendasi tanaman berbasis data tanah dan iklim</h1><p>Masukkan kondisi N, P, K, suhu, kelembapan, pH, dan curah hujan. Model Machine Learning yang dilatih dari dataset akan merekomendasikan tanaman yang sesuai.</p>
  <ul><li>${icon('sprout')} 22 jenis tanaman</li><li>${icon('brain-circuit')} Model scikit-learn sungguhan</li><li>${icon('shield-check')} Data pribadi terlindungi</li></ul></div><img src="${url('assets/images/hero.svg')}" alt=""></section>
  <section class="auth-form"><div class="auth-box"><a class="brand" href="${url('index.html')}"><img src="${url('assets/images/logo.svg')}" alt=""><span>Crop Recommendation System</span></a><main id="main">${inner}</main></div></section></div>`;
  refreshIcons();
  getConfig().then((c) => { if (c.maintenance) { const b = document.createElement('div'); b.className = 'alert warn'; b.textContent = 'Aplikasi sedang dalam pemeliharaan; hanya administrator yang dapat memakai fitur tertentu.'; document.getElementById('main').prepend(b); } }).catch(() => {});
}
const $app = () => document.getElementById('app');
export const note = (el, type, msg) => { el.className = `alert ${type}`; el.textContent = msg; el.hidden = false; el.setAttribute('role', 'alert'); };
