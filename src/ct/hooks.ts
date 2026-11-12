import fs from 'node:fs';
import { CLAUDE_SETTINGS, HOOK_URL } from '../shared/config.ts';

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd'];

interface HookHandler { type: string; url?: string; [k: string]: unknown }
interface HookGroup { matcher?: string; hooks: HookHandler[] }
type Settings = { hooks?: Record<string, HookGroup[]>; [k: string]: unknown };

/**
 * A command hook rather than an http hook: when the daemon is down, curl fails silently,
 * while http hooks print "hook error" lines in every Claude session.
 */
const HOOK_COMMAND = `curl -s -m 2 -o /dev/null -X POST -H 'content-type: application/json' -H "X-CT-Id: \${CT_ID:-}" --data-binary @- ${HOOK_URL} || true`;

const ours = (g: HookGroup) =>
  g.hooks.some(h => (h.type === 'http' && h.url === HOOK_URL) || (h.type === 'command' && typeof h.command === 'string' && h.command.includes(HOOK_URL)));

function read(): Settings {
  return fs.existsSync(CLAUDE_SETTINGS) ? (JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8')) as Settings) : {};
}

function write(s: Settings): void {
  if (fs.existsSync(CLAUDE_SETTINGS)) {
    const backup = `${CLAUDE_SETTINGS}.agent-tracker-${Date.now()}.bak`;
    fs.copyFileSync(CLAUDE_SETTINGS, backup);
    console.log(`backup: ${backup}`);
  }
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(s, null, 2) + '\n');
}

export function installHooks(): void {
  const s = read();
  s.hooks ??= {};
  for (const ev of EVENTS) {
    const groups = (s.hooks[ev] ??= []).filter(g => !ours(g));
    groups.push({
      hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: 5 }],
    });
    s.hooks[ev] = groups;
  }
  write(s);
  console.log(`installed agent-tracker hooks for: ${EVENTS.join(', ')}`);
}

export function uninstallHooks(): void {
  const s = read();
  if (!s.hooks) return console.log('no hooks installed');
  for (const ev of Object.keys(s.hooks)) {
    s.hooks[ev] = s.hooks[ev].filter(g => !ours(g));
    if (s.hooks[ev].length === 0) delete s.hooks[ev];
  }
  if (Object.keys(s.hooks).length === 0) delete s.hooks;
  write(s);
  console.log('removed agent-tracker hooks');
}

export function hooksStatus(): void {
  const s = read();
  const installed = EVENTS.filter(ev => s.hooks?.[ev]?.some(ours));
  console.log(installed.length ? `installed: ${installed.join(', ')}` : 'not installed (run: ct hooks install)');
}
