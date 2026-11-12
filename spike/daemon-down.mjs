// With global hooks installed and the daemon down, does plain claude still work quietly?
import pty from 'node-pty';
import path from 'node:path';
import xterm from '@xterm/headless';
const dir = path.dirname(new URL(import.meta.url).pathname);
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE_CODE_|CLAUDECODE|CLAUDE_PID)/.test(k)));
const term = new xterm.Terminal({ cols: 120, rows: 30, allowProposedApi: true });
const p = pty.spawn('claude', ['--model', 'haiku', 'Run `echo hi` with Bash, then reply with just OK'], { name: 'xterm-256color', cols: 120, rows: 30, cwd: path.join(dir, 'sandbox'), env });
p.onData(d => term.write(d)); term.onData(d => p.write(d));
const screen = () => { const b = term.buffer.active; let o = ''; for (let i = 0; i < term.rows; i++) o += (b.getLine(b.viewportY + i)?.translateToString(true) ?? '') + '\n'; return o.replace(/\n{2,}/g, '\n'); };
const start = Date.now();
const t = setInterval(() => {
  const s = screen();
  if (/proceed\?/.test(s)) p.write('1');
  if (/⏺ OK/.test(s) || Date.now() - start > 60000) { clearInterval(t); console.log(s); p.write('\x03'); setTimeout(() => p.write('\x03'), 300); setTimeout(() => { p.kill(); process.exit(0); }, 1500); }
}, 500);
