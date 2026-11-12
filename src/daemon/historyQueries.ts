import type { DatabaseSync } from 'node:sqlite';
import { localDay } from './transcriptLine.ts';

export interface HistorySession {
  id: string;
  tool: 'claude' | 'cursor';
  model: string | null;
  title: string | null;
  cwd: string | null;
  repo: string | null;
  worktree: string | null;
  branch: string | null;
  startedAt: number | null;
  lastAt: number | null;
  messages: number;
  /** Our estimate from transcript tokens (excludes background calls such as auto-mode checks). */
  cost: number | null;
  /** Claude Code's own total, when recorded and not inflated by a continued session's carried-over history. */
  claudeCost: number | null;
  hits?: number;
  snippet?: string;
}

const SESSION_COLUMNS = `
  s.id, COALESCE((SELECT json_extract(l.data, '$.customTitle') FROM sessions l WHERE l.id = s.id), s.custom_title, s.ai_title, substr(s.first_prompt, 1, 120)) AS title,
  s.cwd, s.repo, s.worktree, s.branch, s.started_at AS startedAt, s.last_at AS lastAt, s.tool, s.model,
  (SELECT count(*) FROM h_messages m WHERE m.session_id = s.id) AS messages,
  (SELECT sum(cost) FROM h_usage u WHERE u.session_id = s.id AND u.copy = 0) AS cost,
  CASE WHEN EXISTS (SELECT 1 FROM h_continuations c WHERE c.to_id = s.id) THEN NULL ELSE s.claude_cost END AS claudeCost`;

const likeTerm = (t: string) => `%${t.replace(/[\\%_]/g, c => `\\${c}`)}%`;
const SNIPPET_RADIUS = 90;

function snippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  const at = Math.max(0, Math.min(...terms.map(t => lower.indexOf(t.toLowerCase())).filter(i => i >= 0)));
  const start = Math.max(0, at - SNIPPET_RADIUS);
  return (start > 0 ? '…' : '') + text.slice(start, at + SNIPPET_RADIUS * 2).replace(/\s+/g, ' ') + (at + SNIPPET_RADIUS * 2 < text.length ? '…' : '');
}

export class HistoryQueries {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  repos(): string[] {
    return (this.db.prepare("SELECT DISTINCT repo FROM h_sessions WHERE repo IS NOT NULL ORDER BY repo").all() as { repo: string }[]).map(r => r.repo);
  }

  /** Sessions newest first; with q, only those whose messages or title contain every word. */
  list(opts: { q?: string; repo?: string; tool?: string; limit: number; offset: number }): { sessions: HistorySession[]; total: number } {
    const repo = opts.repo || null;
    const tool = opts.tool || null;
    const terms = (opts.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6);

    if (!terms.length) {
      const where = `WHERE (? IS NULL OR s.repo = ?) AND (? IS NULL OR s.tool = ?) AND EXISTS (SELECT 1 FROM h_messages m WHERE m.session_id = s.id)`;
      const total = (this.db.prepare(`SELECT count(*) n FROM h_sessions s ${where}`).get(repo, repo, tool, tool) as { n: number }).n;
      const sessions = this.db
        .prepare(`SELECT ${SESSION_COLUMNS} FROM h_sessions s ${where} ORDER BY s.last_at DESC LIMIT ? OFFSET ?`)
        .all(repo, repo, tool, tool, opts.limit, opts.offset) as unknown as HistorySession[];
      return { sessions, total };
    }

    const likes = terms.map(() => `text LIKE ? ESCAPE '\\'`).join(' AND ');
    const hits = new Map<string, { hits: number; snippet: string }>();
    const rows = this.db
      .prepare(`SELECT session_id, text FROM h_messages WHERE ${likes} ORDER BY ts DESC`)
      .all(...terms.map(likeTerm)) as { session_id: string; text: string }[];
    for (const r of rows) {
      const h = hits.get(r.session_id);
      if (h) h.hits++;
      else hits.set(r.session_id, { hits: 1, snippet: snippet(r.text, terms) });
    }
    const titleLikes = terms.map(() => `COALESCE(custom_title, ai_title, first_prompt, '') LIKE ? ESCAPE '\\'`).join(' AND ');
    for (const r of this.db.prepare(`SELECT id FROM h_sessions WHERE ${titleLikes}`).all(...terms.map(likeTerm)) as { id: string }[])
      if (!hits.has(r.id)) hits.set(r.id, { hits: 0, snippet: '' });

    if (!hits.size) return { sessions: [], total: 0 };
    const ids = [...hits.keys()];
    const all = this.db
      .prepare(`SELECT ${SESSION_COLUMNS} FROM h_sessions s WHERE s.id IN (${ids.map(() => '?').join(',')}) AND (? IS NULL OR s.repo = ?) AND (? IS NULL OR s.tool = ?) ORDER BY s.last_at DESC`)
      .all(...ids, repo, repo, tool, tool) as unknown as HistorySession[];
    const sessions = all.slice(opts.offset, opts.offset + opts.limit).map(s => ({ ...s, ...hits.get(s.id) }));
    return { sessions, total: all.length };
  }

