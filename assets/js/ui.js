// Pustaka UI bersama: kerangka halaman (sidebar/topbar/breadcrumb), toast, konfirmasi, modal, tabel, grafik, ekspor.
// SweetAlert2 / Chart.js / Lucide dimuat dari CDN; bila gagal dimuat, tersedia fallback sederhana agar aplikasi tetap berfungsi.
import { requireAuth, logout, homeFor } from '../../services/auth.js';
import { ApiError } from '../../services/supabase.js';

export const ROOT = new URL('../../', import.meta.url).href;
export const url = (p) => new URL(p, ROOT).href;
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const h = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => MAP[c]);          // SEMUA data dinamis wajib lewat h()
export const fmtDate = (d, withTime = true) => { if (!d) return '–'; const x = new Date(d); if (isNaN(x)) return '–'; return x.toLocaleString('id-ID', { timeZone: 'Asia/Jayapura', day: '2-digit', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }); };
export const fmtNum = (n, d = 1) => (n == null || n === '' ? '–' : Number(n).toLocaleString('id-ID', { maximumFractionDigits: d }));
export const pct = (x, d = 2) => (x == null ? '–' : (Number(x) * 100).toFixed(d) + '%');
export const initials = (n) => (String(n || '?').trim().split(/\s+/).slice(0, 2).map((s) => s[0]).join('') || '?').toUpperCase();
export const debounce = (f, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
export const icon = (n) => `<i data-lucide="${n}" aria-hidden="true"></i>`;
const GLYPH = { menu: '☰', x: '✕', eye: '👁', 'eye-off': '🙈', 'trash-2': '🗑', plus: '＋', send: '➤', printer: '🖨', download: '⬇', upload: '⬆', 'file-down': '⬇', 'user-plus': '＋', 'rotate-ccw': '↺', 'log-out': '⏻', 'triangle-alert': '⚠', info: 'ℹ', check: '✓', sparkles: '✦', sprout: '🌱' };
export const refreshIcons = () => {   // Lucide dari CDN; bila gagal dimuat, ikon penting diganti glyph teks agar tombol tetap terlihat
  try { if (window.lucide) { window.lucide.createIcons(); return; } } catch { /* jatuh ke fallback */ }
  document.querySelectorAll('i[data-lucide]:empty').forEach((i) => { const g = GLYPH[i.dataset.lucide]; if (g) { i.textContent = g; i.style.cssText = 'font-style:normal;width:auto;line-height:1'; } });
};
export const errMsg = (e) => (e instanceof ApiError ? e.message : 'Terjadi kesalahan tak terduga.');

// ---------- notifikasi ----------
export function toast(message, type = 'success') {
  const S = window.Swal;
  if (S) { S.fire({ toast: true, position: 'top-end', icon: type === 'error' ? 'error' : type, title: message, showConfirmButton: false, timer: 3800, timerProgressBar: true }); return; }
  let box = $('.toasts'); if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.append(box); }
  const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = message; box.append(t); setTimeout(() => t.remove(), 4200);
}
export const toastError = (e) => toast(errMsg(e), 'error');

export function modal({ title, body, size = '', buttons = [{ label: 'Tutup', cls: 'ghost', value: false }], onOpen } = {}) {
  return new Promise((resolve) => {
    const ov = document.createElement('div'); ov.className = 'overlay'; const prev = document.activeElement;
    ov.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${h(title)}"><header><h2>${h(title)}</h2><button class="icon-btn" data-x aria-label="Tutup">${icon('x')}</button></header><div class="body"></div><footer></footer></div>`;
    const bodyEl = $('.body', ov); if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
    const foot = $('footer', ov);
    const close = (v) => { ov.remove(); document.removeEventListener('keydown', esc); prev && prev.focus && prev.focus(); resolve(v); };
    const esc = (e) => { if (e.key === 'Escape') close(false); };
    for (const b of buttons) { const el = document.createElement('button'); el.type = 'button'; el.className = `btn ${b.cls || ''}`; el.textContent = b.label;
      el.addEventListener('click', async () => { if (b.onClick) { el.classList.add('loading'); try { const r = await b.onClick(bodyEl); if (r === false) return; close(r ?? b.value); } catch (e) { toastError(e); } finally { el.classList.remove('loading'); } } else close(b.value); }); foot.append(el); }
    $('[data-x]', ov).addEventListener('click', () => close(false)); ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(false); });
    document.addEventListener('keydown', esc); document.body.append(ov); refreshIcons();
    const f = $('input,select,textarea,.btn:last-child', ov); f && f.focus(); onOpen && onOpen(bodyEl, close);
  });
}
export async function confirmBox({ title, text, confirm = 'Ya, lanjutkan', danger = false }) {
  if (window.Swal) { const r = await window.Swal.fire({ title, text, icon: danger ? 'warning' : 'question', showCancelButton: true, confirmButtonText: confirm, cancelButtonText: 'Batal', confirmButtonColor: danger ? '#b91c1c' : '#166534', reverseButtons: true, focusCancel: danger }); return r.isConfirmed; }
  return modal({ title, body: `<p>${h(text)}</p>`, size: 'sm', buttons: [{ label: 'Batal', cls: 'ghost', value: false }, { label: confirm, cls: danger ? 'danger' : '', value: true }] });
}

