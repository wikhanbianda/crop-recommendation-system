// Supabase PALSU untuk pengujian fungsi & e2e (GoTrue + PostgREST + RPC + Storage, subset yang dipakai aplikasi).
// PENTING: ini emulasi untuk menguji kode aplikasi. Kebenaran RLS/SQL yang sesungguhnya diuji terpisah pada PostgreSQL asli
// (tests/test_db_rls.py). Supabase sungguhan (Auth/PostgREST/Storage) TIDAK diuji di sini.
import http from 'node:http';
import crypto from 'node:crypto';

export const ANON = 'fake-anon-key-aaaaaaaaaaaaaaaaaaaaaaaa';
export const SERVICE = 'fake-service-role-key-bbbbbbbbbbbbbbbbbb';
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

export function createFake() {
  const st = {
    users: [],          // {id,email,password,banned,last_sign_in_at,meta}
    refresh: new Map(), // refresh_token -> {uid}
    tables: { profiles: [], examinations: [], datasets: [], model_versions: [], audit_logs: [], application_settings: [], ai_conversations: [], ai_messages: [] },
    storage: new Map(), recovers: [], seq: 1, requests: [],
  };
  const T = st.tables;
  const audit = (uid, email, action, description, status = 'success', details = {}, ip = null) =>
    T.audit_logs.push({ id: st.seq++, user_id: uid, actor_email: email, action, description, status, ip_address: ip, details, created_at: now() });

  function addUser({ email, password, full_name = '', role = 'user', status = 'active' }) {
    const id = uuid(); st.users.push({ id, email: email.toLowerCase(), password, banned: status === 'inactive', last_sign_in_at: null });
    T.profiles.push({ id, email: email.toLowerCase(), full_name, role, status, created_at: now(), updated_at: now() });   // = trigger handle_new_user (role selalu 'user' kecuali seed uji)
    return id;
  }
  // seed seperti database/seed.sql
  const ds = { id: uuid(), dataset_name: 'Crop_recommendation.csv', file_path: 'datasets/v1.0.0/Crop_recommendation.csv', sha256: 'a'.repeat(64), total_rows: 2200, total_features: 7, total_classes: 22, version: 'v1.0.0', status: 'active', validation_report: {}, uploaded_by: null, created_at: now() };
  T.datasets.push(ds);
  const mv = { id: uuid(), model_name: 'Naive Bayes v1.0.0', algorithm: 'Naive Bayes', version: 'v1.0.0', accuracy: 0.995455, precision: 0.995868, recall: 0.995455, f1_score: 0.995443, n_train: 1760, n_test: 440, total_classes: 22, supports_proba: true, training_date: now(), dataset_id: ds.id, artifact_path: 'v1.0.0', status: 'active', comparison: [], approved_by: null, approved_at: now(), created_at: now() };
  T.model_versions.push(mv);
  for (const [k, v] of Object.entries({ app_name: 'Crop Recommendation System', registration_enabled: false, ai_enabled: true, ai_daily_limit: 30, prediction_rate_per_minute: 20, maintenance_mode: false, timezone: 'Asia/Jayapura' }))
    T.application_settings.push({ id: uuid(), setting_key: k, setting_value: v, updated_by: null, updated_at: now() });

  // ---------- auth helpers ----------
  const mkTokens = (u) => {
    const rt = 'rt_' + crypto.randomBytes(16).toString('hex'); st.refresh.set(rt, u.id);
    const exp = Math.floor(Date.now() / 1000) + 3600;
    return { access_token: 'fk.' + b64({ sub: u.id, exp }) + '.sig', refresh_token: rt, expires_in: 3600, expires_at: exp, token_type: 'bearer', user: { id: u.id, email: u.email } };
  };
  const readToken = (tok) => { try { const p = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()); return p.exp * 1000 > Date.now() ? p.sub : null; } catch { return null; } };
  function who(req) {
    const a = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (a === SERVICE) return { role: 'service' };
    if (a.startsWith('fk.')) { const id = readToken(a); const u = st.users.find((x) => x.id === id); if (u && !u.banned) return { role: 'authenticated', uid: id }; return { role: 'invalid' }; }
    return { role: 'anon' };
  }
  const prof = (uid) => T.profiles.find((p) => p.id === uid);
  const isActive = (uid) => prof(uid)?.status === 'active';
  const isAdmin = (uid) => prof(uid)?.role === 'admin' && prof(uid)?.status === 'active';

  // ---------- PostgREST subset ----------
  const FK = { examinations: { profiles: 'user_id', model_versions: 'model_version_id' }, datasets: { profiles: 'uploaded_by' }, model_versions: { datasets: 'dataset_id' }, ai_messages: { ai_conversations: 'conversation_id' } };
  function splitTop(s) { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; }
  const cmp = (a, b) => { if (a == null || b == null) return NaN; const na = Number(a), nb = Number(b); if (typeof a !== 'string' || (!isNaN(na) && !isNaN(nb) && /^-?[\d.]+$/.test(String(b)))) return na - nb; return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0; };
  function test(row, col, spec) {
    const dot = spec.indexOf('.'); let op = spec.slice(0, dot), val = spec.slice(dot + 1); let neg = false;
    if (op === 'not') { neg = true; const d2 = val.indexOf('.'); op = val.slice(0, d2); val = val.slice(d2 + 1); }
    const v = row[col]; let r;
    switch (op) {
      case 'eq': r = String(v) === val || (v != null && typeof v !== 'object' && cmp(v, val) === 0 && !isNaN(Number(val)) && typeof v === 'number'); break;
      case 'neq': r = String(v) !== val; break;
      case 'gt': r = cmp(v, val) > 0; break; case 'gte': r = cmp(v, val) >= 0; break;
      case 'lt': r = cmp(v, val) < 0; break; case 'lte': r = cmp(v, val) <= 0; break;
      case 'ilike': r = new RegExp('^' + val.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i').test(String(v ?? '')); break;
      case 'in': r = splitTop(val.replace(/^\(|\)$/g, '')).map((x) => x.replace(/^"|"$/g, '')).includes(String(v)); break;
      case 'is': r = val === 'null' ? v == null : String(v) === val; break;
      default: throw Object.assign(new Error('operator tidak didukung: ' + op), { status: 400 });
    }
    return neg ? !r : r;
  }
  function filterRows(rows, q) {
    let out = rows;
    for (const [k, v] of q.entries()) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      if (k === 'or') { const parts = splitTop(v.replace(/^\(|\)$/g, '')).map((p) => { const i = p.indexOf('.'); return [p.slice(0, i), p.slice(i + 1)]; }); out = out.filter((r) => parts.some(([c, s]) => test(r, c, s))); continue; }
      out = out.filter((r) => test(r, k, v));
    }
    const ord = q.get('order');
    if (ord) { const specs = ord.split(',').map((s) => s.split('.')); out = [...out].sort((a, b) => { for (const [c, d] of specs) { const x = cmp(a[c], b[c]); if (x) return d === 'desc' ? -x : x; } return 0; }); }
    return out;
  }
  function project(table, row, select) {
    if (!select || select === '*') return { ...row };
    const out = {};
    for (const part of splitTop(select)) {
      if (part === '*') { Object.assign(out, row); continue; }
      const m = /^(?:(\w+):)?(\w+)(?:\(([^)]*)\))?$/.exec(part.trim()); if (!m) continue;
      const [, alias, name, sub] = m;
      if (sub === undefined) { out[alias || name] = row[name]; continue; }
      const col = FK[table]?.[name] || (alias && FK[table]?.[name]);
      let target = name, fkcol = FK[table]?.[name];
      if (!fkcol && alias) { target = name; fkcol = FK[table]?.[name]; }
      if (!fkcol) { for (const [t, c] of Object.entries(FK[table] || {})) if (c === name) { target = t; fkcol = c; } }   // alias:coluna(...)
      const rel = (T[target] || []).find((r) => r.id === row[fkcol]);
      out[alias || name] = rel ? project(target, rel, sub || '*') : null;
    }
    return out;
  }
  const denied = () => Object.assign(new Error('permission denied'), { status: 403, code: '42501' });
  function canRead(table, w, row) {
    if (w.role === 'service') return true; if (w.role !== 'authenticated') return false;
    const u = w.uid;
    switch (table) {
      case 'profiles': return (row.id === u && isActive(u)) || isAdmin(u);
      case 'examinations': return (row.user_id === u && isActive(u)) || isAdmin(u);
      case 'datasets': case 'audit_logs': return isAdmin(u);
      case 'model_versions': case 'application_settings': return isActive(u);
      case 'ai_conversations': return row.user_id === u && isActive(u);
      case 'ai_messages': return T.ai_conversations.some((c) => c.id === row.conversation_id && c.user_id === u) && isActive(u);
    }
    return false;
  }
  function crud(table, req, url, body, w) {
    if (!T[table]) throw Object.assign(new Error('relation does not exist'), { status: 404 });
    const q = url.searchParams; const m = req.method;
    if (w.role === 'anon' || w.role === 'invalid') throw denied();
    if (m === 'GET' || m === 'HEAD') {
      let rows = filterRows(T[table].filter((r) => canRead(table, w, r)), q); const total = rows.length;
      const range = req.headers.range; let from = 0, to = rows.length - 1;
      const lim = q.get('limit'); if (lim) { from = Number(q.get('offset') || 0); to = from + Number(lim) - 1; }
      if (range && /^\d+-\d+$/.test(range)) [from, to] = range.split('-').map(Number);
      rows = rows.slice(from, to + 1).map((r) => project(table, r, q.get('select')));
      return { status: 200, body: rows, headers: { 'content-range': `${rows.length ? from + '-' + (from + rows.length - 1) : '*'}/${total}` } };
    }
    if (m === 'POST') {
      if (w.role !== 'service') throw denied();   // pengguna tidak punya INSERT langsung ke tabel mana pun
      const arr = Array.isArray(body) ? body : [body]; const made = [];
      for (const b of arr) {
        const row = { id: uuid(), created_at: now(), ...b };
        if (table === 'profiles' || table === 'audit_logs') throw denied();
        if (table === 'model_versions') { row.status ||= 'candidate'; row.comparison ||= []; if (T.model_versions.some((x) => x.version === row.version)) throw Object.assign(new Error('duplicate key'), { status: 409, code: '23505' }); }
        if (table === 'datasets') { if (T.datasets.some((x) => x.version === row.version)) throw Object.assign(new Error('duplicate key'), { status: 409, code: '23505' }); }
        if (table === 'examinations') { for (const [c, lo, hi] of [['nitrogen', 0, 200], ['phosphorus', 0, 200], ['potassium', 0, 300], ['temperature', 0, 50], ['humidity', 0, 100], ['ph', 0, 14], ['rainfall', 0, 500]]) if (!(row[c] >= lo && row[c] <= hi)) throw Object.assign(new Error('check constraint'), { status: 400, code: '23514' }); }
        if (table === 'ai_conversations') row.updated_at = now();
        T[table].push(row); made.push(row);
      }
      return { status: 201, body: req.headers.prefer?.includes('return=representation') ? made : null };
    }
    if (m === 'PATCH') {
      const rows = filterRows(T[table], q).filter((r) => canRead(table, w, r)); if (w.role !== 'service' && !(table === 'profiles')) throw denied();
      if (w.role !== 'service' && table === 'profiles') { if (Object.keys(body).some((k) => k !== 'full_name')) throw denied(); if (rows.some((r) => r.id !== w.uid)) throw denied(); }
      rows.forEach((r) => Object.assign(r, body, table === 'profiles' ? { updated_at: now() } : {}));
      return { status: 200, body: req.headers.prefer?.includes('return=representation') ? rows : null };
    }
    if (m === 'DELETE') {
      if (!['examinations', 'ai_conversations'].includes(table) && w.role !== 'service') throw denied();
      const rows = filterRows(T[table], q).filter((r) => canRead(table, w, r));
      for (const r of rows) {
        T[table].splice(T[table].indexOf(r), 1);
        if (table === 'ai_conversations') T.ai_messages = T.ai_messages.filter((x) => x.conversation_id !== r.id);
        if (table === 'examinations') audit(w.uid, prof(w.uid)?.email, 'examination.delete', 'Pemeriksaan dihapus', 'success', { examination_id: r.id, owner: r.user_id });
      }
      st.tables.ai_messages = T.ai_messages; return { status: 200, body: null };
    }
    throw Object.assign(new Error('metode tidak didukung'), { status: 405 });
  }

  // ---------- RPC ----------
  function rpc(name, a, w) {
    const U = w.uid; const E = () => prof(U)?.email;
    const needAdmin = () => { if (w.role !== 'authenticated' || !isAdmin(U)) throw denied(); };
    if (name === 'write_audit') { if (w.role !== 'service') throw denied(); audit(a.p_user, a.p_email, a.p_action, a.p_desc, a.p_status, a.p_details, a.p_ip); return null; }
    if (w.role !== 'authenticated') throw denied();
    switch (name) {
      case 'admin_set_role': { needAdmin(); const p = prof(a.target); if (!p) throw Object.assign(new Error('Pengguna tidak ditemukan'), { status: 400, code: 'P0002' }); if (!['admin', 'user'].includes(a.new_role)) throw Object.assign(new Error('Role tidak valid'), { status: 400 });
        if (p.role === 'admin' && a.new_role !== 'admin' && T.profiles.filter((x) => x.role === 'admin' && x.status === 'active' && x.id !== p.id).length === 0) throw Object.assign(new Error('Tidak bisa menghapus/menurunkan/menonaktifkan admin aktif terakhir'), { status: 400, code: '23514' });
        const from = p.role; p.role = a.new_role; audit(U, E(), 'user.role_change', 'Perubahan role pengguna', 'success', { target: a.target, from, to: a.new_role }); return null; }
      case 'admin_set_status': { needAdmin(); const p = prof(a.target); if (!p) throw Object.assign(new Error('Pengguna tidak ditemukan'), { status: 400, code: 'P0002' });
        if (a.target === U && a.new_status === 'inactive') throw Object.assign(new Error('Tidak bisa menonaktifkan akun sendiri'), { status: 400, code: '23514' });
        if (p.role === 'admin' && a.new_status !== 'active' && T.profiles.filter((x) => x.role === 'admin' && x.status === 'active' && x.id !== p.id).length === 0) throw Object.assign(new Error('Tidak bisa menghapus/menurunkan/menonaktifkan admin aktif terakhir'), { status: 400, code: '23514' });
        p.status = a.new_status; audit(U, E(), 'user.status_change', 'Perubahan status akun', 'success', { target: a.target, to: a.new_status }); return null; }
      case 'admin_update_profile': { needAdmin(); const p = prof(a.target); if (!p) throw Object.assign(new Error('Pengguna tidak ditemukan'), { status: 400, code: 'P0002' }); p.full_name = String(a.p_full_name || '').trim().slice(0, 120); audit(U, E(), 'user.update', 'Ubah informasi pengguna', 'success', { target: a.target }); return null; }
      case 'admin_update_setting': { needAdmin(); const ok = ['registration_enabled', 'ai_enabled', 'maintenance_mode', 'ai_daily_limit', 'prediction_rate_per_minute', 'app_name'];
        if (!ok.includes(a.p_key)) throw Object.assign(new Error('Kunci pengaturan tidak dikenal'), { status: 400 });
        const bool = ['registration_enabled', 'ai_enabled', 'maintenance_mode']; if (bool.includes(a.p_key) && typeof a.p_value !== 'boolean') throw Object.assign(new Error('Nilai harus boolean'), { status: 400 });
        if (a.p_key === 'ai_daily_limit' && !(Number.isInteger(a.p_value) && a.p_value >= 0 && a.p_value <= 500)) throw Object.assign(new Error('ai_daily_limit harus bilangan bulat 0..500'), { status: 400 });
        if (a.p_key === 'prediction_rate_per_minute' && !(Number.isInteger(a.p_value) && a.p_value >= 1 && a.p_value <= 120)) throw Object.assign(new Error('prediction_rate_per_minute harus bilangan bulat 1..120'), { status: 400 });
        const s = T.application_settings.find((x) => x.setting_key === a.p_key); if (s) { s.setting_value = a.p_value; s.updated_by = U; s.updated_at = now(); } else T.application_settings.push({ id: uuid(), setting_key: a.p_key, setting_value: a.p_value, updated_by: U, updated_at: now() });
        audit(U, E(), 'settings.update', 'Perubahan pengaturan: ' + a.p_key, 'success', { key: a.p_key, value: a.p_value }); return null; }
      case 'activate_model_version': { needAdmin(); const m = T.model_versions.find((x) => x.id === a.p_id); if (!m) throw Object.assign(new Error('Versi model tidak ditemukan'), { status: 400, code: 'P0002' }); if (m.status === 'rejected') throw Object.assign(new Error('Versi yang ditolak tidak bisa diaktifkan'), { status: 400, code: '23514' });
        T.model_versions.forEach((x) => { if (x.status === 'active' && x.id !== m.id) x.status = 'archived'; }); m.status = 'active'; m.approved_by = U; m.approved_at = now();
        if (m.dataset_id) { T.datasets.forEach((d) => { if (d.status === 'active' && d.id !== m.dataset_id) d.status = 'archived'; }); const d = T.datasets.find((x) => x.id === m.dataset_id); if (d) d.status = 'active'; }
        audit(U, E(), 'model.activate', 'Aktivasi model ' + m.version, 'success', { model_version_id: m.id, version: m.version }); return null; }
      case 'reject_model_version': { needAdmin(); const m = T.model_versions.find((x) => x.id === a.p_id && x.status === 'candidate'); if (!m) throw Object.assign(new Error('Hanya kandidat yang bisa ditolak'), { status: 400, code: '23514' }); m.status = 'rejected'; audit(U, E(), 'model.reject', 'Penolakan model kandidat', 'success', { model_version_id: a.p_id }); return null; }
      case 'log_client_event': { if (!['auth.login', 'auth.logout', 'auth.password_change'].includes(a.p_action)) throw Object.assign(new Error('Aksi tidak diizinkan'), { status: 400 }); audit(U, E(), a.p_action, '', 'success', a.p_details || {}); return null; }
      case 'admin_stats': { needAdmin(); const ex = T.examinations; const today = now().slice(0, 10);
        const days = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10));
        const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - (11 - i), 1); return d.toISOString().slice(0, 7); });
        const byCrop = {}; ex.forEach((e) => { byCrop[e.predicted_crop] = (byCrop[e.predicted_crop] || 0) + 1; });
        const byUser = {}; ex.forEach((e) => { byUser[e.user_id] = (byUser[e.user_id] || 0) + 1; });
        const act = T.model_versions.find((m) => m.status === 'active');
        return { total_users: T.profiles.length, total_exams: ex.length, exams_today: ex.filter((e) => e.created_at.slice(0, 10) === today).length, crops_in_model: act?.total_classes ?? null, crops_recommended: Object.keys(byCrop).length, total_datasets: T.datasets.length,
          active_model: act ? { version: act.version, algorithm: act.algorithm, accuracy: act.accuracy } : null, active_users_7d: new Set(ex.filter((e) => Date.parse(e.created_at) > Date.now() - 7 * 86400000).map((e) => e.user_id)).size,
          ai_messages_30d: T.ai_messages.filter((m) => m.role === 'user').length,
          daily: days.map((d) => ({ date: d, count: ex.filter((e) => e.created_at.slice(0, 10) === d).length })), monthly: months.map((m) => ({ month: m, count: ex.filter((e) => e.created_at.slice(0, 7) === m).length })),
          by_crop: Object.entries(byCrop).sort((a, b) => b[1] - a[1]).map(([crop, count]) => ({ crop, count })),
          top_users: Object.entries(byUser).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, count]) => ({ user: prof(id)?.full_name || prof(id)?.email, email: prof(id)?.email, count })) }; }
      case 'admin_report_summary': { needAdmin(); let f = T.examinations;
        if (a.p_from) f = f.filter((e) => e.created_at >= a.p_from); if (a.p_to) f = f.filter((e) => e.created_at < new Date(Date.parse(a.p_to) + 86400000).toISOString());
        if (a.p_user) f = f.filter((e) => e.user_id === a.p_user); if (a.p_crop) f = f.filter((e) => e.predicted_crop === a.p_crop);
        const avg = (k) => f.length ? Math.round(f.reduce((s, e) => s + Number(e[k]), 0) / f.length * 100) / 100 : null;
        const grp = (fn) => { const o = {}; f.forEach((e) => { const k = fn(e); o[k] = (o[k] || 0) + 1; }); return o; };
        const uc = {}; f.forEach((e) => { (uc[e.user_id] ||= { n: 0, last: '' }); uc[e.user_id].n++; if (e.created_at > uc[e.user_id].last) uc[e.user_id].last = e.created_at; });
        return { total: f.length, users: Object.keys(uc).length, avg: { N: avg('nitrogen'), P: avg('phosphorus'), K: avg('potassium'), temperature: avg('temperature'), humidity: avg('humidity'), ph: avg('ph'), rainfall: avg('rainfall') },
          by_crop: Object.entries(grp((e) => e.predicted_crop)).sort((a, b) => b[1] - a[1]).map(([crop, count]) => ({ crop, count })),
          by_day: Object.entries(grp((e) => e.created_at.slice(0, 10))).sort().map(([date, count]) => ({ date, count })),
          by_user: Object.entries(uc).sort((a, b) => b[1].n - a[1].n).map(([id, v]) => ({ email: prof(id)?.email, name: prof(id)?.full_name, count: v.n, last: v.last })) }; }
    }
    throw Object.assign(new Error('fungsi tidak ada'), { status: 404 });
  }

  // ---------- HTTP ----------
  async function handle(req, res) {
    const url = new URL(req.url, 'http://x'); const chunks = []; for await (const c of req) chunks.push(c); const raw = Buffer.concat(chunks);
    const send = (status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'content-range', 'access-control-allow-methods': '*', ...headers }); res.end(body == null ? '' : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
    if (req.method === 'OPTIONS') return send(204, null);
    st.requests.push({ method: req.method, path: url.pathname + url.search, auth: (req.headers.authorization || '').slice(0, 12) });
    const json = () => { try { return raw.length ? JSON.parse(raw.toString()) : {}; } catch { return {}; } };
    const apikey = req.headers.apikey; if (apikey !== ANON && apikey !== SERVICE) return send(401, { message: 'Invalid API key' });
    const p = url.pathname; const w = who(req);
    try {
      // --- GoTrue ---
      if (p === '/auth/v1/token') {
        const b = json();
        if (url.searchParams.get('grant_type') === 'password') {
          const u = st.users.find((x) => x.email === String(b.email || '').toLowerCase());
          if (!u || u.password !== b.password) return send(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
          if (u.banned) return send(400, { error_code: 'user_banned', msg: 'User is banned' });
          u.last_sign_in_at = now(); return send(200, mkTokens(u));
        }
        if (url.searchParams.get('grant_type') === 'refresh_token') {
          const uid = st.refresh.get(b.refresh_token); const u = st.users.find((x) => x.id === uid);
          if (!u || u.banned) return send(400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
          st.refresh.delete(b.refresh_token); return send(200, mkTokens(u));
        }
      }
      if (p === '/auth/v1/user') {
        if (w.role !== 'authenticated') return send(401, { msg: 'invalid JWT' });
        const u = st.users.find((x) => x.id === w.uid);
        if (req.method === 'GET') return send(200, { id: u.id, email: u.email, last_sign_in_at: u.last_sign_in_at });
        if (req.method === 'PUT') { const b = json(); if (b.password) { if (String(b.password).length < 8) return send(422, { error_code: 'weak_password', msg: 'Password should be at least 8 characters' }); u.password = b.password; } return send(200, { id: u.id, email: u.email }); }
      }
      if (p === '/auth/v1/logout') return send(204, null);
      if (p === '/auth/v1/recover') { st.recovers.push(json().email); return send(200, {}); }
      const am = /^\/auth\/v1\/admin\/users(?:\/([0-9a-f-]{36}))?$/.exec(p);
      if (am) {
        if (w.role !== 'service') return send(403, { msg: 'not_admin' });
        const id = am[1];
        if (req.method === 'POST' && !id) { const b = json(); const email = String(b.email || '').toLowerCase(); if (st.users.some((x) => x.email === email)) return send(422, { error_code: 'email_exists', msg: 'A user with this email address has already been registered' }); if (!b.password || b.password.length < 8) return send(422, { error_code: 'weak_password', msg: 'weak' });
          const nid = addUser({ email, password: b.password, full_name: b.user_metadata?.full_name || '' }); return send(200, { id: nid, email }); }
        const u = st.users.find((x) => x.id === id); if (!u) return send(404, { msg: 'User not found' });
        if (req.method === 'GET') return send(200, { id: u.id, email: u.email, last_sign_in_at: u.last_sign_in_at });
        if (req.method === 'PUT') { const b = json(); if (b.password) u.password = b.password; if (b.ban_duration) u.banned = b.ban_duration !== 'none'; return send(200, { id: u.id }); }
        if (req.method === 'DELETE') { const pr = prof(id); if (pr?.role === 'admin' && pr.status === 'active' && T.profiles.filter((x) => x.role === 'admin' && x.status === 'active' && x.id !== id).length === 0) return send(500, { msg: 'Tidak bisa menghapus/menurunkan/menonaktifkan admin aktif terakhir' });
          st.users.splice(st.users.indexOf(u), 1); T.profiles.splice(T.profiles.indexOf(pr), 1); T.examinations = T.examinations.filter((e) => e.user_id !== id); T.ai_conversations = T.ai_conversations.filter((c) => c.user_id !== id); T.ai_messages = T.ai_messages.filter((m) => m.user_id !== id); return send(200, {}); }
      }
      // --- RPC ---
      const rm = /^\/rest\/v1\/rpc\/(\w+)$/.exec(p);
      if (rm) { const out = rpc(rm[1], json(), w); return send(200, out ?? null); }
      // --- tabel ---
      const tm = /^\/rest\/v1\/(\w+)$/.exec(p);
      if (tm) { const r = crud(tm[1], req, url, json(), w); return send(r.status, r.body, r.headers); }
      // --- Storage ---
      const sm = /^\/storage\/v1\/object\/datasets\/(.+)$/.exec(p);
      if (sm) { if (w.role !== 'service') return send(403, { message: 'denied' });
        if (req.method === 'POST') { if (st.storage.has(sm[1])) return send(409, { message: 'exists' }); st.storage.set(sm[1], raw); return send(200, { Key: sm[1] }); }
        if (req.method === 'GET') { const f = st.storage.get(decodeURIComponent(sm[1])) || st.storage.get(sm[1]); return f ? send(200, f, { 'content-type': 'text/csv' }) : send(404, { message: 'not found' }); } }
      return send(404, { message: 'not found: ' + p });
    } catch (e) {
      if (!e.status) { console.error('[fake-supabase]', e); return send(500, { message: 'fake error ' + e.message }); }
      return send(e.status, { message: e.message, code: e.code });
    }
  }
  const server = http.createServer((req, res) => { handle(req, res).catch((e) => { console.error(e); res.writeHead(500); res.end(); }); });
  return { server, state: st, addUser, audit, listen: (port = 0) => new Promise((r) => server.listen(port, '127.0.0.1', () => r(server.address().port))), close: () => new Promise((r) => server.close(r)) };
}

// ---------- Penyedia AI palsu (Gemini & Groq/OpenAI) ----------
export function createFakeAi() {
  const st = { mode: 'ok', calls: [] };
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c); let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* */ }
    st.calls.push({ path: req.url, headers: req.headers, body });
    const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (st.mode === 'quota') return send(429, { error: { message: 'quota' } });
    if (st.mode === 'badkey') return send(403, { error: { message: 'denied' } });
    if (st.mode === 'down') return send(503, { error: {} });
    if (st.mode === 'empty') return send(200, req.url.includes('generateContent') ? { candidates: [{ content: { parts: [{ text: '' }] } }] } : { choices: [{ message: { content: '' } }] });
    if (st.mode === 'blocked') return send(200, { promptFeedback: { blockReason: 'SAFETY' } });
    const text = st.text || 'Jawaban uji dari penyedia AI palsu.';
    if (req.url.includes('generateContent')) return send(200, { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });
    send(200, { choices: [{ message: { content: text } }] });
  });
  return { server, state: st, listen: (port = 0) => new Promise((r) => server.listen(port, '127.0.0.1', () => r(server.address().port))), close: () => new Promise((r) => server.close(r)) };
}
