import { setPinned, type Session } from '../api.ts';

/** Always visible on a pinned session; on others it appears on hover (needs a `group` ancestor). */
export function PinButton({ session: s }: { session: Session }) {
  const pinned = !!s.pinnedAt;
  return (
    <button
      onClick={e => {
        e.stopPropagation();
        setPinned(s.id, !pinned);
      }}
      className={`-my-1 shrink-0 rounded p-0.5 transition hover:bg-zinc-800 focus-visible:opacity-100 ${
        pinned ? 'text-sky-300' : 'text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-200'
      }`}
      title={pinned ? 'Unpin' : 'Pin to the top'}
      aria-label={pinned ? 'Unpin' : 'Pin to the top'}
      aria-pressed={pinned}
    >
      <svg viewBox="0 0 16 16" className="size-3.5" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.4} aria-hidden>
        <path d="M6 1.5h4l-.5 4.5 2.5 2.5H4l2.5-2.5z" strokeLinejoin="round" />
        <path d="M8 8.5V14.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}
