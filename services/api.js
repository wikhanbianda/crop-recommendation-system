// Panggilan ke Netlify Functions (backend). Semua hak akses diperiksa ulang di server.
import { ApiError, validToken } from './supabase.js';

export async function fn(name, { method = 'GET', body, query = '', headers = {}, rawBody, auth = true } = {}) {
  const h = { ...headers };
  if (auth) h.authorization = `Bearer ${await validToken()}`;
  let b;
  if (rawBody !== undefined) b = rawBody; else if (body !== undefined) { b = JSON.stringify(body); h['content-type'] = 'application/json'; }
  let res;
  try { res = await fetch(`/.netlify/functions/${name}${query}`, { method, headers: h, body: b }); }
  catch { throw new ApiError(0, 'network', 'Tidak dapat menghubungi server. Periksa koneksi internet Anda.'); }
  const text = await res.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* bukan JSON */ }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || 'error', (data && data.message) || (res.status === 404 ? 'Layanan tidak ditemukan.' : 'Terjadi kesalahan pada server.'), data && data.fields);
  return data;
}

export const adminUsers = {
  list: (params) => fn('admin-users', { query: '?' + new URLSearchParams(params) }),
  get: (id) => fn('admin-users', { query: `?id=${id}` }),
  create: (body) => fn('admin-users', { method: 'POST', body }),
  update: (body) => fn('admin-users', { method: 'PATCH', body }),
  remove: (id) => fn('admin-users', { method: 'DELETE', query: `?id=${id}` }),
};
export const datasets = {
  list: () => fn('datasets'),
  preview: (id) => fn('datasets', { query: `?id=${id}` }),
  upload: (file, { name, version } = {}) => {
    const q = new URLSearchParams(); if (name) q.set('name', name); if (version) q.set('version', version);
    return fn('datasets', { method: 'POST', rawBody: file, query: q.toString() ? `?${q}` : '', headers: { 'content-type': 'text/csv', 'x-filename': file.name } });
  },
};
export const models = {
  overview: () => fn('models'),
  job: (version) => fn('models', { query: `?job=${encodeURIComponent(version)}` }),
  train: (dataset_id, version) => fn('models', { method: 'POST', body: { action: 'train', dataset_id, ...(version ? { version } : {}) } }),
  activate: (id) => fn('models', { method: 'POST', body: { action: 'activate', id } }),
  reject: (id) => fn('models', { method: 'POST', body: { action: 'reject', id } }),
};