// ---------- keadaan tampilan ----------
export const skeleton = (n = 3) => `<div class="card" aria-busy="true" aria-label="Memuat">${'<span class="skel s"></span><span class="skel"></span>'.repeat(n)}</div>`;
export const emptyState = (t, d = '', act = '') => `<div class="empty">${icon('inbox')}<h3>${h(t)}</h3><p>${h(d)}</p>${act}</div>`;
export const errorState = (e, retry = true) => `<div class="errstate">${icon('triangle-alert')}<h3>Tidak dapat memuat data</h3><p>${h(errMsg(e))}</p>${retry ? '<button class="btn secondary" data-retry>Coba lagi</button>' : ''}</div>`;
export function loadInto(el, fn, { skel = skeleton() } = {}) {   // jalankan fn, tampilkan skeleton -> hasil / error + tombol coba lagi
  const run = async () => { el.innerHTML = skel; try { await fn(el); } catch (e) { if (e.redirect) throw e; el.innerHTML = errorState(e); $('[data-retry]', el)?.addEventListener('click', run); refreshIcons(); } refreshIcons(); };
  return run();
}
export async function withLoading(btn, fn) { btn.classList.add('loading'); btn.disabled = true; try { return await fn(); } finally { btn.classList.remove('loading'); btn.disabled = false; } }

// ---------- pager ----------
export function renderPager(el, { page, size, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / size)); const from = total ? (page - 1) * size + 1 : 0; const to = Math.min(total, page * size);
  const nums = []; for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) nums.push(i);
  el.className = 'pager'; el.innerHTML = `<span>Menampilkan ${from}–${to} dari ${total}</span><span class="pg"><button data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Sebelumnya">‹</button>${nums.map((n) => `<button data-p="${n}" class="${n === page ? 'cur' : ''}" ${n === page ? 'aria-current="page"' : ''}>${n}</button>`).join('')}<button data-p="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="Berikutnya">›</button></span>`;
  $$('button[data-p]', el).forEach((b) => b.addEventListener('click', () => onPage(Number(b.dataset.p))));
}

// ---------- grafik ----------
const COLORS = ['#166534', '#22c55e', '#0369a1', '#d97706', '#6d28d9', '#b91c1c', '#0f766e', '#a16207', '#be185d', '#4d7c0f'];
const charts = new WeakMap();
export function drawChart(host, { type = 'bar', labels, datasets, horizontal = false, stacked = false, legend = false, yTitle }) {
  charts.get(host)?.destroy?.(); host.innerHTML = '';
  if (!labels.length || !datasets.some((d) => d.data.some((v) => v > 0))) { host.innerHTML = emptyState('Belum ada data', 'Grafik akan muncul setelah ada data.'); refreshIcons(); return; }
  if (window.Chart) {
    const cv = document.createElement('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Grafik ' + (datasets[0].label || '')); host.append(cv);
    const pie = type === 'doughnut' || type === 'pie';
    const ds = datasets.map((d, i) => ({ borderRadius: type === 'bar' ? 5 : 0, tension: .3, fill: type === 'line' ? 'start' : false, backgroundColor: pie ? labels.map((_, j) => COLORS[j % COLORS.length]) : (type === 'line' ? 'rgba(34,197,94,.15)' : COLORS[i % COLORS.length]), borderColor: pie ? '#fff' : COLORS[i % COLORS.length], ...d }));
    charts.set(host, new window.Chart(cv, { type, data: { labels, datasets: ds }, options: { responsive: true, maintainAspectRatio: false, indexAxis: horizontal ? 'y' : 'x', plugins: { legend: { display: legend || pie } }, scales: pie ? {} : { x: { stacked, grid: { display: false } }, y: { stacked, beginAtZero: true, ticks: { precision: 0 }, title: { display: !!yTitle, text: yTitle } } } } }));
    return;
  }
  const d = datasets[0].data; const max = Math.max(...d, 1);   // fallback tanpa Chart.js: batang HTML
  host.innerHTML = `<div class="fb-bars" role="img" aria-label="Grafik ${h(datasets[0].label || '')}">${labels.map((l, i) => `<div class="fb-row"><span>${h(l)}</span><span><div class="fb-bar" style="width:${(d[i] / max) * 100}%"></div></span><b>${fmtNum(d[i], 2)}</b></div>`).join('')}</div>`;
}

