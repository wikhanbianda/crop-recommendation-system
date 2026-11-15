// Server pengembangan lokal: menyajikan berkas publik (allow-list yang sama dengan build) dan menjalankan
// Netlify Functions di /.netlify/functions/<nama>. Pemakaian: node scripts/dev-server.mjs  (PORT=8888 bawaan)
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = process.env.ENV_FILE || resolve(root, '.env');
if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line); if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/\s+#.*$/, '').replace(/^"(.*)"$/, '$1');
}
const PUBLIC_DIRS = ['admin', 'user', 'ai-assistant', 'assets', 'services'];
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function allowed(rel) {
  const top = rel.split(sep)[0];
  return (!rel.includes(sep) && rel.endsWith('.html')) || PUBLIC_DIRS.includes(top);
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/.netlify/functions/')) {
        const name = url.pathname.slice('/.netlify/functions/'.length).replace(/[^a-z0-9-]/gi, '');
        const file = resolve(root, 'netlify/functions', name + '.js');
        if (!name || !existsSync(file)) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"not_found"}'); }
        const chunks = []; for await (const c of req) chunks.push(c);
        const body = Buffer.concat(chunks);
        const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(',') : v);
        const r = new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
        const mod = await import(pathToFileURL(file).href);
        const out = await mod.default(r, {});
        res.writeHead(out.status, Object.fromEntries(out.headers)); return res.end(Buffer.from(await out.arrayBuffer()));
      }
      let p = decodeURIComponent(url.pathname); if (p === '/') p = '/index.html';
      const rel = normalize(p).replace(/^[/\\]+/, '');
      const abs = resolve(root, rel);
      if (!abs.startsWith(root + sep) || !allowed(rel) || !existsSync(abs) || !statSync(abs).isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('404 Tidak ditemukan');
      }
      res.writeHead(200, { 'content-type': MIME[extname(abs)] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
      res.end(readFileSync(abs));
    } catch (e) { console.error(e); res.writeHead(500); res.end('Server error'); }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8888);
  createServer().listen(port, () => console.log(`Dev server: http://localhost:${port}`));
}