  detail(id: string) {
    const session = this.db.prepare(`SELECT ${SESSION_COLUMNS}, s.last_prompt AS lastPrompt FROM h_sessions s WHERE s.id = ?`).get(id) as
      | (HistorySession & { lastPrompt: string | null })
      | undefined;
    if (!session) return undefined;
    const messages = this.db.prepare('SELECT uuid, ts, role, text FROM h_messages WHERE session_id = ? ORDER BY ts, rowid').all(id);
    const usage = this.db
      .prepare(
        `SELECT model, subagent, count(*) AS responses, sum(input) AS input, sum(output) AS output,
                sum(cache_read) AS cacheRead, sum(cache_write) AS cacheWrite, sum(cost) AS cost
         FROM h_usage WHERE session_id = ? AND copy = 0 GROUP BY model, subagent ORDER BY cost DESC`,
      )
      .all(id);
    const continuedFrom = (this.db.prepare('SELECT from_id AS id FROM h_continuations WHERE to_id = ?').get(id) as { id: string } | undefined)?.id ?? null;
    const continuedIn = (this.db.prepare('SELECT to_id AS id FROM h_continuations WHERE from_id = ?').get(id) as { id: string } | undefined)?.id ?? null;
    return { session, messages, usage, continuedFrom, continuedIn };
  }

  folderOf(id: string): { cwd: string | null; tool: string } | undefined {
    return this.db.prepare('SELECT cwd, tool FROM h_sessions WHERE id = ?').get(id) as { cwd: string | null; tool: string } | undefined;
  }

  /** Estimated cost of one session (used to annotate live sessions). */
  sessionCost(id: string): number | null {
    return (this.db.prepare('SELECT sum(cost) AS c FROM h_usage WHERE session_id = ? AND copy = 0').get(id) as { c: number | null }).c;
  }

  usage(days: number) {
    const since = localDay(Date.now() - (days - 1) * 86_400_000);
    const today = localDay(Date.now());
    const sumSince = (day: string | null) =>
      (this.db.prepare('SELECT COALESCE(sum(cost), 0) AS c FROM h_usage WHERE copy = 0 AND (? IS NULL OR day >= ?)').get(day, day) as { c: number }).c;

    const daily = this.db
      .prepare('SELECT day, model, sum(cost) AS cost, sum(output) AS output FROM h_usage WHERE copy = 0 AND day >= ? GROUP BY day, model ORDER BY day')
      .all(since);
    const byRepo = this.db
      .prepare(
        `SELECT COALESCE(s.repo, '(unknown)') AS repo, sum(u.cost) AS cost, count(DISTINCT u.session_id) AS sessions
         FROM h_usage u JOIN h_sessions s ON s.id = u.session_id
         WHERE u.copy = 0 AND u.day >= ? GROUP BY 1 ORDER BY cost DESC`,
      )
      .all(since);
    const topSessions = this.db
      .prepare(
        `SELECT s.id, COALESCE((SELECT json_extract(l.data, '$.customTitle') FROM sessions l WHERE l.id = s.id), s.custom_title, s.ai_title, substr(s.first_prompt, 1, 80)) AS title, s.repo, s.worktree, sum(u.cost) AS cost
         FROM h_usage u JOIN h_sessions s ON s.id = u.session_id
         WHERE u.copy = 0 AND u.day >= ? GROUP BY s.id ORDER BY cost DESC LIMIT 10`,
      )
      .all(since);
    // How our estimate compares with Claude's own totals, over sessions that have both.
    const check = this.db
      .prepare(
        `SELECT sum(s.claude_cost) AS claude, sum((SELECT sum(cost) FROM h_usage u WHERE u.session_id = s.id AND u.copy = 0)) AS ours, count(*) AS sessions
         FROM h_sessions s WHERE s.claude_cost IS NOT NULL AND NOT EXISTS (SELECT 1 FROM h_continuations c WHERE c.to_id = s.id)`,
      )
      .get();
    const unpriced = (this.db.prepare('SELECT count(*) AS n FROM h_usage WHERE copy = 0 AND cost IS NULL AND model IS NOT NULL').get() as { n: number }).n;
    return {
      since,
      totals: { today: sumSince(today), week: sumSince(localDay(Date.now() - 6 * 86_400_000)), month: sumSince(localDay(Date.now() - 29 * 86_400_000)), all: sumSince(null) },
      daily,
      byRepo,
      topSessions,
      check,
      unpriced,
    };
  }
}
