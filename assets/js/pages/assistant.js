// Asisten AI: chat lewat /.netlify/functions/ai-chat. Konteks pemeriksaan hanya dikirim bila pengguna mencentang izin.
import { boot, pageHead, $, h, icon, toast, toastError, confirmBox, fmtDate, refreshIcons, errMsg, url } from '../ui.js';
import * as ai from '../../../services/ai.js';
import { from } from '../../../services/supabase.js';
import { cropName } from '../crops.js';

// Render Markdown sederhana yang AMAN: escape dulu, baru ubah **tebal**, daftar, dan paragraf. Tidak ada HTML mentah dari model.
function md(t) {
  const e = h(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = []; let list = null;
  for (const line of e.split(/\n/)) {
    const li = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) { const tag = /^\s*\d/.test(line) ? 'ol' : 'ul'; if (!list || list.tag !== tag) { if (list) out.push(`</${list.tag}>`); out.push(`<${tag}>`); list = { tag }; } out.push(`<li>${li[1]}</li>`); }
    else { if (list) { out.push(`</${list.tag}>`); list = null; } if (line.trim()) out.push(`<p>${line}</p>`); }
  }
  if (list) out.push(`</${list.tag}>`); return out.join('');
}
boot({ role: undefined, nav: 'ai', title: 'Asisten AI' }, async (main, user) => {
  const qs = new URLSearchParams(location.search); let examId = /^[0-9a-f-]{36}$/i.test(qs.get('exam') || '') ? qs.get('exam') : null;
  main.innerHTML = pageHead('Asisten AI pertanian', 'Tanya jawab seputar tanah, iklim, dan cara memahami hasil rekomendasi.') +
  `<div class="alert warn" role="note">${icon('shield')}<div><b>Privasi &amp; batasan.</b> Pesan Anda diproses oleh layanan AI pihak ketiga (penyedia model bahasa). Jangan kirim data pribadi. Jawaban AI adalah saran umum, <b>terpisah dari hasil model Machine Learning</b>, bisa keliru, dan tidak menggantikan penyuluh pertanian.</div></div><div id="st"></div>
  <div class="chat"><aside class="card chat-list"><button class="btn" id="new">${icon('plus')} Percakapan baru</button><div class="items" id="convs"></div></aside>
  <section class="card chat-main"><div class="msgs" id="msgs" aria-live="polite"></div>
  <form class="composer" id="cf"><div id="ctx" style="width:100%"></div><textarea id="in" rows="1" maxlength="2000" placeholder="Tulis pertanyaan Anda…" aria-label="Pesan"></textarea><button class="btn" id="send" type="submit">${icon('send')} Kirim</button><span class="small muted" style="width:100%"><span id="cnt">0</span>/2000 · Enter kirim, Shift+Enter baris baru</span></form></section></div>`;
  refreshIcons();
  let cid = null; let busy = false; let info = null;
  const msgs = $('#msgs'), inp = $('#in'), send = $('#send');
  const bubble = (role, html) => { const d = document.createElement('div'); d.className = `msg ${role}`; d.innerHTML = `<div class="who">${role === 'user' ? 'Anda' : 'Asisten AI'}</div>${html}`; msgs.append(d); msgs.scrollTop = msgs.scrollHeight; return d; };
  const welcome = () => { msgs.innerHTML = ''; bubble('assistant', '<p>Halo! Saya asisten pertanian. Tanyakan tentang kadar N, P, K, pH, suhu, kelembapan, curah hujan, atau cara memahami hasil rekomendasi tanaman Anda.</p><p class="small muted">Saran saya bersifat umum dan terpisah dari hasil model Machine Learning.</p>'); };
  async function status() {
    try { info = await ai.status(); } catch (e) { $('#st').innerHTML = `<div class="alert err">${h(errMsg(e))}</div>`; return; }
    let m = ''; if (!info.enabled) m = 'Asisten AI sedang dinonaktifkan oleh administrator.'; else if (!info.configured) m = 'Asisten AI belum dikonfigurasi di server (kunci API belum diatur). Hubungi administrator.';
    $('#st').innerHTML = m ? `<div class="alert err">${h(m)}</div>` : `<p class="small muted">Pesan terpakai 24 jam terakhir: ${info.usedLast24h}/${info.dailyLimit}</p>`;
    const off = !info.enabled || !info.configured; inp.disabled = off; send.disabled = off;
  }
  async function convs() {
    const box = $('#convs');
    try { const list = await ai.conversations(); box.innerHTML = list.length ? list.map((c) => `<div class="conv ${c.id === cid ? 'active' : ''}" data-id="${h(c.id)}" tabindex="0" role="button" aria-label="Buka ${h(c.title)}"><span class="t">${h(c.title)}</span><button class="icon-btn" data-del="${h(c.id)}" aria-label="Hapus percakapan" style="width:30px;height:30px">${icon('trash-2')}</button></div>`).join('') : '<p class="muted small center">Belum ada percakapan.</p>'; }
    catch (e) { box.innerHTML = `<p class="small" style="color:var(--red)">${h(errMsg(e))}</p>`; }
    box.querySelectorAll('.conv').forEach((c) => { const open = (ev) => { if (ev.target.closest('[data-del]')) return; openConv(c.dataset.id); }; c.addEventListener('click', open); c.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(e); }); });
    box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { if (!(await confirmBox({ title: 'Hapus percakapan?', text: 'Seluruh pesan dalam percakapan ini akan dihapus permanen.', confirm: 'Hapus', danger: true }))) return; try { await ai.removeConversation(b.dataset.del); if (cid === b.dataset.del) { cid = null; welcome(); } toast('Percakapan dihapus.'); convs(); } catch (e) { toastError(e); } }));
    refreshIcons();
  }
  async function openConv(id) {
    cid = id; msgs.innerHTML = '<div class="skel"></div><div class="skel s"></div>';
    try { const m = await ai.messages(id); msgs.innerHTML = ''; m.forEach((x) => bubble(x.role, x.role === 'user' ? `<p>${h(x.content).replace(/\n/g, '<br>')}</p>` : md(x.content))); }
    catch (e) { msgs.innerHTML = `<div class="alert err">${h(errMsg(e))}</div>`; } convs();
  }
  async function ctxBox() {
    const box = $('#ctx'); if (!examId) { box.innerHTML = ''; return; }
    try { const { data } = await from('examinations').select('id,predicted_crop,created_at').eq('id', examId).run(); const e = data[0];
      if (!e) { examId = null; box.innerHTML = ''; return; }
      box.innerHTML = `<label class="checks small"><input type="checkbox" id="usectx" checked> <span>Izinkan AI memakai data pemeriksaan ${fmtDate(e.created_at)} (${h(cropName(e.predicted_crop))}: nilai N, P, K, suhu, kelembapan, pH, curah hujan dan hasil model). Tidak ada data pribadi yang dikirim.</span></label>`;
    } catch { examId = null; box.innerHTML = ''; }
  }
  $('#new').addEventListener('click', () => { cid = null; welcome(); convs(); inp.focus(); });
  inp.addEventListener('input', () => { $('#cnt').textContent = inp.value.length; inp.style.height = 'auto'; inp.style.height = Math.min(140, inp.scrollHeight) + 'px'; });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#cf').requestSubmit(); } });
  $('#cf').addEventListener('submit', async (e) => {
    e.preventDefault(); if (busy) return; const text = inp.value.trim(); if (!text) return toast('Tulis pesan terlebih dahulu.', 'warn');
    busy = true; send.classList.add('loading'); bubble('user', `<p>${h(text).replace(/\n/g, '<br>')}</p>`); inp.value = ''; inp.style.height = 'auto'; $('#cnt').textContent = '0';
    const wait = bubble('assistant', '<span class="typing" aria-label="AI sedang mengetik"><span></span><span></span><span></span></span>');
    try {
      const useCtx = examId && $('#usectx')?.checked; const r = await ai.send(text, { conversation_id: cid, ...(useCtx ? { exam_id: examId } : {}) });
      cid = r.conversation_id; wait.innerHTML = `<div class="who">Asisten AI</div>${md(r.reply)}`; if (info) { info.usedLast24h = r.usedLast24h; $('#st').innerHTML = `<p class="small muted">Pesan terpakai 24 jam terakhir: ${r.usedLast24h}/${r.dailyLimit}</p>`; } convs();
    } catch (err) { wait.className = 'msg assistant'; wait.innerHTML = `<div class="who">Sistem</div><div class="alert err" style="margin:0">${h(errMsg(err))}</div>`; inp.value = text; }
    finally { busy = false; send.classList.remove('loading'); msgs.scrollTop = msgs.scrollHeight; inp.focus(); }
  });
  welcome(); await status(); await convs(); await ctxBox();
});