// ---------- ekspor ----------
export function downloadCsv(name, header, rows) {
  const esc = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };   // cegah CSV/formula injection
  const csv = '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export const printPage = () => window.print();   // "Simpan sebagai PDF" lewat dialog cetak peramban

// ---------- kerangka halaman ----------
const NAV = {
  admin: [['Utama', [['dashboard', 'admin/dashboard.html', 'layout-dashboard', 'Dashboard']]],
    ['Data & Model', [['examinations', 'admin/examinations.html', 'clipboard-list', 'Pemeriksaan'], ['datasets', 'admin/datasets.html', 'database', 'Dataset'], ['models', 'admin/models.html', 'brain-circuit', 'Model ML']]],
    ['Administrasi', [['users', 'admin/users.html', 'users', 'Pengguna'], ['reports', 'admin/reports.html', 'bar-chart-3', 'Laporan'], ['audit', 'admin/audit-logs.html', 'shield-check', 'Audit log'], ['settings', 'admin/settings.html', 'settings', 'Pengaturan']]],
    ['Bantuan', [['ai', 'ai-assistant/assistant.html', 'sparkles', 'Asisten AI'], ['profile', 'admin/profile.html', 'user-round', 'Profil']]]],
  user: [['Utama', [['dashboard', 'user/dashboard.html', 'layout-dashboard', 'Dashboard'], ['prediction', 'user/prediction.html', 'sprout', 'Pemeriksaan baru'], ['history', 'user/history.html', 'history', 'Riwayat']]],
    ['Bantuan', [['ai', 'ai-assistant/assistant.html', 'sparkles', 'Asisten AI'], ['profile', 'user/profile.html', 'user-round', 'Profil & password']]]],
};
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } };

