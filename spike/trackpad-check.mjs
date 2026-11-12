// Trackpad-style scrolling over the dashboard terminal: many small fractional pixel deltas.
// Drives only its own sandbox session, matched strictly by name.
import pty from 'node-pty';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import xterm from '@xterm/headless';

const NAME = 'trackpad-check';
const dir = path.dirname(new URL(import.meta.url).pathname);
const API = 'http://127.0.0.1:47800';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();
const mine = async () => {
  const all = (await (await fetch(`${API}/api/sessions`)).json()).filter(s => s.name === NAME && s.ctId && s.startedAt >= t0 - 5000);
  if (all.length > 1) throw new Error('ambiguous session match');
  return all[0];
};
const topLine = async id => (await (await fetch(`${API}/api/sessions/${id}/screen`)).json()).screen.split('\n').find(l => l.trim())?.trim();

const term = new xterm.Terminal({ cols: 100, rows: 30, allowProposedApi: true });
const p = pty.spawn(path.join(dir, '..', 'bin', 'ct.ts'), ['--model', 'haiku', '-n', NAME, 'List the numbers 1 to 150, one per line, as plain text. Do not use any tools.'], { name: 'xterm-256color', cols: 100, rows: 30, cwd: path.join(dir, 'sandbox'), env: process.env });
p.onData(d => term.write(d)); term.onData(d => p.write(d));

let s;
for (let i = 0; i < 300; i++) { await sleep(300); s = await mine(); if (s?.state === 'idle') break; }
if (s?.state !== 'idle') throw new Error('session never finished');
await sleep(1000);

const prof = fs.mkdtempSync('/tmp/at-tp-');
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', `--user-data-dir=${prof}`, '--window-size=1400,900', '--remote-debugging-port=9342', 'about:blank'], { stdio: 'ignore' });
await sleep(1500);
const page = (await (await fetch('http://127.0.0.1:9342/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = m => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); };
const send = (method, params = {}) => new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
await send('Page.navigate', { url: `${API}/#${s.id}` });
await sleep(4000);
const box = (await send('Runtime.evaluate', { returnByValue: true, expression: `(() => { const r = document.querySelector('.xterm-screen').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()` })).result.result.value;

const wheel = async (dy, n) => { for (let i = 0; i < n; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box[0], y: box[1], deltaX: 0.4, deltaY: dy }); await sleep(16); } };
const before = await topLine(s.id);
await wheel(-3.3, 60); // trackpad swipe up: small, fractional, many
await sleep(1500);
const afterUp = await topLine(s.id);
await wheel(4.1, 80);
await sleep(1500);
const afterDown = await topLine(s.id);
console.log({ before, afterUp, afterDown, scrolledUp: before !== afterUp, backDown: afterDown === before });

ws.close(); chrome.kill();
const me = await mine();
for (const k of ['ctrl+c', 'ctrl+c']) { await fetch(`${API}/api/sessions/${me.id}/input`, { method: 'POST', body: JSON.stringify({ key: k }) }); await sleep(400); }
p.kill(); await sleep(300); fs.rmSync(prof, { recursive: true, force: true, maxRetries: 3 }); process.exit(0);
