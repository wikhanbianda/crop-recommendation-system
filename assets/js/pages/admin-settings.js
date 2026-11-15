import { boot, pageHead, $, h, icon, loadInto, toast, toastError, withLoading, setErrors, fmtDate, refreshIcons } from '../ui.js';
import { from, rpc } from '../../../services/supabase.js';
import * as ai from '../../../services/ai.js';

boot({ role: 'admin', nav: 'settings', title: 'Pengaturan', crumbs: [['Administrasi']] }, async (main) => {
  main.innerHTML = pageHead('Pengaturan aplikasi', 'Perubahan disimpan ke database dan dicatat di audit log.') + '<div id="body"></div>';
  await loadInto($('#body'), async (el) => {
    const { data } = await from('application_settings').select('setting_key,setting_value,updated_at').run(); const s = Object.fromEntries(data.map((r) => [r.setting_key, r.setting_value]));
    const st = await ai.status().catch((e) => ({ error: e.message }));
    const sw = (k, l, d) => `<label class="switch"><span><b>${h(l)}</b><br><span class="muted small">${h(d)}</span></span><input type="checkbox" role="switch" data-k="${k}" ${s[k] === true ? 'checked' : ''}></label>`;
    el.innerHTML = `<div class="grid cols-2"><div class="card"><h2>Umum</h2>${sw('registration_enabled', 'Pendaftaran mandiri', 'Izinkan pengunjung membuat akun User sendiri.')}${sw('maintenance_mode', 'Mode pemeliharaan', 'Memblokir prediksi dan AI untuk non-admin.')}
      <form id="gf" class="mt" novalidate><div class="field"><label for="g-name">Nama aplikasi</label><input id="g-name" name="app_name" maxlength="60" value="${h(s.app_name || '')}"><span class="error"></span></div><div class="field"><label for="g-rate">Batas pemeriksaan per menit per pengguna</label><input id="g-rate" name="prediction_rate_per_minute" type="number" min="1" max="120" value="${h(s.prediction_rate_per_minute ?? 20)}"><span class="error"></span></div><button class="btn" type="submit">Simpan</button></form></div>
    <div class="card"><h2>Pengelolaan AI Assistant</h2>${sw('ai_enabled', 'Aktifkan Asisten AI', 'Bila nonaktif, pengguna melihat pesan bahwa AI dimatikan.')}
      <form id="af" class="mt" novalidate><div class="field"><label for="a-lim">Batas pesan AI per pengguna per 24 jam</label><input id="a-lim" name="ai_daily_limit" type="number" min="0" max="500" value="${h(s.ai_daily_limit ?? 30)}"><span class="hint">Melindungi kuota gratis penyedia. 0 = tidak ada pesan yang diizinkan.</span><span class="error"></span></div><button class="btn" type="submit">Simpan batas</button></form>
      <hr style="border:0;border-top:1px solid var(--line);margin:1rem 0"><h3>Status penyedia</h3>${st.error ? `<div class="alert err">${h(st.error)}</div>` : `<dl class="kv"><dt>Dikonfigurasi</dt><dd>${st.configured ? 'Ya' : '<span class="badge red">Belum (AI_API_KEY / AI_MODEL belum diset)</span>'}</dd><dt>Penyedia</dt><dd>${h(st.provider || '–')}</dd><dt>Model</dt><dd>${h(st.model || '–')}</dd><dt>Pesan Anda 24 jam</dt><dd>${st.usedLast24h}/${st.dailyLimit}</dd></dl>`}
      <p class="muted small mt">Kunci API hanya ada di environment variable server dan tidak pernah dikirim ke browser. Kuota gratis dapat berubah; gunakan uji koneksi untuk memeriksa.</p><button class="btn secondary" id="ping">${icon('activity')} Uji koneksi & kuota</button><div id="pr" class="mt"></div></div></div>`;
    el.querySelectorAll('[data-k]').forEach((c) => c.addEventListener('change', async () => { try { await rpc('admin_update_setting', { p_key: c.dataset.k, p_value: c.checked }); toast('Pengaturan disimpan.'); } catch (e) { c.checked = !c.checked; toastError(e); } }));
    const num = (form, key, lo, hi) => form.addEventListener('submit', async (e) => { e.preventDefault(); setErrors(form); const v = Number(form[key].value);
      if (form[key].value === '' || !Number.isInteger(v) || v < lo || v > hi) return setErrors(form, { [key]: `Isi bilangan bulat ${lo}–${hi}.` });
      await withLoading($('button', form), async () => { try { await rpc('admin_update_setting', { p_key: key, p_value: v }); toast('Disimpan.'); } catch (err) { toastError(err); } }); });
    num($('#af', el), 'ai_daily_limit', 0, 500);
    const gf = $('#gf', el); gf.addEventListener('submit', async (e) => { e.preventDefault(); setErrors(gf); const n = gf.app_name.value.trim(), r = Number(gf.prediction_rate_per_minute.value); const errs = {};
      if (!n || n.length > 60) errs.app_name = 'Nama 1–60 karakter.'; if (!Number.isInteger(r) || r < 1 || r > 120) errs.prediction_rate_per_minute = 'Isi bilangan bulat 1–120.'; if (Object.keys(errs).length) return setErrors(gf, errs);
      await withLoading($('button', gf), async () => { try { await rpc('admin_update_setting', { p_key: 'app_name', p_value: n }); await rpc('admin_update_setting', { p_key: 'prediction_rate_per_minute', p_value: r }); toast('Disimpan.'); } catch (err) { toastError(err); } }); });
    $('#ping', el).addEventListener('click', (e) => withLoading(e.currentTarget, async () => { const o = $('#pr', el); try { const r = await ai.ping(); o.innerHTML = `<div class="alert ok">Koneksi berhasil: ${h(r.provider)} / ${h(r.model)} (${r.latencyMs} ms).</div>`; } catch (err) { o.innerHTML = `<div class="alert err">${h(err.message)}</div>`; } }));
    refreshIcons();
  });
});
