// Spike: drive an interactive `claude` in a PTY, answer prompts via keystrokes, capture hook payloads.
import pty from 'node-pty';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import xterm from '@xterm/headless';

const dir = path.dirname(new URL(import.meta.url).pathname);
const hooksLog = path.join(dir, 'hooks.jsonl');
fs.writeFileSync(hooksLog, '');
const events = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    fs.appendFileSync(hooksLog, body.replace(/\n/g, ' ') + '\n');
    try { const j = JSON.parse(body); events.push(j); log(`HOOK ${j.hook_event_name} ${j.notification_type ?? ''} ${j.tool_name ?? ''}`); } catch {}
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
}).listen(47821, '127.0.0.1');

const hook = [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:47821/hook' }] }];
const settings = { hooks: Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd', 'PermissionRequest', 'PreToolUse'].map(e => [e, hook])) };
const settingsPath = path.join(dir, 'spike-settings.json');
fs.writeFileSync(settingsPath, JSON.stringify(settings));

const term = new xterm.Terminal({ cols: 120, rows: 40, allowProposedApi: true });
const screen = () => { const b = term.buffer.active; const out = []; for (let i = 0; i < term.rows; i++) out.push(b.getLine(b.viewportY + i)?.translateToString(true) ?? ''); return out.join('\n'); };
const t0 = Date.now();
const log = m => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

const prompt = 'Spike test. Step 1: use the AskUserQuestion tool to ask me which color I prefer, options "red" and "blue". Step 2: run the bash command `echo <color> > picked.txt` with the color I chose. Step 3: reply with just the word DONE.';
const p = pty.spawn('claude', ['--model', 'haiku', '--permission-mode', 'default', '--settings', settingsPath, prompt], { name: 'xterm-256color', cols: 120, rows: 40, cwd: path.join(dir, 'sandbox'), env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE_CODE_|CLAUDECODE)/.test(k))) });
p.onData(d => term.write(d));
term.onData(d => p.write(d)); // answer terminal queries (DA, cursor pos)

const steps = [
  { name: 'trust', re: /trust (the files|this folder)/i, keys: '\x1b[B\r', optional: true },
  { name: 'question', re: /red[\s\S]*blue/i, after: e => e.some(x => x.hook_event_name === 'PreToolUse' && x.tool_name === 'AskUserQuestion'), keys: '2' },
  { name: 'permission', after: e => e.some(x => x.hook_event_name === 'PermissionRequest' && x.tool_name === 'Bash'), keys: '1' },
  { name: 'done', after: e => e.some(x => x.hook_event_name === 'Stop') },
];
let i = 0, lastScreen = '';
const tick = setInterval(() => {
  const s = screen();
  if (Date.now() - t0 > 180000) return finish('TIMEOUT');
  const step = steps[i];
  if (!step) return;
  if (step.optional && i === 0 && Date.now() - t0 > 8000 && !step.re.test(s)) { log('no trust dialog'); i++; return; }
  const ok = (step.re ? step.re.test(s) : true) && (step.after ? step.after(events) : true);
  if (ok) {
    log(`STEP ${step.name} matched; screen:\n${s.split('\n').filter(l => l.trim()).slice(-18).join('\n')}\n`);
    if (step.keys) setTimeout(() => { p.write(step.keys); log(`sent ${JSON.stringify(step.keys)}`); }, 1200);
    i++;
    if (step.name === 'done') setTimeout(() => finish('OK'), 1500);
  }
}, 400);

function finish(why) {
  clearInterval(tick);
  log(`FINISH ${why}\nFINAL SCREEN:\n${screen()}`);
  const picked = path.join(dir, 'sandbox', 'picked.txt');
  log(`picked.txt: ${fs.existsSync(picked) ? fs.readFileSync(picked, 'utf8').trim() : '(missing)'}`);
  p.write('\x03'); setTimeout(() => { p.write('\x03'); }, 300);
  setTimeout(() => { p.kill(); server.close(); process.exit(0); }, 2500);
}
