import { useState } from 'react';
import { formatTokens, openInCursor, renameSession, sessionTitle, type Session } from '../api.ts';
import { formatCost } from '../models.ts';
import { href } from '../route.ts';
import { Linkified } from './Linkified.tsx';
import { AgentIcon } from './AgentIcon.tsx';
import { PinButton } from './PinButton.tsx';
import { StatePill } from './StatePill.tsx';
import { PromptActions } from './PromptActions.tsx';
import { ReplyBox } from './ReplyBox.tsx';
import { redraw, TerminalView } from './TerminalView.tsx';

/** The session's title; click it to rename. Enter saves, Esc cancels, an empty name restores the original. */
function EditableTitle({ session: s }: { session: Session }) {
  const [draft, setDraft] = useState<string>();
  const save = () => {
    if (draft !== undefined && draft.trim() !== (s.customTitle ?? '')) renameSession(s.id, draft);
    setDraft(undefined);
  };
  if (draft === undefined)
    return (
      <h2 className="min-w-0 cursor-text truncate text-base font-semibold text-zinc-100" title="Click to rename" onClick={() => setDraft(s.customTitle ?? sessionTitle(s))}>
        <Linkified text={sessionTitle(s)} />
      </h2>
    );
  return (
    <input
      autoFocus
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onFocus={e => e.target.select()}
      onBlur={save}
      onKeyDown={e => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') {
          e.stopPropagation(); // don't also close the panel
          setDraft(undefined);
        }
      }}
      placeholder={s.name ?? s.worktree ?? 'Name'}
      className="w-full min-w-0 rounded bg-zinc-900 px-1.5 py-0.5 text-base font-semibold text-zinc-100 outline-none ring-1 ring-sky-500/60"
    />
  );
}

export function SessionPanel({ session: s, onClose }: { session: Session; onClose: () => void }) {
  const resume = `cd ${s.cwd} && ct --resume ${s.id}`;
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="group flex items-center gap-2.5">
            <AgentIcon session={s} read={false} />
            <EditableTitle session={s} />
            {s.tool === 'cursor' && <span className="shrink-0 rounded bg-violet-500/15 px-1 text-[10px] font-medium text-violet-300">Cursor</span>}
            <StatePill session={s} showRead={false} />
            <PinButton session={s} />
          </div>
          <div className="truncate font-mono text-xs text-zinc-500">
            {s.cwd}
            {s.branch && ` @ ${s.branch}`}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-zinc-500">
            {s.model && <span>{s.model}</span>}
            {s.tool === 'claude' && (
              <>
                <span>{s.messages} msgs</span>
                <span>
                  {formatTokens(s.tokensIn + s.cacheRead + s.cacheWrite)} in / {formatTokens(s.tokensOut)} out
                </span>
              </>
            )}
            {s.cost ? <span title="Estimated from transcript tokens">{formatCost(s.cost)}</span> : null}
            <a className="hover:text-zinc-300" href={href({ view: 'history', sessionId: s.id })}>
              full transcript
            </a>
            {s.tool === 'claude' && (
              <button className="hover:text-zinc-300" title={resume} onClick={() => navigator.clipboard.writeText(resume)}>
                copy resume cmd
              </button>
            )}
            {s.ctId && (
              <button className="hover:text-zinc-300" title="Ask Claude to redraw its screen (Ctrl+L)" onClick={() => redraw(s.id)}>
                redraw
              </button>
            )}
          </div>
        </div>
        <button onClick={onClose} className="rounded px-2 text-lg leading-none text-zinc-500 hover:text-zinc-200" title="Close (Esc)">
          ×
        </button>
      </div>

      {s.state === 'waiting' && s.pending && (
        <div className="rounded-lg bg-amber-500/5 p-3 ring-1 ring-amber-400/30">
          <PromptActions session={s} onOpen={() => {}} />
        </div>
      )}

      {s.tool === 'cursor' ? (
        <div className="space-y-3 rounded-lg bg-zinc-900 p-4 text-sm text-zinc-400 ring-1 ring-zinc-800">
          <p>Cursor agent chat{s.model ? ` · ${s.model}` : ''}. Cursor can’t be controlled from outside, so replies happen in Cursor.</p>
          <button className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500" onClick={() => openInCursor(s.id)}>
            Open in Cursor
          </button>
          {s.lastMessage && (
            <div>
              <div className="text-xs uppercase tracking-wide text-zinc-600">Latest</div>
              <p className="whitespace-pre-wrap text-zinc-300">{s.lastMessage}</p>
            </div>
          )}
        </div>
      ) : s.ctId ? (
        <>
          <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-black p-2 ring-1 ring-zinc-800">
            <TerminalView key={s.ctId} sessionId={s.id} />
          </div>
          <ReplyBox session={s} autoFocus showCommands />
        </>
      ) : (
        <div className="space-y-3 rounded-lg bg-zinc-900 p-4 text-sm text-zinc-400 ring-1 ring-zinc-800">
          <p>
            This session was started with plain <code className="text-zinc-300">claude</code>, so there’s no live terminal and it can’t be answered from
            here. Start sessions with <code className="text-zinc-300">ct</code> to get both.
          </p>
          {s.firstPrompt && (
            <div>
              <div className="text-xs uppercase tracking-wide text-zinc-600">First prompt</div>
              <p className="whitespace-pre-wrap text-zinc-300">{s.firstPrompt}</p>
            </div>
          )}
          {s.lastMessage && (
            <div>
              <div className="text-xs uppercase tracking-wide text-zinc-600">Last reply</div>
              <p className="whitespace-pre-wrap text-zinc-300">{s.lastMessage}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
