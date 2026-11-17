// Uji fungsi soil-prediction: Python ASLI + Supabase palsu. Model gambar di sini dilatih dari data SINTETIS (hanya untuk uji alur).
// Jalankan: node --test tests/soil.functions.test.mjs
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'soil-'));
process.env.SOIL_ARTIFACTS_DIR = join(dir, 'art');
const { startEnv, call, login } = await import('./support/harness.mjs');
const { _resetLimits } = await import('../netlify/functions/_lib/core.js');
let E; let ani;
before(async () => { E = await startEnv(); ani = await login('ani'); });
after(async () => { await E.stop(); });
beforeEach(() => _resetLimits());
const post = (body, token = ani, headers = {}) => call('soil-prediction', { method: 'POST', token, rawBody: body, headers: { 'content-type': 'image/jpeg', ...headers } });

describe('foto tanah', () => {
  test('tanpa login -> 401', async () => { assert.equal((await post(new Uint8Array([0xff, 0xd8, 0xff]), null)).status, 401); });
  test('model belum dilatih: status available=false, prediksi 503 (tanpa hasil palsu)', async () => {
    assert.equal((await call('soil-prediction', { token: ani })).data.available, false);
    const r = await post(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]));
    assert.equal(r.status, 503); assert.equal(r.data.error, 'no_soil_model');
  });
  test('setelah dilatih: status tersedia + prediksi sukses + audit tanpa gambar', async () => {
    const p = spawnSync('python3', ['-I', join(import.meta.dirname, 'support/make_soil_fixture.py'), dir]); assert.equal(p.status, 0, String(p.stderr));
    const s = await call('soil-prediction', { token: ani }); assert.equal(s.data.available, true); assert.equal(s.data.model.version, 't1');
    const r = await post(readFileSync(join(dir, 'black.jpg')));
    assert.equal(r.status, 200); assert.equal(r.data.predicted_soil, 'black'); assert.ok(r.data.crops.length > 0);
    const a = E.fake.state.tables.audit_logs.filter((x) => x.action === 'soil.predict');
    assert.equal(a.length, 1); assert.ok(!JSON.stringify(a[0]).includes('/9j/'));   // tidak ada data gambar di log
  });
  test('bukan JPEG -> 422; kosong -> 422; terlalu besar -> 413', async () => {
    assert.equal((await post(new TextEncoder().encode('<?php echo 1;'))).status, 422);
    assert.equal((await post(new Uint8Array(0))).status, 422);
    assert.equal((await post(new Uint8Array(1_600_000).fill(1))).status, 413);
  });
  test('JPEG rusak -> 422 dari layanan, tanpa stack trace', async () => {
    const r = await post(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]));
    assert.equal(r.status, 422); assert.equal(r.data.error, 'invalid_image'); assert.ok(!/at .*\.(js|py)/.test(r.text));
  });
  test('layanan Python mati -> 503, bukan hasil tiruan', async () => {
    process.env.INFERENCE_SERVICE_URL = 'http://127.0.0.1:9';
    try { const r = await post(readFileSync(join(dir, 'black.jpg'))); assert.equal(r.status, 503); assert.ok(!r.data.predicted_soil); }
    finally { process.env.INFERENCE_SERVICE_URL = E.inferenceUrl; }
  });
});
