import { useEffect, useState } from 'react';
import type { Session } from './api.ts';

const STATE_ORDER = { waiting: 0, working: 1, idle: 2, ended: 3 } as const;

interface NotifyEvent {
  sessionId: string;
  title: string;
  body: string;
}

/** Shows a daemon notification unless you're already looking at the dashboard. Click opens the session. */
function showNotification(n: NotifyEvent): void {
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  const notification = new Notification(n.title, { body: n.body, tag: n.sessionId });
  notification.onclick = () => {
    window.focus();
    location.hash = encodeURIComponent(n.sessionId);
    notification.close();
  };
}

/**
 * Live session list from the daemon's event stream. EventSource reconnects and gets a fresh snapshot.
 * With notify, this dashboard shows notifications and the daemon skips its macOS fallback.
 */
export function useSessions(notify: boolean): { sessions: Session[]; connected: boolean } {
  const [byId, setById] = useState<Map<string, Session>>(new Map());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource(notify ? '/api/events?notify=1' : '/api/events');
    if (notify) es.addEventListener('notify', e => showNotification(JSON.parse(e.data) as NotifyEvent));
    es.addEventListener('snapshot', e => {
      setById(new Map((JSON.parse(e.data) as Session[]).map(s => [s.id, s])));
      setConnected(true);
    });
    es.addEventListener('session', e => {
      const s = JSON.parse(e.data) as Session;
      setById(prev => {
        const next = new Map(prev);
        if (s.state === 'ended') next.delete(s.id);
        else next.set(s.id, s);
        return next;
      });
    });
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [notify]);

  const sessions = [...byId.values()].sort(
    (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.lastActivityAt - a.lastActivityAt,
  );
  return { sessions, connected };
}

const NOTIFY_PREF = 'agent-tracker.notify';

/** Browser notifications: on when permission is granted and not switched off here. */
export function useNotifyPreference(): [boolean, () => void] {
  const supported = typeof Notification !== 'undefined';
  const [enabled, setEnabled] = useState(() => supported && Notification.permission === 'granted' && localStorage.getItem(NOTIFY_PREF) !== 'off');
  const toggle = async () => {
    if (!supported) return;
    if (enabled) {
      localStorage.setItem(NOTIFY_PREF, 'off');
      return setEnabled(false);
    }
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    localStorage.setItem(NOTIFY_PREF, 'on');
    setEnabled(permission === 'granted');
  };
  return [enabled, toggle];
}

/** Re-renders every `ms` so relative times stay fresh. */
export function useNow(ms = 5000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
