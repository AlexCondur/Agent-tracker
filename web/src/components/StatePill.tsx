import { isUnread, type Session } from '../api.ts';

const STATE_STYLE = {
  waiting: { label: 'Needs you', ring: 'ring-amber-400/60', pill: 'bg-amber-400/15 text-amber-300' },
  working: { label: 'Working', ring: 'ring-emerald-500/30', pill: 'bg-emerald-400/10 text-emerald-300' },
  idle: { label: 'Your turn', ring: 'ring-sky-500/40', pill: 'bg-sky-400/10 text-sky-300' },
  ended: { label: 'Ended', ring: 'ring-zinc-800', pill: 'bg-zinc-800 text-zinc-400' },
} as const;
const READ_STYLE = { label: 'Read', ring: 'ring-zinc-800', pill: 'bg-zinc-800 text-zinc-400' };

/**
 * Label and colours for a session's state. With showRead, an idle session you've already looked at is
 * "Read" (lists); without it (the open session itself) it stays "Your turn".
 */
export function stateStyle(s: Session, showRead = true) {
  return showRead && s.state === 'idle' && !isUnread(s) ? READ_STYLE : STATE_STYLE[s.state];
}

export function StatePill({ session, showRead = true }: { session: Session; showRead?: boolean }) {
  const style = stateStyle(session, showRead);
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${style.pill}`}>{style.label}</span>;
}
