// A built-in dialog (/model picker) must show as waiting/dialog and close from the API.
// Only Esc is used: Enter in /model changes the user's default model.
import pty from 'node-pty';
import path from 'node:path';
import xterm from '@xterm/headless';
const dir = path.dirname(new URL(import.meta.url).pathname);
const sandbox = path.join(dir, 'sandbox');
const API = 'http://127.0.0.1:47800';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async p => (await fetch(API + p)).json();
const post = async (p, b) => (await fetch(API + p, { method: 'POST', body: JSON.stringify(b) })).json();
const t0 = Date.now();
const log = m => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const term = new xterm.Terminal({ cols: 100, rows: 30, allowProposedApi: true });
const p = pty.spawn(path.join(dir, '..', 'bin', 'ct.ts'), ['--model', 'haiku', '-n', 'dialog-test'], { name: 'xterm-256color', cols: 100, rows: 30, cwd: sandbox, env: process.env });
p.onData(d => term.write(d)); term.onData(d => p.write(d));
const find = async (pred, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const s = (await get('/api/sessions')).find(x => x.name === 'dialog-test' && x.ctId && pred(x)); if (s) return s; await sleep(200); } throw new Error('timeout'); };
try {
  let s = await find(() => true);
  log(`session ${s.id.slice(0, 8)} state=${s.state}`);
  await post(`/api/sessions/${s.id}/input`, { text: '/model' });
  s = await find(x => x.pending?.kind === 'dialog');
  const d = s.pending.toolInput;
  if (process.env.SHOW_SCREEN) console.log((await get(`/api/sessions/${s.id}/screen`)).screen);
  log(`DIALOG state=${s.state} title="${d.title}" selected=${d.selected} options=${JSON.stringify(d.options.map(o => `${o.n}:${o.label.slice(0, 30)}`))}`);
  if (process.env.SHOT) {
    const { execFileSync } = await import('node:child_process'); const fs = await import('node:fs'); const os = await import('node:os');
    const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'at-'));
    execFileSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', `--user-data-dir=${prof}`, '--window-size=1300,500', '--timeout=10000', `--screenshot=${path.join(dir, 'shots', '7-dialog.png')}`, `${API}/`], { stdio: 'ignore', timeout: 40000 });
    fs.rmSync(prof, { recursive: true, force: true });
  }
  // move the cursor one down via raw arrow, check the parser follows, then move back
  await post(`/api/sessions/${s.id}/input`, { key: 'down' });
  s = await find(x => x.pending?.toolInput?.selected !== d.selected, 5000);
  log(`after down: selected=${s.pending.toolInput.selected}`);
  // Never press Enter here: /model saves the pick as the default model in ~/.claude/settings.json.
  await post(`/api/sessions/${s.id}/input`, { key: 'esc' });
  s = await find(x => !x.pending, 8000);
  log(`esc closed → state=${s.state}`);
  await post(`/api/sessions/${s.id}/input`, { text: '/model' });
  s = await find(x => x.pending?.kind === 'dialog');
  await post(`/api/sessions/${s.id}/input`, { key: 'esc' });
  s = await find(x => !x.pending, 8000);
  log(`esc closed → state=${s.state}`);
  console.log('PASS');
} catch (e) {
  const b = term.buffer.active; let o = ''; for (let i = 0; i < term.rows; i++) o += (b.getLine(b.viewportY + i)?.translateToString(true) ?? '') + '\n';
  console.log('FAIL', e.message, '\n' + o.replace(/\n{2,}/g, '\n'));
}
const s = (await get('/api/sessions')).find(x => x.name === 'dialog-test');
for (const k of ['ctrl+c', 'ctrl+c']) { await post(`/api/sessions/${s.id}/input`, { key: k }); await sleep(400); }
p.kill(); process.exit(0);
