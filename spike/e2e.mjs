// End-to-end: a fake terminal runs `ct`; the session is driven only through the daemon API.
import pty from 'node-pty';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import xterm from '@xterm/headless';

const dir = path.dirname(new URL(import.meta.url).pathname);
const sandbox = path.join(dir, 'sandbox');
const API = 'http://127.0.0.1:47800';
const t0 = Date.now();
const log = m => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async p => (await fetch(API + p)).json();
const post = async (p, b) => (await fetch(API + p, { method: 'POST', body: JSON.stringify(b) })).json();

// The fake terminal (stands in for iTerm): answers terminal queries like a real one.
const term = new xterm.Terminal({ cols: 120, rows: 40, allowProposedApi: true });
const prompt = 'E2E test. Step 1: use AskUserQuestion to ask which color I prefer, options "red" and "blue". Step 2: run the bash command `echo <color> > picked.txt`. Step 3: reply with just the word DONE.';
const p = pty.spawn(path.join(dir, '..', 'bin', 'ct.ts'), ['--model', 'haiku', '--permission-mode', 'default', prompt], { name: 'xterm-256color', cols: 120, rows: 40, cwd: sandbox, env: process.env });
p.onData(d => term.write(d));
term.onData(d => p.write(d));
let exited = null;
p.onExit(e => (exited = e.exitCode));

async function waitFor(desc, pred, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = (await get('/api/sessions?all')).find(x => x.cwd === sandbox && x.startedAt >= t0 - 5000);
    if (s && pred(s)) { log(`OK ${desc} → state=${s.state} ct=${!!s.ctId} activity=${s.activity ?? ''} last=${(s.lastMessage ?? '').slice(0, 40)}`); return s; }
    await sleep(300);
  }
  throw new Error(`timeout waiting for ${desc}`);
}

try {
  for (let i = 0; i < 50; i++) { try { await get('/api/health'); break; } catch { await sleep(200); } }
  let s = await waitFor('question pending, linked to ct', s => s.pending?.kind === 'question' && s.ctId);
  log('screen excerpt:\n' + (await get(`/api/sessions/${s.id}/screen`)).screen.split('\n').filter(l => /red|blue|Color/.test(l)).join('\n'));
  log('answer: ' + JSON.stringify(await post(`/api/sessions/${s.id}/input`, { key: '2' })));
  s = await waitFor('permission pending for Bash', s => s.pending?.kind === 'permission' && s.pending.toolName === 'Bash');
  log('approve: ' + JSON.stringify(await post(`/api/sessions/${s.id}/input`, { key: '1' })));
  s = await waitFor('idle after DONE', s => s.state === 'idle' && /DONE/.test(s.lastMessage ?? ''));
  log(`picked.txt = ${fs.readFileSync(path.join(sandbox, 'picked.txt'), 'utf8').trim()}; tokens in/out ${s.tokensIn}/${s.tokensOut}, model ${s.model}, messages ${s.messages}`);

  log('ct send follow-up text via CLI');
  execFileSync(path.join(dir, '..', 'bin', 'ct.ts'), ['send', s.id.slice(0, 8), 'Reply with just the word AGAIN']);
  s = await waitFor('idle after AGAIN', s => s.state === 'idle' && /AGAIN/.test(s.lastMessage ?? ''));

  log('restart daemon mid-session');
  const { pid } = await get('/api/health');
  process.kill(pid, 'SIGTERM');
  await sleep(500);
  spawn(process.execPath, ['--no-warnings', path.join(dir, '..', 'src', 'daemon', 'main.ts')], { detached: true, stdio: 'ignore' }).unref();
  await sleep(1000);
  s = await waitFor('re-linked to ct after restart', s => s.ctId && s.state === 'idle', 15000);
  await post(`/api/sessions/${s.id}/input`, { text: 'Reply with just the word RESTARTED' });
  s = await waitFor('idle after RESTARTED', s => /RESTARTED/.test(s.lastMessage ?? ''));

  log('exit claude with ctrl+c ×2 via API');
  await post(`/api/sessions/${s.id}/input`, { key: 'ctrl+c' });
  await sleep(400);
  await post(`/api/sessions/${s.id}/input`, { key: 'ctrl+c' });
  s = await waitFor('ended', s => s.state === 'ended', 15000);
  await sleep(500);
  log(`ct exit code: ${exited}`);
  log('PASS');
} catch (e) {
  log('FAIL ' + e.message);
  const b = term.buffer.active; let out = ''; for (let i = 0; i < term.rows; i++) out += (b.getLine(b.viewportY + i)?.translateToString(true) ?? '') + '\n';
  console.log(out.replace(/\n{3,}/g, '\n\n'));
  p.kill();
}
process.exit(0);
