import { ago, byPinned, byStart, dismiss, isUnread, openInCursor, questionsOf, sessionTitle, type Session } from '../api.ts';
import { Critter } from './critter/Critter.tsx';
import { formatCost } from '../models.ts';
import { AgentIcon } from './AgentIcon.tsx';
import { Linkified } from './Linkified.tsx';
import { PinButton } from './PinButton.tsx';
import { StatePill, stateStyle } from './StatePill.tsx';
import { PromptActions } from './PromptActions.tsx';
import { ReplyBox } from './ReplyBox.tsx';

/** One line on what the critter is up to: the command running, the question, or the last reply. */
function caption(s: Session): { text: string; className: string } {
  if (s.state === 'waiting') {
    const p = s.pending;
    const text =
      p?.kind === 'question' ? (questionsOf(s)[0]?.question ?? 'Has a question') : p?.kind === 'dialog' ? ((p.toolInput as { title?: string }).title ?? 'Waiting on a dialog') : `Wants to run ${p?.toolName ?? 'a tool'}`;
    return { text, className: 'text-amber-200' };
  }
  if (s.state === 'working') return { text: s.activity ?? 'Thinking…', className: 'font-mono text-xs text-emerald-300/90 break-all' };
  return { text: s.lastMessage ?? s.firstPrompt ?? '', className: isUnread(s) ? 'text-zinc-300' : 'text-zinc-500' };
}

function AgentTile({ session: s, now, onOpen }: { session: Session; now: number; onOpen: () => void }) {
  const read = s.state === 'idle' && !isUnread(s);
  const style = stateStyle(s);
  const cap = caption(s);
  const showBranch = !!s.branch && s.branch.replace(/\//g, '-') !== s.worktree;
  return (
    <div onClick={onOpen} className={`group flex min-w-0 cursor-pointer flex-col gap-3 rounded-xl bg-zinc-900 p-4 ring-1 transition hover:bg-zinc-900/80 ${style.ring}`}>
      <div className="flex items-center gap-2.5">
        <AgentIcon session={s} read={read} />
        <span className="truncate text-base font-medium text-zinc-100">
          <Linkified text={sessionTitle(s)} />
        </span>
        {s.tool === 'cursor' && <span className="rounded bg-violet-500/15 px-1 text-[10px] font-medium text-violet-300">Cursor</span>}
        <StatePill session={s} />
        <span className="ml-auto shrink-0 text-xs tabular-nums text-zinc-500">{ago(s.lastActivityAt, now)}</span>
        <PinButton session={s} />
        {s.state === 'idle' && !s.pinnedAt && (
          <button
            onClick={e => {
              e.stopPropagation();
              dismiss(s.id);
            }}
            className="-my-1 -mr-1 shrink-0 rounded px-1 text-sm leading-none text-zinc-600 opacity-0 transition group-hover:opacity-100 hover:bg-zinc-800 hover:text-zinc-200 focus-visible:opacity-100"
            title="Remove from the list (it comes back when it has new activity)"
            aria-label="Remove from the list"
          >
            ×
          </button>
        )}
      </div>
      <div className="-mt-1.5 truncate font-mono text-[11px] text-zinc-500">
        {s.repo ?? s.cwd}
        {s.worktree && s.worktree !== s.repo && <span className="text-zinc-400"> / {s.worktree}</span>}
        {showBranch && <span> @ {s.branch}</span>}
        {s.cost ? <span className="ml-2 text-zinc-600">{formatCost(s.cost)}</span> : null}
      </div>

      <div className="flex h-36 items-center gap-4 rounded-lg bg-black/30 px-3">
        <Critter session={s} className="h-28 shrink-0" />
        {cap.text && <p className={`line-clamp-4 min-w-0 flex-1 text-sm ${cap.className}`}>{cap.text}</p>}
      </div>

      {s.state === 'waiting' && s.pending && <PromptActions session={s} onOpen={onOpen} />}

      {s.state === 'idle' && <ReplyBox session={s} />}
      {s.tool === 'cursor' && s.state !== 'waiting' && (
        <button
          className="self-start rounded-md px-2 py-1 text-xs text-violet-300 ring-1 ring-violet-500/30 hover:bg-violet-500/10"
          onClick={e => {
            e.stopPropagation();
            openInCursor(s.id);
          }}
        >
          Open in Cursor
        </button>
      )}
    </div>
  );
}

/**
 * Every agent as a big tile in a fixed order so tiles never swap places while they work: pinned first, then
 * active ones oldest first, then a Read section. State shows in the ring, pill and critter instead.
 */
export function HomeView({ sessions, now, onOpen }: { sessions: Session[]; now: number; onOpen: (id: string) => void }) {
  // Pinned first (in pin order, even once read), then the other active ones oldest first.
  const pinned = sessions.filter(s => s.pinnedAt).sort(byPinned);
  const active = [...pinned, ...sessions.filter(s => !s.pinnedAt && (s.state !== 'idle' || isUnread(s))).sort(byStart)];
  const read = sessions.filter(s => !s.pinnedAt && s.state === 'idle' && !isUnread(s)).sort(byStart);
  return (
    <div className="p-5">
      {sessions.length === 0 && (
        <p className="text-sm text-zinc-500">
          No running sessions. Start one with <code className="text-zinc-300">ct</code>.
        </p>
      )}
      {active.length === 0 && sessions.length > 0 && <p className="mb-6 text-sm text-zinc-500">Nothing running and nothing waiting on you.</p>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(480px,1fr))] gap-4">
        {active.map(s => (
          <AgentTile key={s.id} session={s} now={now} onOpen={() => onOpen(s.id)} />
        ))}
      </div>
      {read.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Read <span className="text-zinc-600">{read.length}</span>
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(480px,1fr))] gap-4">
            {read.map(s => (
              <AgentTile key={s.id} session={s} now={now} onOpen={() => onOpen(s.id)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
