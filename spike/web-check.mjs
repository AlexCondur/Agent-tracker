// Screenshots the dashboard while a ct test session waits on a question, then cleans up.
import pty from 'node-pty';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import xterm from '@xterm/headless';

const dir = path.dirname(new URL(import.meta.url).pathname);
const sandbox = path.join(dir, 'sandbox');
const API = 'http://127.0.0.1:47800';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const out = path.join(dir, 'shots');
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async p => (await fetch(API + p)).json();
const post = (p, b) => fetch(API + p, { method: 'POST', body: JSON.stringify(b) });
const t0 = Date.now();

function shot(name, url) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'at-chrome-'));
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', `--user-data-dir=${profile}`, '--window-size=1500,950', `--timeout=${process.env.SHOT_TIMEOUT ?? 4000}`, `--screenshot=${path.join(out, name)}`, url], { stdio: 'ignore', timeout: 30000 });
  fs.rmSync(profile, { recursive: true, force: true });
  console.log('shot', name);
}

const term = new xterm.Terminal({ cols: 110, rows: 32, allowProposedApi: true });
const prompt = 'Dashboard test. Use AskUserQuestion to ask which database I want for a new service, options "Postgres", "SQLite", "DynamoDB". Then reply with one sentence about the choice.';
const p = pty.spawn(path.join(dir, '..', 'bin', 'ct.ts'), ['--model', 'haiku', '--permission-mode', 'default', '-n', 'dashboard-test', prompt], { name: 'xterm-256color', cols: 110, rows: 32, cwd: sandbox, env: process.env });
p.onData(d => term.write(d));
term.onData(d => p.write(d));

let s;
for (let i = 0; i < 200 && !s; i++) {
  await sleep(300);
  s = (await get('/api/sessions')).find(x => x.cwd === sandbox && x.state === 'waiting' && x.ctId && x.lastActivityAt >= t0);
}
if (!s) { console.log('session never waited'); p.kill(); process.exit(1); }
await sleep(500);
shot('1-overview.png', `${API}/`);
shot('2-selected.png', `${API}/#${s.id}`);
await post(`/api/sessions/${s.id}/input`, { key: '2' });
for (let i = 0; i < 100; i++) { await sleep(300); const x = await get(`/api/sessions/${s.id}`); if (x.state === 'idle') break; }
shot('3-answered.png', `${API}/#${s.id}`);
await post(`/api/sessions/${s.id}/input`, { key: 'ctrl+c' });
await sleep(400);
await post(`/api/sessions/${s.id}/input`, { key: 'ctrl+c' });
await sleep(1500);
p.kill();
process.exit(0);
