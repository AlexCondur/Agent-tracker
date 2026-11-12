// After a daemon restart, is the session's screen still visible to the dashboard?
// usage: node spike/replay-check.mjs <path to ct.ts> [--ctrl-l]
import pty from 'node-pty';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import xterm from '@xterm/headless';
const dir = path.dirname(new URL(import.meta.url).pathname);
const sandbox = path.join(dir, 'sandbox');
const API = 'http://127.0.0.1:47800';
const ctBin = path.resolve(process.argv[2]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async p => { try { return await (await fetch(API + p)).json(); } catch { return undefined; } };
const post = (p, b) => fetch(API + p, { method: 'POST', body: JSON.stringify(b) });
const t0 = Date.now();
const term = new xterm.Terminal({ cols: 100, rows: 30, allowProposedApi: true });
const p = pty.spawn(ctBin, ['--model', 'haiku', 'Reply with a haiku about terminals'], { name: 'xterm-256color', cols: 100, rows: 30, cwd: sandbox, env: process.env });
p.onData(d => term.write(d)); term.onData(d => p.write(d));
let s;
for (let i = 0; i < 200 && !s; i++) { await sleep(300); s = (await get('/api/sessions'))?.find(x => x.cwd === sandbox && x.state === 'idle' && x.ctId && x.lastActivityAt >= t0); }
if (!s) {
  const b = term.buffer.active; let o = ''; for (let i = 0; i < term.rows; i++) o += (b.getLine(b.viewportY + i)?.translateToString(true) ?? '') + '\n';
  console.log('TIMEOUT. fake terminal:\n' + o.replace(/\n{2,}/g, '\n'));
  console.log('sessions:', JSON.stringify((await get('/api/sessions'))?.map(x => [x.id.slice(0, 8), x.state, x.cwd.slice(-20), !!x.ctId])));
  p.kill(); process.exit(1);
}
const lines = t => t.split('\n').filter(l => l.trim()).length;
console.log('before restart: screen lines =', lines((await get(`/api/sessions/${s.id}/screen`)).screen));
execFileSync(path.join(dir, '..', 'bin', 'ct.ts'), ['daemon', 'restart']);
let after;
for (let i = 0; i < 30; i++) { await sleep(300); after = await get(`/api/sessions/${s.id}/screen`); if (after?.screen !== undefined) break; }
await sleep(500);
after = await get(`/api/sessions/${s.id}/screen`);
console.log('after restart: screen lines =', lines(after.screen ?? ''));
if (process.argv.includes('--ctrl-l')) {
  await post(`/api/sessions/${s.id}/input`, { data: '\x0c' });
  await sleep(1500);
  const r = (await get(`/api/sessions/${s.id}/screen`)).screen;
  console.log('after ctrl+L: screen lines =', lines(r));
  console.log(r.split('\n').filter(l => l.trim()).slice(0, 12).join('\n'));
} else {
  console.log(after.screen.split('\n').filter(l => l.trim()).slice(0, 12).join('\n'));
}
for (const k of ['ctrl+c', 'ctrl+c']) { await post(`/api/sessions/${s.id}/input`, { key: k }); await sleep(400); }
p.kill(); process.exit(0);
