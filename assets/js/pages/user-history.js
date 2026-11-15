import { boot, pageHead, $, h, icon, fmtDate, fmtNum, renderPager, loadInto, modal, confirmBox, toast, toastError, debounce, url, refreshIcons, emptyState } from '../ui.js';
import { from } from '../../../services/supabase.js';
import { cropOptions, cropBadge, matchCrops, dayStart, dayEnd, examDetail } from './_exam.js';

boot({ role: 'user', nav: 'history', title: 'Riwayat', crumbs: [['Pemeriksaan']] }, async (main) => {
  const st = { page: 1, size: 10, q: '', crop: '', from: '', to: '', asc: false };
  main.innerHTML = pageHead('Riwayat pemeriksaan', 'Seluruh pemeriksaan milik Anda.', `<a class="btn" href="${url('user/prediction.html')}">${icon('plus')} Pemeriksaan baru</a>`) +
  `<div class="card flush"><div style="padding:1rem 1rem 0"><div class="filters"><div class="field grow"><label for="q">Cari tanaman</label><input id="q" type="search" placeholder="mis. padi atau rice" maxlength="40"></div>
  <div class="field"><label for="crop">Tanaman</label><select id="crop">${cropOptions()}</select></div><div class="field"><label for="df">Dari tanggal</label><input id="df" type="date"></div><div class="field"><label for="dt">Sampai tanggal</label><input id="dt" type="date"></div>
  <button class="btn ghost" id="clr">Hapus filter</button></div></div><div id="tbl"></div><div id="pg"></div></div>`;
  const load = () => loadInto($('#tbl'), async (el) => {
    let qy = from('examinations').select('*,model_versions(version,algorithm)').count();
    const m = matchCrops(st.q);
    if (m) { if (!m.length) { el.innerHTML = emptyState('Tidak ada hasil', 'Tidak ada tanaman yang cocok dengan pencarian.'); $('#pg').innerHTML = ''; return; } qy = qy.or(`predicted_crop.in.(${m.join(',')})`); }
    if (st.crop) qy = qy.eq('predicted_crop', st.crop);
    if (st.from) qy = qy.gte('created_at', dayStart(st.from));
    if (st.to) qy = qy.lt('created_at', dayEnd(st.to));
    const { data, count } = await qy.order('created_at', st.asc).range((st.page - 1) * st.size, st.page * st.size - 1).run();
    if (!data.length && st.page > 1 && count) { st.page = Math.ceil(count / st.size); return load(); }
    if (!count) { el.innerHTML = emptyState('Belum ada pemeriksaan', st.q || st.crop || st.from || st.to ? 'Tidak ada data yang cocok dengan filter.' : 'Mulai pemeriksaan pertama Anda.', st.q || st.crop || st.from || st.to ? '' : `<a class="btn" href="${url('user/prediction.html')}">Mulai pemeriksaan</a>`); $('#pg').innerHTML = ''; refreshIcons(); return; }
    el.innerHTML = `<div class="table-wrap"><table class="stack-table"><thead><tr><th class="num">No</th><th class="sortable" id="sd" tabindex="0" aria-sort="${st.asc ? 'ascending' : 'descending'}">Tanggal<span class="arr">${st.asc ? '▲' : '▼'}</span></th><th class="num">N</th><th class="num">P</th><th class="num">K</th><th class="num">Suhu</th><th class="num">Lembap</th><th class="num">pH</th><th class="num">Hujan</th><th>Rekomendasi</th><th>Aksi</th></tr></thead><tbody>${data.map((e, i) => `<tr><td class="num" data-l="No">${(st.page - 1) * st.size + i + 1}</td><td data-l="Tanggal" class="nowrap">${fmtDate(e.created_at)}</td><td class="num" data-l="N">${fmtNum(e.nitrogen, 1)}</td><td class="num" data-l="P">${fmtNum(e.phosphorus, 1)}</td><td class="num" data-l="K">${fmtNum(e.potassium, 1)}</td><td class="num" data-l="Suhu">${fmtNum(e.temperature, 1)}</td><td class="num" data-l="Lembap">${fmtNum(e.humidity, 1)}</td><td class="num" data-l="pH">${fmtNum(e.ph, 2)}</td><td class="num" data-l="Hujan">${fmtNum(e.rainfall, 1)}</td><td data-l="Rekomendasi">${cropBadge(e.predicted_crop)}</td>
    <td data-l="Aksi" class="nowrap"><button class="btn sm secondary" data-d="${h(e.id)}">Detail</button> <a class="btn sm ghost" href="${url('user/result.html?id=' + e.id + '&print=1')}">PDF</a> <button class="btn sm ghost" data-x="${h(e.id)}" aria-label="Hapus pemeriksaan">${icon('trash-2')}</button></td></tr>`).join('')}</tbody></table></div>`;
    el._rows = data; renderPager($('#pg'), { page: st.page, size: st.size, total: count, onPage: (p) => { st.page = p; load(); } });
    $('#sd').addEventListener('click', () => { st.asc = !st.asc; st.page = 1; load(); });
    el.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => modal({ title: 'Detail pemeriksaan', size: 'lg', body: examDetail(data.find((x) => x.id === b.dataset.d)), buttons: [{ label: 'Tutup', cls: 'ghost' }, { label: 'Buka halaman hasil', onClick: () => { location.assign(url('user/result.html?id=' + b.dataset.d)); return false; } }] })));
    el.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', async () => { if (!(await confirmBox({ title: 'Hapus pemeriksaan ini?', text: 'Data yang dihapus tidak dapat dikembalikan.', confirm: 'Hapus', danger: true }))) return; try { await from('examinations').eq('id', b.dataset.x).remove().run(); toast('Pemeriksaan dihapus.'); load(); } catch (e) { toastError(e); } }));
    refreshIcons();
  });
  const set = (k) => (e) => { st[k] = e.target.value; st.page = 1; load(); };
  $('#q').addEventListener('input', debounce((e) => { st.q = e.target.value; st.page = 1; load(); })); $('#crop').addEventListener('change', set('crop')); $('#df').addEventListener('change', set('from')); $('#dt').addEventListener('change', set('to'));
  $('#clr').addEventListener('click', () => { Object.assign(st, { q: '', crop: '', from: '', to: '', page: 1 }); ['q', 'crop', 'df', 'dt'].forEach((i) => { $('#' + i).value = ''; }); load(); });
  load();
});
