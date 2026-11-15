// Menyalin HANYA berkas publik ke dist/ (allow-list). Folder ml/, database/, tests/, netlify/, docs/ tidak pernah dipublikasikan.
import { cpSync, rmSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist');
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
for (const f of readdirSync(root)) if (/\.html$/.test(f)) cpSync(resolve(root, f), resolve(out, f));
for (const d of ['admin', 'user', 'ai-assistant', 'assets', 'services']) if (existsSync(resolve(root, d))) cpSync(resolve(root, d), resolve(out, d), { recursive: true });
console.log('dist/ siap:', readdirSync(out).join(', '));
