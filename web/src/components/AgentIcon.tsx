import type { Session } from '../api.ts';
import { rayLines } from '../favicon.ts';

const STATUS_DOT = {
  waiting: 'bg-amber-400',
  working: 'bg-emerald-400',
  idle: 'bg-sky-400',
  ended: 'bg-zinc-600',
} as const;

function Spark() {
  return (
    <svg viewBox="0 0 24 24" className="size-full" aria-hidden>
      {rayLines().map((l, i) => (
        <line key={i} {...l} stroke="#D97757" strokeWidth={2.2} strokeLinecap="round" />
      ))}
    </svg>
  );
}

function Cube() {
  return (
    <svg viewBox="0 0 24 24" className="size-full" aria-hidden>
      <path d="M12 2 21 7 12 12 3 7Z" fill="#e4e4e7" />
      <path d="M3 7 12 12 12 22 3 17Z" fill="#a1a1aa" />
      <path d="M21 7 12 12 12 22 21 17Z" fill="#71717a" />
    </svg>
  );
}

/** The session's agent (Claude spark or Cursor cube), animated by state, with a status dot in the corner. */
export function AgentIcon({ session: s, read }: { session: Session; read: boolean }) {
  const motion = s.state === 'working' ? 'agent-working' : s.state === 'waiting' ? 'agent-waiting' : '';
  return (
    <span className="relative size-[18px] shrink-0" title={s.tool === 'cursor' ? 'Cursor agent' : 'Claude'}>
      <span className={`block size-full ${motion} ${read ? 'opacity-40 grayscale' : ''}`}>{s.tool === 'cursor' ? <Cube /> : <Spark />}</span>
      {!read && <span className={`absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-zinc-900 ${STATUS_DOT[s.state]}`} />}
    </span>
  );
}
