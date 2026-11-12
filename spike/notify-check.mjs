// Subscribes as a notifying dashboard, runs a ct session with a question and a permission prompt,
// and prints the notifications the daemon emits.
import pty from 'node-pty';
import path from 'node:path';
import xterm from '@xterm/headless';
const dir = path.dirname(new URL(import.meta.url).pathname);
const sandbox = path.join(dir, 'sandbox');
const API = 'http://127.0.0.1:47800';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();
const log = m => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const get = async p => (await fetch(API + p)).json();
const post = (p, b) => fetch(API + p, { method: 'POST', body: JSON.stringify(b) });

const notes = [];
const ctrl = new AbortController();
(async () => {
  const res = await fetch(`${API}/api/events?notify=1`, { signal: ctrl.signal });
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk);
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      if (block.startsWith('event: notify')) { const n = JSON.parse(block.split('\ndata: ')[1]); notes.push(n); log(`NOTIFY ${n.kind}: "${n.title}" — ${n.body} (${n.url})`); }
    }
  }
})().catch(() => {});

const term = new xterm.Terminal({ cols: 110, rows: 32, allowProposedApi: true });
const p = pty.spawn(path.join(dir, '..', 'bin', 'ct.ts'), ['--model', 'haiku', '--permission-mode', 'default', '-n', 'notify-test', 'Use AskUserQuestion to ask: tabs or spaces? Then run the bash command `echo <answer> > picked.txt`. Then reply DONE.'], { name: 'xterm-256color', cols: 110, rows: 32, cwd: sandbox, env: process.env });
p.onData(d => term.write(d)); term.onData(d => p.write(d));

const find = async pred => { for (let i = 0; i < 300; i++) { const s = (await get('/api/sessions')).find(x => x.cwd === sandbox && x.lastActivityAt >= t0 && pred(x)); if (s) return s; await sleep(200); } throw new Error('timeout'); };
let s = await find(x => x.pending?.kind === 'question' && x.ctId);
log('question pending; waiting for notification');
await sleep(2500);
await post(`/api/sessions/${s.id}/input`, { key: '1' });
s = await find(x => x.pending?.kind === 'permission');
log('permission pending; answering immediately (should NOT notify)');
await post(`/api/sessions/${s.id}/input`, { key: '1' });
s = await find(x => x.state === 'idle' && /DONE/.test(x.lastMessage ?? ''));
await sleep(2000);
log(`notifications: ${notes.map(n => n.kind).join(', ') || 'none'}`);
for (const k of ['ctrl+c', 'ctrl+c']) { await post(`/api/sessions/${s.id}/input`, { key: k }); await sleep(400); }
ctrl.abort(); p.kill(); process.exit(0);