export async function boot({ role, nav, title, crumbs = [] }, render) {
  const app = $('#app'); app.innerHTML = `<div class="boot" aria-busy="true">Memuat…</div>`;
  let user;
  try { user = await requireAuth({ role }); }
  catch (e) {
    if (e.redirect === 'home' && e.user) { location.replace(url(homeFor(e.user.role))); return; }
    if (e.redirect === 'login') { location.replace(url('login.html')); return; }
    app.innerHTML = `<div class="content">${errorState(e)}</div>`; $('[data-retry]')?.addEventListener('click', () => location.reload()); refreshIcons(); return;
  }
  const items = NAV[user.role];
  const navHtml = items.map(([g, ls]) => `<div class="grp">${h(g)}</div>${ls.map(([k, href, ic, label]) => `<a href="${url(href)}" class="${k === nav ? 'active' : ''}" ${k === nav ? 'aria-current="page"' : ''}>${icon(ic)}<span>${h(label)}</span></a>`).join('')}`).join('');
  const crumbHtml = [`<a href="${url(homeFor(user.role))}">Beranda</a>`, ...crumbs.map(([t, href]) => (href ? `<a href="${url(href)}">${h(t)}</a>` : '')), `<b>${h(title)}</b>`].filter(Boolean).join(' <span aria-hidden="true">/</span> ');
  document.title = `${title} · Crop Recommendation System`;
  app.innerHTML = `<div class="app"><aside class="sidebar" id="side" aria-label="Navigasi utama"><a class="brand" href="${url(homeFor(user.role))}"><img src="${url('assets/images/logo.svg')}" alt=""><span>Crop Recommendation</span></a><nav class="nav">${navHtml}</nav><div class="side-foot">Role: ${user.role === 'admin' ? 'Administrator' : 'Pengguna'}</div></aside><div class="scrim" id="scrim"></div>
  <div class="main-wrap"><header class="topbar"><button class="icon-btn" id="burger" aria-label="Buka/tutup menu" aria-controls="side">${icon('menu')}</button><nav class="crumbs" aria-label="Breadcrumb">${crumbHtml}</nav><span class="spacer"></span>
  <div class="usermenu"><button class="userbtn" id="ubtn" aria-haspopup="true" aria-expanded="false"><span class="avatar">${h(initials(user.full_name || user.email))}</span><span class="who"><b>${h(user.full_name || user.email)}</b><small>${user.role === 'admin' ? 'Administrator' : 'Pengguna'}</small></span></button>
  <div class="menu" id="umenu" role="menu"><a role="menuitem" href="${url(user.role === 'admin' ? 'admin/profile.html' : 'user/profile.html')}">${icon('user-round')}Profil</a><button role="menuitem" id="logout">${icon('log-out')}Keluar</button></div></div></header>
  <main class="content" id="main" tabindex="-1"></main></div></div>`;
  if (lsGet('crop.side') === '1') document.body.classList.add('side-collapsed');
  const mobile = () => matchMedia('(max-width:900px)').matches;
  $('#burger').addEventListener('click', () => { if (mobile()) document.body.classList.toggle('side-open'); else { const c = document.body.classList.toggle('side-collapsed'); lsSet('crop.side', c ? '1' : '0'); } });
  $('#scrim').addEventListener('click', () => document.body.classList.remove('side-open'));
  const ub = $('#ubtn'), um = $('#umenu');
  ub.addEventListener('click', (e) => { e.stopPropagation(); const o = um.classList.toggle('open'); ub.setAttribute('aria-expanded', o); });
  document.addEventListener('click', () => { um.classList.remove('open'); ub.setAttribute('aria-expanded', 'false'); });
  $('#logout').addEventListener('click', async () => { await logout(); location.replace(url('login.html')); });
  refreshIcons();
  const main = $('#main');
  try { await render(main, user); } catch (e) { if (e.redirect) { location.replace(url('login.html')); return; } main.innerHTML = errorState(e); $('[data-retry]', main)?.addEventListener('click', () => location.reload()); }
  refreshIcons();
  return user;
}
export const pageHead = (t, d = '', actions = '') => `<div class="page-head"><div><h1>${h(t)}</h1>${d ? `<p>${h(d)}</p>` : ''}</div><div class="actions">${actions}</div></div>`;

// ---------- formulir ----------
export function setErrors(form, fields = {}) {   // fields: {nama: pesan}; kosongkan semua bila {}
  $$('.field', form).forEach((f) => { f.classList.remove('invalid'); const e = $('.error', f); if (e) e.textContent = ''; });
  let first = null;
  for (const [k, msg] of Object.entries(fields)) {
    const inp = form.elements[k]; const f = inp && inp.closest ? inp.closest('.field') : null;
    if (f) { f.classList.add('invalid'); const e = $('.error', f); if (e) e.textContent = msg; inp.setAttribute('aria-invalid', 'true'); first = first || inp; }
  }
  first && first.focus();
}
export function pwToggle(root = document) {
  $$('.pw', root).forEach((w) => { const i = $('input', w), b = $('button', w); b.addEventListener('click', () => { const s = i.type === 'password'; i.type = s ? 'text' : 'password'; b.setAttribute('aria-label', s ? 'Sembunyikan password' : 'Tampilkan password'); b.innerHTML = icon(s ? 'eye-off' : 'eye'); refreshIcons(); }); });
}
export const pwField = (name, label, auto = 'current-password', hint = '') => `<div class="field"><label for="f-${name}">${h(label)}</label><div class="pw"><input id="f-${name}" name="${name}" type="password" autocomplete="${auto}" required maxlength="200"><button type="button" class="icon-btn" aria-label="Tampilkan password">${icon('eye')}</button></div>${hint ? `<span class="hint">${h(hint)}</span>` : ''}<span class="error" role="alert"></span></div>`;
export const textField = (name, label, { type = 'text', auto = '', hint = '', req = true, max = 200 } = {}) => `<div class="field"><label for="f-${name}">${h(label)}</label><input id="f-${name}" name="${name}" type="${type}" ${auto ? `autocomplete="${auto}"` : ''} ${req ? 'required' : ''} maxlength="${max}">${hint ? `<span class="hint">${h(hint)}</span>` : ''}<span class="error" role="alert"></span></div>`;
