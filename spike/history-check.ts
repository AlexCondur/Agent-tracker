// Backfills the history index into a scratch DB and compares estimated cost with Claude's own cost-state.
import { DatabaseSync } from 'node:sqlite';
import { HistoryIndex } from '../src/daemon/history.ts';

const db = new DatabaseSync('/tmp/at-hist.sqlite');
const h = new HistoryIndex(db);
const t0 = Date.now();
h.onUpdate = () => {
  console.log(`indexed in ${Date.now() - t0}ms`);
  const q = (sql: string) => db.prepare(sql).all();
  console.log(q('SELECT count(*) sessions FROM h_sessions'), q('SELECT count(*) messages FROM h_messages'), q('SELECT count(*) responses, sum(copy) copies, round(sum(cost) FILTER (WHERE copy = 0),2) cost, sum(cost IS NULL) unpriced FROM h_usage'));
  console.log('unpriced models:', q('SELECT model, count(*) n FROM h_usage WHERE cost IS NULL GROUP BY model'));
  const rows = q(`SELECT s.id, s.claude_cost, (SELECT sum(cost) FROM h_usage u WHERE u.session_id = s.id AND copy = 0) ours,
                         (SELECT sum(cost) FROM h_usage u WHERE u.session_id = s.id AND subagent = 0 AND copy = 0) ours_main
                  FROM h_sessions s WHERE claude_cost IS NOT NULL ORDER BY claude_cost DESC LIMIT 12`) as { id: string; claude_cost: number; ours: number; ours_main: number }[];
  for (const r of rows) console.log(r.id.slice(0, 8), 'claude', r.claude_cost.toFixed(3), 'ours', (r.ours ?? 0).toFixed(3), 'ours(main only)', (r.ours_main ?? 0).toFixed(3));
  console.log(q(`SELECT coalesce(custom_title, ai_title, substr(first_prompt,1,50)) title, repo, worktree, branch FROM h_sessions ORDER BY last_at DESC LIMIT 6`));
  process.exit(0);
};
h.start();
