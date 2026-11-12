import { useEffect, useState } from 'react';
import type { Session } from '../api.ts';
import { formatCost, modelGroup, modelName } from '../models.ts';
import { href } from '../route.ts';
import { formatTokens, openInCursor } from '../api.ts';
import { Linkified } from './Linkified.tsx';

interface Detail {
  session: {
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
    cost: number | null;
    claudeCost: number | null;
  };
  messages: { uuid: string; ts: number | null; role: 'user' | 'assistant'; text: string }[];
  usage: { model: string | null; subagent: number; responses: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number | null }[];
  continuedFrom: string | null;
  continuedIn: string | null;
}

const fmtTime = (ts: number | null) => (ts ? new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

export function HistoryDetail({ id, live }: { id: string; live?: Session }) {
  const [detail, setDetail] = useState<Detail | null>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setDetail(undefined);
    fetch(`/api/history/${id}`).then(async r => setDetail(r.ok ? ((await r.json()) as Detail) : null));
  }, [id]);

  if (detail === undefined) return <div className="p-5 text-sm text-zinc-500">Loading…</div>;
  if (detail === null) return <div className="p-5 text-sm text-zinc-500">Not in history yet.</div>;
  const s = detail.session;
  const resume = `cd ${s.cwd} && ct --resume ${s.id}`;

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-5">
      <a href={href({ view: 'history' })} className="text-xs text-zinc-500 hover:text-zinc-300">
        ← History
      </a>
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">
          <Linkified text={s.title ?? s.id} />
        </h2>
        <div className="font-mono text-xs text-zinc-500">
          {s.cwd}
          {s.branch && ` @ ${s.branch}`}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-zinc-500">
          <span>
            {fmtTime(s.startedAt)} – {fmtTime(s.lastAt)}
          </span>
          {s.tool === 'cursor' ? (
            <span>Cursor{s.model ? ` · ${s.model}` : ''}</span>
          ) : (
            <span title="Estimated from transcript tokens; excludes background calls such as auto-mode checks">est. {formatCost(s.cost)}</span>
          )}
          {s.claudeCost != null && <span title="Claude Code's own total for this session">Claude: {formatCost(s.claudeCost)}</span>}
          {detail.continuedFrom && (
            <a className="text-sky-400 hover:underline" href={href({ view: 'history', sessionId: detail.continuedFrom })}>
              continued from earlier session
            </a>
          )}
          {detail.continuedIn && (
            <a className="text-sky-400 hover:underline" href={href({ view: 'history', sessionId: detail.continuedIn })}>
              continued in later session
            </a>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          {live && (
            <a href={href({ view: 'home', sessionId: live.id })} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500">
              Open live session
            </a>
          )}
          {s.tool === 'cursor' ? (
            <button onClick={() => openInCursor(s.id, 'history')} className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500">
              Open in Cursor
            </button>
          ) : (
          <button
            onClick={() => navigator.clipboard.writeText(resume).then(() => setCopied(true))}
            className="rounded-md bg-zinc-800 px-3 py-1.5 font-mono text-xs text-zinc-300 hover:bg-zinc-700"
            title="Copy"
          >
            {copied ? 'copied ✓' : resume}
          </button>
          )}
        </div>
      </div>

      {detail.usage.length > 0 && (
        <table className="w-full text-left text-xs">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 font-normal">Model</th>
              <th className="py-1 text-right font-normal">Responses</th>
              <th className="py-1 text-right font-normal">Input + cache</th>
              <th className="py-1 text-right font-normal">Output</th>
              <th className="py-1 text-right font-normal">Est. cost</th>
            </tr>
          </thead>
          <tbody className="tabular-nums text-zinc-300">
            {detail.usage.map((u, i) => (
              <tr key={i} className="border-t border-zinc-800/80">
                <td className="py-1">
                  <span className="mr-1.5 inline-block size-2 rounded-sm" style={{ background: modelGroup(u.model).color }} />
                  {modelName(u.model)}
                  {u.subagent ? <span className="text-zinc-500"> (subagents)</span> : null}
                </td>
                <td className="py-1 text-right">{u.responses}</td>
                <td className="py-1 text-right">{formatTokens(u.input + u.cacheRead + u.cacheWrite)}</td>
                <td className="py-1 text-right">{formatTokens(u.output)}</td>
                <td className="py-1 text-right">{formatCost(u.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="space-y-3">
        {detail.messages.map(m => (
          <div key={m.uuid} className={m.role === 'user' ? 'ml-12 rounded-lg bg-sky-500/10 px-3 py-2 ring-1 ring-sky-500/20' : 'mr-12 rounded-lg bg-zinc-900 px-3 py-2 ring-1 ring-zinc-800'}>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
              {m.role === 'user' ? 'You' : 'Claude'} · {fmtTime(m.ts)}
            </div>
            <div className="whitespace-pre-wrap break-words text-sm text-zinc-200">{m.text}</div>
          </div>
        ))}
        {!detail.messages.length && <p className="text-sm text-zinc-500">No text messages in this session.</p>}
      </div>
    </div>
  );
}
