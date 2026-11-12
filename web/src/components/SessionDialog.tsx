import { sessionTitle, type Session } from '../api.ts';
import { SessionPanel } from './SessionPanel.tsx';
import { stateStyle } from './StatePill.tsx';

/** A session opened from Home: terminal, answers and reply box over the tiles. Esc or a click outside closes it. */
export function SessionDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      // mousedown, not click: a text selection that ends outside the dialog mustn't close it.
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label={sessionTitle(session)} className={`flex h-[88vh] w-full max-w-6xl flex-col rounded-xl bg-zinc-950 p-5 shadow-2xl ring-1 ${stateStyle(session, false).ring}`}>
        <SessionPanel session={session} onClose={onClose} />
      </div>
    </div>
  );
}
