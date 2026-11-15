// Menyalakan lingkungan uji: Supabase palsu + AI palsu + layanan inferensi Python ASLI (model joblib sungguhan).
import { spawn } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFake, createFakeAi, ANON, SERVICE } from './fake-supabase.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const CSV = readFileSync(join(ROOT, 'ml/data/Crop_recommendation.csv'));
export const PW = 'Password123';

async function waitFor(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const r = await fetch(url); if (r.ok) return; } catch { /* belum siap */ } await new Promise((r) => setTimeout(r, 300)); }
  throw new Error('timeout menunggu ' + url);
}

export async function startEnv({ inference = true } = {}) {
  const fake = createFake(); const ai = createFakeAi();
  const sp = await fake.listen(); const ap = await ai.listen();
  const env = process.env;
  Object.assign(env, { SUPABASE_URL: `http://127.0.0.1:${sp}`, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE,
    AI_PROVIDER: 'gemini', AI_API_KEY: 'test-ai-key-123', AI_MODEL: 'gemini-test', AI_API_BASE_URL: `http://127.0.0.1:${ap}/v1beta`, INFERENCE_SERVICE_KEY: 'test-inference-key' });
  let py = null; let artifacts = null; let port = 0;
  if (inference) {
    artifacts = mkdtempSync(join(tmpdir(), 'artifacts-')); cpSync(join(ROOT, 'ml/artifacts'), artifacts, { recursive: true });
    port = 18000 + Math.floor(Math.random() * 1000);
    py = spawn('python3', ['-I', join(ROOT, 'ml/service/app.py')], { env: { ...process.env, PORT: String(port), ARTIFACTS_DIR: artifacts, INFERENCE_SERVICE_KEY: 'test-inference-key' }, stdio: 'ignore' });
    env.INFERENCE_SERVICE_URL = `http://127.0.0.1:${port}`;
    await waitFor(`http://127.0.0.1:${port}/health`);
  } else env.INFERENCE_SERVICE_URL = 'http://127.0.0.1:9';   // port tertutup: simulasi layanan mati
  const admin = fake.addUser({ email: 'admin@test.id', password: PW, full_name: 'Admin Uji', role: 'admin' });
  const user = fake.addUser({ email: 'ani@test.id', password: PW, full_name: 'Ani Petani' });
  const user2 = fake.addUser({ email: 'budi@test.id', password: PW, full_name: 'Budi Tani' });
  return { fake, ai, ids: { admin, user, user2 }, supabaseUrl: env.SUPABASE_URL, inferenceUrl: env.INFERENCE_SERVICE_URL, inferencePort: port, artifacts,
    async stop() { await fake.close(); await ai.close(); if (py) py.kill('SIGKILL'); } };
}

// panggil handler fungsi langsung (tanpa HTTP) dengan objek Request standar
export async function call(name, { method = 'GET', token, body, headers = {}, query = '', rawBody, ip } = {}) {
  const mod = await import(`../../netlify/functions/${name}.js?${Math.random()}`.replace(/\?.*/, ''));   // modul di-cache; state di fake
  const h = { ...headers }; if (token) h.authorization = `Bearer ${token}`; if (ip) h['x-nf-client-connection-ip'] = ip;
  let b; if (rawBody !== undefined) b = rawBody; else if (body !== undefined) { b = JSON.stringify(body); h['content-type'] = 'application/json'; }
  const res = await mod.default(new Request(`http://site.test/.netlify/functions/${name}${query}`, { method, headers: h, body: ['GET', 'HEAD'].includes(method) ? undefined : b }), {});
  const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch { /* */ }
  return { status: res.status, data, text, headers: res.headers };
}

export async function login(who, email = null, pw = PW) {
  const r = await call('auth', { method: 'POST', query: '?action=login', body: { email: email || `${who}@test.id`, password: pw } });
  return r.data?.session?.access_token;
}
