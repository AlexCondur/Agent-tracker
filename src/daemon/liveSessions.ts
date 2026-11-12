import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_LIVE_SESSIONS_DIR } from '../shared/config.ts';

/** Shape of ~/.claude/sessions/<pid>.json (undocumented; used as a liveness cross-check only). */
export interface LiveSession {
  pid: number;
  sessionId: string;
  cwd: string;
  name?: string;
  status?: string;
  startedAt?: number;
  kind?: string;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function scanLiveSessions(): LiveSession[] {
  let files: string[];
  try {
    files = fs.readdirSync(CLAUDE_LIVE_SESSIONS_DIR).filter(f => /^\d+\.json$/.test(f));
  } catch {
    return [];
  }
  const out: LiveSession[] = [];
  for (const f of files) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(CLAUDE_LIVE_SESSIONS_DIR, f), 'utf8')) as LiveSession;
      if (s.sessionId && s.pid && isAlive(s.pid)) out.push(s);
    } catch {
      // file being rewritten; next scan picks it up
    }
  }
  return out;
}
