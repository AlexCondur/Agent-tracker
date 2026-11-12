import { useEffect, useState } from 'react';
import { ago } from '../api.ts';
import { formatCost } from '../models.ts';
import { href } from '../route.ts';

interface HistoryRow {
  id: string;
  tool: 'claude' | 'cursor';
  title: string | null;
  repo: string | null;
  worktree: string | null;
  branch: string | null;
  lastAt: number | null;
  messages: number;
  cost: number | null;
  claudeCost: number | null;
  hits?: number;
  snippet?: string;
}

const PAGE = 50;
const SEARCH_DEBOUNCE_MS = 250;

/** Marks every occurrence of the search words. */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="rounded-sm bg-amber-400/25 text-amber-100">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function HistoryView({ now }: { now: number }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [repo, setRepo] = useState('');
  const [tool, setTool] = useState('');
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [repos, setRepos] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  async function load(offset: number) {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (query) params.set('q', query);
    if (repo) params.set('repo', repo);
    if (tool) params.set('tool', tool);
    const data = (await (await fetch(`/api/history?${params}`)).json()) as { sessions: HistoryRow[]; total: number; repos: string[] };
    setRows(prev => (offset ? [...prev, ...data.sessions] : data.sessions));
    setTotal(data.total);
    setRepos(data.repos);
    setLoading(false);
  }

  useEffect(() => {
    load(0);
  }, [query, repo, tool]);

  const terms = query.split(/\s+/).filter(Boolean);
  return (
    <div className="mx-auto max-w-4xl p-5">
      <div className="mb-4 flex gap-2">
        <input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search all conversations…"
          className="min-w-0 flex-1 rounded-md bg-zinc-900 px-3 py-2 text-sm outline-none ring-1 ring-zinc-800 placeholder:text-zinc-500 focus:ring-sky-500/60"
        />
        <select value={tool} onChange={e => setTool(e.target.value)} className="rounded-md bg-zinc-900 px-2 text-sm text-zinc-300 outline-none ring-1 ring-zinc-800">
          <option value="">Claude + Cursor</option>
          <option value="claude">Claude Code</option>
          <option value="cursor">Cursor</option>
        </select>
        <select
          value={repo}
          onChange={e => setRepo(e.target.value)}
          className="rounded-md bg-zinc-900 px-2 text-sm text-zinc-300 outline-none ring-1 ring-zinc-800"
        >
          <option value="">All repos</option>
          {repos.map(r => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </div>
      <div className="mb-2 text-xs text-zinc-500">
        {loading && !rows.length ? 'Loading…' : `${total} session${total === 1 ? '' : 's'}${query ? ` matching “${query}”` : ''}`}
      </div>
      <div className="divide-y divide-zinc-800/80 overflow-hidden rounded-lg ring-1 ring-zinc-800">
        {rows.map(r => (
          <a key={r.id} href={href({ view: 'history', sessionId: r.id })} className="block bg-zinc-900 px-4 py-3 hover:bg-zinc-800/60">
            <div className="flex items-baseline gap-3">
              {r.tool === 'cursor' && <span className="shrink-0 rounded bg-violet-500/15 px-1 text-[10px] font-medium text-violet-300">Cursor</span>}
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">
                <Highlight text={r.title ?? r.id.slice(0, 8)} terms={terms} />
              </span>
              <span className="shrink-0 text-xs tabular-nums text-zinc-400" title={r.claudeCost != null ? `Claude Code's own total: ${formatCost(r.claudeCost)}` : 'Estimated from transcript tokens'}>
                {r.tool === 'cursor' ? '' : formatCost(r.claudeCost ?? r.cost)}
              </span>
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-zinc-500">{r.lastAt ? ago(r.lastAt, now) : ''}</span>
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
              {r.repo}
              {r.worktree && r.worktree !== r.repo && ` / ${r.worktree}`}
              {r.branch && r.branch.replace(/\//g, '-') !== r.worktree && ` @ ${r.branch}`} · {r.messages} msgs
              {r.hits ? ` · ${r.hits} match${r.hits === 1 ? '' : 'es'}` : ''}
            </div>
            {r.snippet && (
              <p className="mt-1 line-clamp-2 text-xs text-zinc-400">
                <Highlight text={r.snippet} terms={terms} />
              </p>
            )}
          </a>
        ))}
      </div>
      {rows.length < total && (
        <button onClick={() => load(rows.length)} disabled={loading} className="mt-3 w-full rounded-md py-2 text-xs text-zinc-400 ring-1 ring-zinc-800 hover:text-zinc-200">
          {loading ? 'Loading…' : `Load more (${total - rows.length})`}
        </button>
      )}
    </div>
  );
}
