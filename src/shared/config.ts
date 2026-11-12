import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();
export const DATA_DIR = process.env.AGENT_TRACKER_DIR ?? path.join(HOME, '.agent-tracker');
export const DB_PATH = path.join(DATA_DIR, 'db.sqlite');
export const CT_SOCKET = path.join(DATA_DIR, 'ct.sock');
export const DAEMON_LOG = path.join(DATA_DIR, 'daemon.log');
/** Signals and exits of `ct` wrappers, for diagnosing sessions that die. */
export const CT_LOG = path.join(DATA_DIR, 'ct.log');
/** Symlink to node that ct and the daemon run under, so `killall node` spares them (see src/ct/node.ts). */
export const CT_NODE = path.join(DATA_DIR, 'bin', 'ct-node');
export const PORT = Number(process.env.AGENT_TRACKER_PORT ?? 47800);
export const DAEMON_URL = `http://127.0.0.1:${PORT}`;
export const HOOK_URL = `${DAEMON_URL}/hooks`;

export const CLAUDE_DIR = path.join(HOME, '.claude');
export const CLAUDE_SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
export const CLAUDE_LIVE_SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');
export const CLAUDE_PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

/** Claude stores transcripts under ~/.claude/projects/<cwd with non-alphanumerics replaced by '-'>/<sessionId>.jsonl */
export function transcriptPathFor(cwd: string, sessionId: string): string {
  return path.join(CLAUDE_PROJECTS_DIR, cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`);
}
