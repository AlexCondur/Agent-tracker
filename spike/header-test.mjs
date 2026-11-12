// Does an HTTP hook interpolate $CT_ID into a header via allowedEnvVars?
import pty from 'node-pty';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import xterm from '@xterm/headless';
const dir = path.dirname(new URL(import.meta.url).pathname);
const seen = [];
const server = http.createServer((req, res) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { seen.push({ ev: JSON.parse(b).hook_event_name, ct: req.headers['x-ct-id'] }); res.end('{}'); }); }).listen(47822, '127.0.0.1');
const hook = [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:47822/hook', headers: { 'X-CT-Id': '$CT_ID' }, allowedEnvVars: ['CT_ID'], timeout: 5 }] }];
const sp = path.join(dir, 'spike-settings.json');
fs.writeFileSync(sp, JSON.stringify({ hooks: { UserPromptSubmit: hook, Stop: hook, SessionStart: hook } }));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE_CODE_|CLAUDECODE|CLAUDE_PID)/.test(k)));
env.CT_ID = 'test-ct-123';
const term = new xterm.Terminal({ cols: 100, rows: 30, allowProposedApi: true });
const p = pty.spawn('claude', ['--model', 'haiku', '--settings', sp, 'Reply with just OK'], { name: 'xterm-256color', cols: 100, rows: 30, cwd: path.join(dir, 'sandbox'), env });
p.onData(d => term.write(d)); term.onData(d => p.write(d));
const t = setInterval(() => { if (seen.some(s => s.ev === 'Stop') || Date.now() - start > 60000) { clearInterval(t); console.log(JSON.stringify(seen)); p.write('\x03'); setTimeout(() => p.write('\x03'), 300); setTimeout(() => { p.kill(); process.exit(0); }, 1500); } }, 300);
const start = Date.now();
