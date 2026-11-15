// Utilitas HTTP bersama untuk semua Netlify Function. Tanpa dependensi eksternal (Node 18+ fetch/Response).
export const env = (k, d = '') => (typeof process !== 'undefined' && process.env[k] != null && process.env[k] !== '' ? process.env[k] : d);

export class HttpError extends Error {
  constructor(status, code, message, fields) { super(message); this.status = status; this.code = code; this.fields = fields; }
}

const SEC = {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
};
export const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { ...SEC, ...headers } });

export const clientIp = (req) =>
  (req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0] || '').trim().slice(0, 64) || null;

// Pembungkus: metode, pemeriksaan Origin (pertahanan berlapis; token dikirim lewat header Authorization, bukan cookie,
// jadi CSRF klasik tidak berlaku), dan penanganan error tanpa stack trace ke klien.
export function route(methods, fn) {
  return async (req, context) => {
    try {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow: methods.join(', ') } });
      if (!methods.includes(req.method)) throw new HttpError(405, 'method_not_allowed', 'Metode tidak diizinkan.');
      if (req.method !== 'GET') {
        const origin = req.headers.get('origin');
        if (origin) {
          const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host;
          const allowed = env('ALLOWED_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean);
          let oh = ''; try { oh = new URL(origin).host; } catch { /* abaikan */ }
          if (oh !== host && !allowed.includes(origin)) throw new HttpError(403, 'bad_origin', 'Origin tidak diizinkan.');
        }
      }
      return await fn(req, context);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.code, message: e.message, ...(e.fields ? { fields: e.fields } : {}) }, e.retryAfter ? { 'retry-after': String(e.retryAfter) } : {});
      console.error('[function-error]', e && e.message); // hanya pesan, tanpa stack ke klien
      return json(500, { error: 'internal_error', message: 'Terjadi kesalahan pada server.' });
    }
  };
}

export async function readJson(req, max = 32768) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > max) throw new HttpError(413, 'payload_too_large', 'Data terlalu besar.');
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, 'payload_too_large', 'Data terlalu besar.');
  try { const v = JSON.parse(text || '{}'); if (v === null || typeof v !== 'object' || Array.isArray(v)) throw 0; return v; }
  catch { throw new HttpError(400, 'invalid_json', 'Body harus berupa objek JSON yang valid.'); }
}

// Pembatas laju in-memory (best-effort per instance; pembatas utama yang tahan cold-start ada di database).
const buckets = new Map();
export function memLimit(key, limit, windowMs) {
  const now = Date.now(); const b = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (b.length >= limit) { const e = new HttpError(429, 'rate_limited', 'Terlalu banyak permintaan. Coba lagi sebentar lagi.'); e.retryAfter = Math.ceil((windowMs - (now - b[0])) / 1000); buckets.set(key, b); throw e; }
  b.push(now); buckets.set(key, b);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1] > windowMs) buckets.delete(k);
}
export const _resetLimits = () => buckets.clear();

export const isUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export const isEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
