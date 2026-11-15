import { boot, pageHead, $, $$, h, icon, setErrors, withLoading, toast, toastError, url, refreshIcons } from '../ui.js';
import { FIELDS, validate, predict } from '../../../services/prediction.js';
import { ApiError } from '../../../services/supabase.js';

boot({ role: 'user', nav: 'prediction', title: 'Pemeriksaan baru', crumbs: [['Pemeriksaan']] }, (main) => {
  main.innerHTML = pageHead('Pemeriksaan kondisi tanah & iklim', 'Isi ketujuh parameter, lalu sistem akan merekomendasikan tanaman yang paling sesuai.') +
  `<div class="alert info">${icon('info')}<div>Semua kolom wajib diisi. Gunakan titik atau koma untuk desimal. Validasi diulang di server.</div></div>
  <div id="serr" class="alert err" hidden role="alert"></div>
  <form id="f" class="card" novalidate><div class="grid cols-2">${FIELDS.map((f) => `<div class="field"><label for="f-${f.key}">${icon(f.icon)} ${h(f.label)} ${f.unit ? `<span class="unit">(${h(f.unit)})</span>` : ''}</label>
    <input id="f-${f.key}" name="${f.key}" type="text" inputmode="decimal" autocomplete="off" placeholder="mis. ${h(f.ph)}" required aria-describedby="h-${f.key}"><span class="hint" id="h-${f.key}">${h(f.hint)}</span><span class="error" role="alert"></span></div>`).join('')}</div>
  <div class="actions mt"><button class="btn" type="submit">${icon('sprout')} Periksa dan Rekomendasikan Tanaman</button><button class="btn ghost" type="reset" id="rst">${icon('rotate-ccw')} Reset</button></div></form>`;
  refreshIcons();
  const f = $('#f'), se = $('#serr');
  f.addEventListener('reset', () => { setErrors(f); se.hidden = true; });
  $$('input', f).forEach((i) => i.addEventListener('blur', () => { const v = validate(Object.fromEntries(new FormData(f))); const k = i.name; const fld = i.closest('.field'); if (i.value.trim() === '') return; fld.classList.toggle('invalid', !!v.errors[k]); $('.error', fld).textContent = v.errors[k] || ''; }));
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); se.hidden = true; setErrors(f);
    const v = validate(Object.fromEntries(new FormData(f)));
    if (!v.ok) { setErrors(f, v.errors); toast('Periksa kembali isian yang ditandai.', 'warn'); return; }
    await withLoading($('button[type=submit]', f), async () => {
      try { const r = await predict(v.clean); location.assign(url(`user/result.html?id=${encodeURIComponent(r.examination.id)}`)); }
      catch (err) {
        if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) setErrors(f, Object.fromEntries(Object.entries(err.fields).map(([k, m]) => [k, String(m)])));
        se.hidden = false; se.textContent = err instanceof ApiError ? err.message : 'Terjadi kesalahan tak terduga.'; se.scrollIntoView({ block: 'nearest' });
      }
    });
  });
});
