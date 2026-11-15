// Tabel pemeriksaan untuk admin: search, filter, sort, pagination, detail, hapus. Dipakai dashboard & halaman Pemeriksaan.
import { $, h, icon, fmtDate, fmtNum, renderPager, loadInto, modal, confirmBox, toast, toastError, debounce, refreshIcons, emptyState, downloadCsv } from '../ui.js';
import { from } from '../../../services/supabase.js';
import { cropOptions, cropBadge, matchCrops, dayStart, dayEnd, examDetail, FEATS } from './_exam.js';
import { cropName } from '../crops.js';

export function recentExamTable(host, { title = 'Pemeriksaan', size = 10, full = false } = {}) {
  const st = { page: 1, size, q: '', crop: '', from: '', to: '', sort: 'created_at', asc: false };
  host.innerHTML = `<div class="card flush"><div style="padding:1rem 1rem 0"><h2>${h(title)}</h2><div class="filters"><div class="field grow"><label for="eq">Cari (tanaman)</label><input id="eq" type="search" maxlength="40" placeholder="mis. padi"></div>
  <div class="field"><label for="ec">Tanaman</label><select id="ec">${cropOptions()}</select></div>${full ? '<div class="field"><label for="edf">Dari</label><input id="edf" type="date"></div><div class="field"><label for="edt">Sampai</label><input id="edt" type="date"></div>' : ''}
  ${full ? `<button class="btn secondary" id="ecsv">${icon('download')} CSV</button>` : ''}</div></div><div id="et"></div><div id="ep"></div></div>`;
  const SORT = { created_at: 'Tanggal', predicted_crop: 'Rekomendasi' };
  const query = () => { let q = from('examinations').select('*,profiles(email,full_name),model_versions(version,algorithm)').count(); const m = matchCrops(st.q);
    if (m) q = q.or(`predicted_crop.in.(${m.join(',') || '-'})`); if (st.crop) q = q.eq('predicted_crop', st.crop); if (st.from) q = q.gte('created_at', dayStart(st.from)); if (st.to) q = q.lt('created_at', dayEnd(st.to)); return q.order(st.sort, st.asc); };
  const load = () => loadInto($('#et', host), async (el) => {
    const { data, count } = await query().range((st.page - 1) * st.size, st.page * st.size - 1).run();
    if (!count) { el.innerHTML = emptyState('Belum ada pemeriksaan', 'Tidak ada data yang cocok.'); $('#ep', host).innerHTML = ''; refreshIcons(); return; }
    const th = (k, l) => `<th class="sortable" data-s="${k}" tabindex="0" aria-sort="${st.sort === k ? (st.asc ? 'ascending' : 'descending') : 'none'}">${l}${st.sort === k ? `<span class="arr">${st.asc ? '▲' : '▼'}</span>` : ''}</th>`;
    el.innerHTML = `<div class="table-wrap"><table class="stack-table"><thead><tr>${th('created_at', 'Tanggal')}<th>Pengguna</th>${FEATS.map(([, s]) => `<th class="num">${h(s)}</th>`).join('')}${th('predicted_crop', 'Rekomendasi')}<th>Aksi</th></tr></thead><tbody>${data.map((e) => `<tr><td data-l="Tanggal" class="nowrap">${fmtDate(e.created_at)}</td><td data-l="Pengguna">${h(e.profiles?.full_name || e.profiles?.email || '(dihapus)')}</td>${FEATS.map(([k, s]) => `<td class="num" data-l="${h(s)}">${fmtNum(e[k], 1)}</td>`).join('')}<td data-l="Rekomendasi">${cropBadge(e.predicted_crop)}</td><td data-l="Aksi" class="nowrap"><button class="btn sm secondary" data-d="${h(e.id)}">Detail</button>${full ? ` <button class="btn sm ghost" data-x="${h(e.id)}" aria-label="Hapus">${icon('trash-2')}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
    el.querySelectorAll('th[data-s]').forEach((t) => { const go = () => { if (st.sort === t.dataset.s) st.asc = !st.asc; else { st.sort = t.dataset.s; st.asc = false; } st.page = 1; load(); }; t.addEventListener('click', go); t.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }); });
    el.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => modal({ title: 'Detail pemeriksaan', size: 'lg', body: examDetail(data.find((x) => x.id === b.dataset.d), { showUser: true }) })));
    el.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', async () => { if (!(await confirmBox({ title: 'Hapus pemeriksaan?', text: 'Tindakan ini tercatat di audit log dan tidak dapat dibatalkan.', confirm: 'Hapus', danger: true }))) return; try { await from('examinations').eq('id', b.dataset.x).remove().run(); toast('Pemeriksaan dihapus.'); load(); } catch (e) { toastError(e); } }));
    renderPager($('#ep', host), { page: st.page, size: st.size, total: count, onPage: (p) => { st.page = p; load(); } }); refreshIcons();
  });
  const on = (id, k) => $(id, host)?.addEventListener('change', (e) => { st[k] = e.target.value; st.page = 1; load(); });
  $('#eq', host).addEventListener('input', debounce((e) => { st.q = e.target.value; st.page = 1; load(); })); on('#ec', 'crop'); on('#edf', 'from'); on('#edt', 'to');
  $('#ecsv', host)?.addEventListener('click', async (ev) => {
    const b = ev.currentTarget; b.classList.add('loading');
    try { const rows = []; for (let off = 0; off < 5000; off += 500) { const { data } = await query().range(off, off + 499).run(); rows.push(...data); if (data.length < 500) break; }
      downloadCsv('pemeriksaan.csv', ['Tanggal', 'Email', 'Nama', ...FEATS.map((f) => f[2]), 'Rekomendasi', 'Versi model'], rows.map((e) => [e.created_at, e.profiles?.email || '', e.profiles?.full_name || '', ...FEATS.map(([k]) => e[k]), cropName(e.predicted_crop), e.model_versions?.version || '']));
      toast(`${rows.length} baris diekspor.`); } catch (e) { toastError(e); } finally { b.classList.remove('loading'); } });
  return load();
}
