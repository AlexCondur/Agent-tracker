import { useEffect } from 'react';
import { byStart, isDismissed, isUnread, markSeen, type Session } from './api.ts';
import { useNotifyPreference, useNow, useSessions } from './useSessions.ts';
import { HomeView } from './components/HomeView.tsx';
import { SessionDialog } from './components/SessionDialog.tsx';
import { HistoryView } from './components/HistoryView.tsx';
import { HistoryDetail } from './components/HistoryDetail.tsx';
import { UsageView } from './components/UsageView.tsx';
import { href, navigate, useRoute, type Route } from './route.ts';
import { setFavicon } from './favicon.ts';

/** Header counters, most urgent first. */
const COUNTERS: { key: string; title: string; hint: string; accent: string; match: (s: Session) => boolean }[] = [
  { key: 'waiting', title: 'Needs you', hint: 'needs you', accent: 'text-amber-300', match: s => s.state === 'waiting' },
  { key: 'working', title: 'Working', hint: 'is working', accent: 'text-emerald-300', match: s => s.state === 'working' },
  { key: 'unread', title: 'Your turn', hint: 'is your turn', accent: 'text-sky-300', match: s => s.state === 'idle' && isUnread(s) },
];

const TABS: { view: Route['view']; label: string }[] = [
  { view: 'home', label: 'Home' },
  { view: 'history', label: 'History' },
  { view: 'usage', label: 'Usage' },
];

export function App() {
  const [notify, toggleNotify] = useNotifyPreference();
  const { sessions: all, connected } = useSessions(notify);
  // Dismissed sessions leave Home (and the counters) until they have new activity.
  const sessions = all.filter(s => !isDismissed(s));
  const now = useNow();
  const route = useRoute();
  const selectedId = route.view === 'home' ? route.sessionId : undefined;
  const setSelectedId = (id: string | undefined) => navigate({ view: 'home', sessionId: id });
  const selected = sessions.find(s => s.id === selectedId);
  const waiting = sessions.filter(s => s.state === 'waiting').length;

  // Header counters open the first session of their group, or the next one if one of the group is already open.
  const jumpTo = (group: Session[]) => {
    const i = group.findIndex(s => s.id === selectedId);
    setSelectedId(group[(i + 1) % group.length].id);
  };

  // Looking at a session in the dialog marks it read, including new activity while it's open.
  const selectedUnread = selected ? isUnread(selected) : false;
  useEffect(() => {
    if (!selectedId || !selectedUnread) return;
    const mark = () => document.visibilityState === 'visible' && markSeen(selectedId);
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [selectedId, selectedUnread]);

  useEffect(() => {
    document.title = waiting ? `(${waiting}) Agent Tracker` : 'Agent Tracker';
    setFavicon(waiting > 0);
  }, [waiting]);

  // Esc closes the dialog, except inside the terminal, where it goes to Claude.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) =>
      e.key === 'Escape' && location.hash && !location.hash.startsWith('#/') && !(e.target as HTMLElement).closest('.xterm') && setSelectedId(undefined);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-zinc-800 px-5 py-3">
        <h1 className="text-sm font-semibold tracking-wide text-zinc-100">Agent Tracker</h1>
        <nav className="flex gap-1">
          {TABS.map(t => (
            <a
              key={t.view}
              href={href({ view: t.view } as Route)}
              className={`rounded-md px-2.5 py-1 text-xs ${route.view === t.view ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              {t.label}
            </a>
          ))}
        </nav>
        {COUNTERS.map(({ key, title, hint, accent, match }) => {
          const group = sessions.filter(match).sort(byStart);
          const label = `${group.length} ${title.toLowerCase()}`;
          if (!group.length)
            return (
              <span key={key} className="text-xs text-zinc-600">
                {label}
              </span>
            );
          return (
            <button
              key={key}
              onClick={() => jumpTo(group)}
              className={`cursor-pointer rounded text-xs hover:underline hover:brightness-125 ${accent}`}
              title={`Open the next session that ${hint}`}
            >
              {label}
            </button>
          );
        })}
        <button
          onClick={toggleNotify}
          className={`ml-auto rounded-md px-2 py-1 text-xs ring-1 transition ${notify ? 'text-zinc-200 ring-zinc-600' : 'text-zinc-500 ring-zinc-800 hover:text-zinc-300'}`}
          title={notify ? 'Browser notifications on' : 'Without this, the daemon sends plain macOS notifications'}
        >
          {notify ? 'Notifications on' : 'Enable notifications'}
        </button>
        <span className="flex items-center gap-1.5 text-xs text-zinc-500">
          <span className={`size-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-500'}`} />
          {connected ? 'live' : 'daemon offline'}
        </span>
      </header>

      {route.view === 'home' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <HomeView sessions={sessions} now={now} onOpen={setSelectedId} />
        </div>
      )}
      {route.view === 'history' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {route.sessionId ? <HistoryDetail id={route.sessionId} live={all.find(s => s.id === route.sessionId)} /> : <HistoryView now={now} />}
        </div>
      )}
      {route.view === 'usage' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <UsageView />
        </div>
      )}
      {selected && <SessionDialog session={selected} onClose={() => setSelectedId(undefined)} />}
    </div>
  );
}
