import { createRequire } from 'node:module';
import { startEnv } from '../support/harness.mjs';
import { createServer } from '../../scripts/dev-server.mjs';
const require = createRequire('/usr/local/lib/node_modules/');
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/usr/lib/node_modules/playwright')); }
const env = await startEnv(); const srv = createServer(); await new Promise((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}`;
const b = await chromium.launch(); const out = [];
async function visit(who, paths) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage();
  await ctx.route(/cdn\.jsdelivr\.net/, (r) => r.abort());
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/jsdelivr|ERR_FAILED|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  if (who) { await p.goto(base + '/login.html'); await p.fill('#f-email', `${who}@test.id`); await p.fill('#f-password', 'Password123'); await p.click('button[type=submit]'); await p.waitForURL(/dashboard/, { timeout: 8000 }); }
  for (const path of paths) { errs.length = 0; await p.goto(base + path); await p.waitForTimeout(900); const txt = (await p.locator('main').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 110); out.push([who || 'anon', path, errs.slice(0, 2).join(' | ') || 'ok', txt]); await p.screenshot({ path: `/tmp/claude-0/-home-claude/4a0255b0-cded-56ae-bc87-95c057b3c607/scratchpad/shots/${(who || 'anon')}-${path.replace(/\W+/g, '_')}.png` }); }
  await ctx.close();
}
await import('node:fs').then((fs) => fs.mkdirSync('/tmp/claude-0/-home-claude/4a0255b0-cded-56ae-bc87-95c057b3c607/scratchpad/shots', { recursive: true }));
await visit(null, ['/', '/login.html', '/register.html', '/forgot-password.html', '/reset-password.html']);
await visit('admin', ['/admin/dashboard.html', '/admin/users.html', '/admin/datasets.html', '/admin/examinations.html', '/admin/reports.html', '/admin/models.html', '/admin/audit-logs.html', '/admin/settings.html', '/admin/profile.html', '/ai-assistant/assistant.html']);
await visit('ani', ['/user/dashboard.html', '/user/prediction.html', '/user/history.html', '/user/profile.html', '/ai-assistant/assistant.html', '/admin/dashboard.html']);
for (const r of out) console.log(r.join('  |  '));
await b.close(); srv.close(); await env.stop(); process.exit(0);
