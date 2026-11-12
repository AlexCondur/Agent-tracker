import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { CLAUDE_PROJECTS_DIR } from '../shared/config.ts';
import { costOf } from './pricing.ts';
import { gitLocation } from './git.ts';
import { localDay, modelOf, parseLine, textOf, type TranscriptLine } from './transcriptLine.ts';

const RESCAN_MS = 5000;
/** Bump when parsing changes; the index is then rebuilt from the transcripts (a few seconds). */
const INDEX_VERSION = 4;
const READ_CHUNK = 4 * 1024 * 1024;

/**
 * Index of every Claude Code transcript on disk: session metadata, message text for search,
 * and per-response token usage with estimated cost. Incremental: each file is read from where
 * the last pass stopped. Subagent transcripts count toward their parent session's cost.
 *
 * A continued session (A "continued-in" B) starts B's transcript with a copy of A's history under B's id.
 * Rows are kept per session so B's transcript reads complete, but B's copies of A's responses are
 * flagged `copy` and left out of cost totals, so each response is paid for once, by the session that ran it.
 */
export class HistoryIndex {
  private db: DatabaseSync;
  private queue: string[] = [];
  private running = false;
  /** Called after a pass that changed anything. */
  onUpdate: () => void = () => {};

  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec('CREATE TABLE IF NOT EXISTS h_meta (key TEXT PRIMARY KEY, value TEXT)');
    const version = (db.prepare("SELECT value FROM h_meta WHERE key = 'version'").get() as { value: string } | undefined)?.value;
    if (version !== String(INDEX_VERSION)) {
      db.exec('DROP TABLE IF EXISTS h_files; DROP TABLE IF EXISTS h_sessions; DROP TABLE IF EXISTS h_messages; DROP TABLE IF EXISTS h_usage; DROP TABLE IF EXISTS h_continuations;');
      db.prepare("INSERT OR REPLACE INTO h_meta (key, value) VALUES ('version', ?)").run(String(INDEX_VERSION));
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS h_files (path TEXT PRIMARY KEY, offset INTEGER NOT NULL, mtime REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS h_sessions (
        id TEXT PRIMARY KEY, cwd TEXT, repo TEXT, worktree TEXT, branch TEXT,
        custom_title TEXT, ai_title TEXT, first_prompt TEXT, last_prompt TEXT,
        started_at INTEGER, last_at INTEGER, claude_cost REAL,
        tool TEXT NOT NULL DEFAULT 'claude', model TEXT, cursor_indexed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS h_messages (
        uuid TEXT NOT NULL, session_id TEXT NOT NULL, ts INTEGER, role TEXT, text TEXT, PRIMARY KEY (uuid, session_id)
      );
      CREATE INDEX IF NOT EXISTS h_messages_session ON h_messages(session_id, ts);
      CREATE TABLE IF NOT EXISTS h_usage (
        message_id TEXT NOT NULL, session_id TEXT NOT NULL, ts INTEGER, day TEXT, model TEXT,
        input INTEGER, output INTEGER, cache_read INTEGER, cache_write INTEGER, cost REAL, subagent INTEGER,
        copy INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (message_id, session_id)
      );
      CREATE TABLE IF NOT EXISTS h_continuations (from_id TEXT NOT NULL, to_id TEXT NOT NULL, PRIMARY KEY (from_id, to_id));
      CREATE INDEX IF NOT EXISTS h_usage_day ON h_usage(day);
      CREATE INDEX IF NOT EXISTS h_usage_session ON h_usage(session_id);
    `);
  }

  start(): void {
    this.scan();
    setInterval(() => this.scan(), RESCAN_MS);
  }

  /** Queues every transcript that grew or changed since it was last indexed. */
  private scan(): void {
    const known = new Map(
      (this.db.prepare('SELECT path, offset, mtime FROM h_files').all() as { path: string; offset: number; mtime: number }[]).map(r => [r.path, r]),
    );
    for (const file of listTranscripts()) {
      let st: fs.Stats;
      try {
        st = fs.statSync(file);
      } catch {
        continue;
      }
      const k = known.get(file);
      if (!k || st.size !== k.offset || st.mtimeMs !== k.mtime) if (!this.queue.includes(file)) this.queue.push(file);
    }
    this.drain();
  }

  /** One file per tick so a large backfill doesn't block hooks and the dashboard. */
  private drain(): void {
    if (this.running) return;
    const file = this.queue.shift();
    if (!file) return;
    this.running = true;
    setImmediate(() => {
      try {
        this.indexFile(file);
      } catch (e) {
        console.error(`history: failed to index ${file}: ${e}`);
      }
      this.running = false;
      if (this.queue.length === 0) this.onUpdate();
      this.drain();
    });
  }

  private indexFile(file: string): void {
    const st = fs.statSync(file);
    const row = this.db.prepare('SELECT offset FROM h_files WHERE path = ?').get(file) as { offset: number } | undefined;
    let offset = row && row.offset <= st.size ? row.offset : 0;
    const subagent = file.includes(`${path.sep}subagents${path.sep}`);
    const fileSessionId = subagent ? path.basename(path.dirname(path.dirname(file))) : path.basename(file, '.jsonl');

    const fd = fs.openSync(file, 'r');
    this.db.exec('BEGIN');
    try {
      // Work in bytes so multi-byte characters split across chunks stay intact.
      // `committed` is the byte after the last complete line; `pending` holds the bytes from there on.
      let committed = offset;
      let readPos = offset;
      let pending = Buffer.alloc(0);
      while (readPos < st.size) {
        const buf = Buffer.alloc(Math.min(READ_CHUNK, st.size - readPos));
        fs.readSync(fd, buf, 0, buf.length, readPos);
        readPos += buf.length;
        const data = Buffer.concat([pending, buf]);
        const lastNl = data.lastIndexOf(0x0a);
        if (lastNl < 0) {
          pending = data;
          continue;
        }
        for (const raw of data.subarray(0, lastNl).toString('utf8').split('\n')) {
          const l = raw && parseLine(raw);
          if (l) this.applyLine(l, fileSessionId, subagent);
        }
        committed += lastNl + 1;
        pending = data.subarray(lastNl + 1);
      }
      offset = committed; // a trailing partial line is re-read once it's complete
      this.db
        .prepare('INSERT INTO h_files (path, offset, mtime) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET offset = excluded.offset, mtime = excluded.mtime')
        .run(file, offset, st.mtimeMs);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    } finally {
      fs.closeSync(fd);
    }
  }

  private applyLine(l: TranscriptLine, fileSessionId: string, subagent: boolean): void {
    const sessionId = l.sessionId ?? fileSessionId;
    const ts = l.timestamp ? Date.parse(l.timestamp) : undefined;
    this.ensureSession(sessionId, l, ts);

    switch (l.type) {
      case 'custom-title':
        if (l.customTitle) this.db.prepare('UPDATE h_sessions SET custom_title = ? WHERE id = ?').run(l.customTitle, sessionId);
        return;
      case 'ai-title':
        if (l.aiTitle) this.db.prepare('UPDATE h_sessions SET ai_title = ? WHERE id = ?').run(l.aiTitle, sessionId);
        return;
      case 'last-prompt':
        if (l.lastPrompt) this.db.prepare('UPDATE h_sessions SET last_prompt = ? WHERE id = ?').run(l.lastPrompt, sessionId);
        return;
      case 'continued-in': {
        const to = (l as { continuedInSessionId?: string }).continuedInSessionId;
        if (!to) return;
        this.db.prepare('INSERT OR IGNORE INTO h_continuations (from_id, to_id) VALUES (?, ?)').run(sessionId, to);
        this.db
          .prepare('UPDATE h_usage SET copy = 1 WHERE session_id = ? AND message_id IN (SELECT message_id FROM h_usage WHERE session_id = ?)')
          .run(to, sessionId);
        return;
      }
      case 'cost-state':
        if (typeof l.totalCostUSD === 'number') this.db.prepare('UPDATE h_sessions SET claude_cost = ? WHERE id = ?').run(l.totalCostUSD, sessionId);
        return;
    }

    if (l.type === 'assistant' && l.message?.id && l.message.usage) {
      const u = l.message.usage;
      const model = modelOf(l);
      this.db
        .prepare(
          `INSERT OR IGNORE INTO h_usage (message_id, session_id, ts, day, model, input, output, cache_read, cache_write, cost, subagent, copy)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             EXISTS (SELECT 1 FROM h_continuations c JOIN h_usage o ON o.session_id = c.from_id
                     WHERE c.to_id = ? AND o.message_id = ?))`,
        )
        .run(
          l.message.id, sessionId, ts ?? null, ts ? localDay(ts) : null, model ?? null,
          u.input_tokens ?? 0, u.output_tokens ?? 0, u.cache_read_input_tokens ?? 0, u.cache_creation_input_tokens ?? 0,
          costOf(model, u) ?? null, subagent ? 1 : 0, sessionId, l.message.id,
        );
      // If a later session already holds a copy of this response, that copy is now known to be one.
      this.db
        .prepare(
          'UPDATE h_usage SET copy = 1 WHERE message_id = ? AND session_id IN (SELECT to_id FROM h_continuations WHERE from_id = ?)',
        )
        .run(l.message.id, sessionId);
    }

    // Searchable text: the main conversation only.
    if (subagent || l.isSidechain) return;
    const text = textOf(l);
    if (!text || !l.uuid) return;
    this.db.prepare('INSERT OR IGNORE INTO h_messages (uuid, session_id, ts, role, text) VALUES (?, ?, ?, ?, ?)').run(l.uuid, sessionId, ts ?? null, l.type!, text);
    if (l.type === 'user') this.db.prepare('UPDATE h_sessions SET first_prompt = ? WHERE id = ? AND first_prompt IS NULL').run(text.slice(0, 500), sessionId);
  }

  /** lastUpdatedAt of a Cursor chat when it was last indexed, to skip unchanged chats. */
  cursorIndexedAt(id: string): number | null {
    return (this.db.prepare('SELECT cursor_indexed_at AS t FROM h_sessions WHERE id = ?').get(id) as { t: number | null } | undefined)?.t ?? null;
  }

  /** Stores a Cursor chat and its messages (no cost: Cursor doesn't record per-chat token usage). */
  indexCursorChat(c: {
    id: string;
    cwd: string | null;
    title: string | null;
    model: string | null;
    startedAt: number | null;
    lastAt: number | null;
    messages: { uuid: string; role: 'user' | 'assistant'; text: string; ts: number | null }[];
  }): void {
    const loc = c.cwd ? gitLocation(c.cwd) : undefined;
    const firstPrompt = c.messages.filter(m => m.role === 'user').sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))[0]?.text.slice(0, 500) ?? null;
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT INTO h_sessions (id, cwd, repo, worktree, custom_title, first_prompt, started_at, last_at, tool, model, cursor_indexed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'cursor', ?, ?)
           ON CONFLICT(id) DO UPDATE SET cwd = excluded.cwd, repo = excluded.repo, worktree = excluded.worktree,
             custom_title = excluded.custom_title, first_prompt = COALESCE(excluded.first_prompt, h_sessions.first_prompt),
             started_at = excluded.started_at, last_at = excluded.last_at, model = excluded.model, cursor_indexed_at = excluded.cursor_indexed_at`,
        )
        .run(c.id, c.cwd, loc?.repo ?? null, loc?.worktree ?? null, c.title, firstPrompt, c.startedAt, c.lastAt, c.model, c.lastAt);
      // REPLACE: a message still streaming when last indexed has grown since.
      const ins = this.db.prepare('INSERT OR REPLACE INTO h_messages (uuid, session_id, ts, role, text) VALUES (?, ?, ?, ?, ?)');
      for (const m of c.messages) ins.run(m.uuid, c.id, m.ts, m.role, m.text);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  private ensureSession(id: string, l: TranscriptLine, ts: number | undefined): void {
    const loc = l.cwd ? gitLocation(l.cwd) : undefined;
    this.db
      .prepare(
        `INSERT INTO h_sessions (id, cwd, repo, worktree, branch, started_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           cwd = COALESCE(h_sessions.cwd, excluded.cwd),
           repo = COALESCE(h_sessions.repo, excluded.repo),
           worktree = COALESCE(h_sessions.worktree, excluded.worktree),
           branch = COALESCE(excluded.branch, h_sessions.branch),
           started_at = MIN(COALESCE(h_sessions.started_at, excluded.started_at), COALESCE(excluded.started_at, h_sessions.started_at)),
           last_at = MAX(COALESCE(h_sessions.last_at, excluded.last_at), COALESCE(excluded.last_at, h_sessions.last_at))`,
      )
      .run(id, l.cwd ?? null, loc?.repo ?? null, loc?.worktree ?? null, l.gitBranch && l.gitBranch !== 'HEAD' ? l.gitBranch : null, ts ?? null, ts ?? null);
  }
}

/** Main transcripts (projects/<dir>/<id>.jsonl) and subagent transcripts (projects/<dir>/<id>/subagents/*.jsonl). */
function listTranscripts(): string[] {
  const out: string[] = [];
  let dirs: string[];
  try {
    dirs = fs.readdirSync(CLAUDE_PROJECTS_DIR);
  } catch {
    return out;
  }
  for (const d of dirs) {
    const dir = path.join(CLAUDE_PROJECTS_DIR, d);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) out.push(path.join(dir, e.name));
      else if (e.isDirectory()) {
        const sub = path.join(dir, e.name, 'subagents');
        try {
          for (const f of fs.readdirSync(sub)) if (f.endsWith('.jsonl')) out.push(path.join(sub, f));
        } catch {
          // no subagents
        }
      }
    }
  }
  return out;
}
