// What does the terminal stream's init snapshot contain while a question is pending?
import pty from 'node-pty';
import path from 'node:path';
import xterm from '@xterm/headless';
const dir = path.dirname(new URL(import.meta.url).pathname);
const sandbox = path.join(dir, 'sandbox');
const API = 'http://127.0.0.1:47800';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();
const term = new xterm.Terminal({ cols: 110, rows: 32, allowProposedApi: true });
const p = pty.spawn(path.join(dir, '..', 'bin', 'ct.ts'), ['--model', 'haiku', 'Use AskUserQuestion to ask: tea or coffee?'], { name: 'xterm-256color', cols: 110, rows: 32, cwd: sandbox, env: process.env });
p.onData(d => term.write(d)); term.onData(d => p.write(d));
let s;
for (let i = 0; i < 200 && !s; i++) { await sleep(300); s = (await (await fetch(API + '/api/sessions')).json()).find(x => x.cwd === sandbox && x.state === 'waiting' && x.ctId && x.lastActivityAt >= t0); }
await sleep(800);
const res = await fetch(`${API}/api/sessions/${s.id}/terminal`);
const reader = res.body.getReader();
const { value } = await reader.read();
const text = new TextDecoder().decode(value);
const init = JSON.parse(text.split('\n').find(l => l.startsWith('data: ')).slice(6));
console.log('cols/rows', init.cols, init.rows, 'bytes', init.data.length);
console.log(JSON.stringify(init.data.slice(0, 300)));
console.log('...', JSON.stringify(init.data.slice(-300)));
const r = new xterm.Terminal({ cols: init.cols, rows: init.rows, allowProposedApi: true });
r.write(init.data, () => { const b = r.buffer.active; let o = ''; for (let i = 0; i < r.rows; i++) o += (b.getLine(b.viewportY + i)?.translateToString(true) ?? '') + '\n'; console.log('REPLAYED:\n' + o.replace(/\n{2,}/g, '\n'));
  reader.cancel(); fetch(`${API}/api/sessions/${s.id}/input`, { method: 'POST', body: '{"key":"esc"}' }).then(async () => { await sleep(500); for (const k of ['ctrl+c', 'ctrl+c']) { await fetch(`${API}/api/sessions/${s.id}/input`, { method: 'POST', body: JSON.stringify({ key: k }) }); await sleep(400); } p.kill(); process.exit(0); }); });
