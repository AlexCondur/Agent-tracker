import { execFile, execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { Store } from './store.ts';
import type { Session } from '../shared/types.ts';
import { DAEMON_URL } from '../shared/config.ts';

/** A prompt answered within this long (e.g. in the terminal you're already looking at) isn't worth a notification. */
const WAITING_DELAY_MS = 1500;
/** Only announce "finished" for turns that ran long enough for you to have looked away. */
const FINISHED_MIN_WORK_MS = 30_000;
/**
 * A turn can end with background shells still running; the session then goes back to working within a
 * status scan (2s). Wait this long before announcing "finished", and treat a shorter idle gap as one run.
 */
const FINISHED_DELAY_MS = 3000;

export interface Notification {
  sessionId: string;
  kind: 'question' | 'permission' | 'dialog' | 'finished';
  title: string;
  body: string;
  url: string;
}

function hasCommand(cmd: string): boolean {
  try {
    execFileSync('/usr/bin/which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function describe(s: Session, kind: Notification['kind']): Notification {
  const name = s.customTitle ?? s.name ?? s.worktree ?? s.id.slice(0, 8);
  const where = s.worktree && s.worktree !== name ? ` · ${s.worktree}` : '';
  const url = `${DAEMON_URL}/#${encodeURIComponent(s.id)}`;
  if (kind === 'question') {
    const q = (s.pending?.toolInput as { questions?: { question: string }[] } | undefined)?.questions?.[0]?.question;
    return { sessionId: s.id, kind, url, title: `${name} has a question${where}`, body: q ?? 'Waiting for your answer' };
  }
  if (kind === 'dialog') {
    const d = s.pending?.toolInput as { title?: string } | undefined;
    return { sessionId: s.id, kind, url, title: `${name} is waiting on a dialog${where}`, body: d?.title ?? 'Claude is asking something' };
  }
  if (kind === 'permission') {
    const input = s.pending?.toolInput as Record<string, unknown> | undefined;
    const detail = input?.command ?? input?.file_path ?? input?.url;
    return { sessionId: s.id, kind, url, title: `${name} needs approval${where}`, body: `${s.pending?.toolName}${typeof detail === 'string' ? `: ${detail}` : ''}` };
  }
  return { sessionId: s.id, kind, url, title: `${name} finished${where}`, body: (s.lastMessage ?? 'Your turn').replace(/\s+/g, ' ').slice(0, 200) };
}

/**
 * Decides when a session deserves your attention and emits 'notify' (Notification).
 * Dashboards with notifications enabled show them; with none connected, falls back to a macOS notification.
 */
export class Notifier extends EventEmitter {
  /** Dashboards currently able to show notifications themselves. */
  browserClients = 0;
  private prev = new Map<string, { state: Session['state']; workingSince?: number; idleSince?: number; ranSince?: number }>();
  private timers = new Map<string, NodeJS.Timeout>();
  private hasTerminalNotifier = hasCommand('terminal-notifier');
  private store: Store;

  constructor(store: Store) {
    super();
    this.store = store;
    for (const s of store.list()) this.prev.set(s.id, { state: s.state, workingSince: s.state === 'working' ? s.lastActivityAt : undefined });
    store.on('change', (s: Session) => this.onChange(s));
  }

  private onChange(s: Session): void {
    const before = this.prev.get(s.id);
    const now = Date.now();
    // Back to work right after going idle (background shells): still the same run.
    const resumed = before?.state === 'idle' && before.idleSince !== undefined && now - before.idleSince < FINISHED_DELAY_MS;
    this.prev.set(s.id, {
      state: s.state,
      workingSince: s.state === 'working' ? (before?.state === 'working' ? before.workingSince : resumed ? before.ranSince : now) : undefined,
      idleSince: s.state === 'idle' ? (before?.state === 'idle' ? before.idleSince : now) : undefined,
      ranSince: s.state === 'idle' ? (before?.state === 'working' ? before.workingSince : before?.ranSince) : undefined,
    });
    if (before?.state === s.state) return;

    clearTimeout(this.timers.get(s.id));
    if (s.state === 'waiting' && s.pending) {
      const since = s.pending.since;
      this.timers.set(
        s.id,
        setTimeout(() => {
          const cur = this.store.find(s.id);
          if (cur?.state === 'waiting' && cur.pending?.since === since) this.fire(describe(cur, cur.pending.kind));
        }, WAITING_DELAY_MS),
      );
    } else if (s.state === 'idle' && before?.state === 'working' && before.workingSince && now - before.workingSince >= FINISHED_MIN_WORK_MS) {
      this.timers.set(
        s.id,
        setTimeout(() => {
          const cur = this.store.find(s.id);
          if (cur?.state === 'idle') this.fire(describe(cur, 'finished'));
        }, FINISHED_DELAY_MS),
      );
    }
  }

  private fire(n: Notification): void {
    this.emit('notify', n);
    if (this.browserClients === 0) this.native(n);
  }

  private native(n: Notification): void {
    const onError = () => {};
    if (this.hasTerminalNotifier) {
      execFile('terminal-notifier', ['-title', n.title, '-message', n.body, '-open', n.url, '-group', n.sessionId, '-sound', 'Glass'], onError);
    } else {
      // Not clickable; install terminal-notifier for notifications that open the dashboard.
      const script = 'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"\nend run';
      execFile('osascript', ['-e', script, n.title, n.body], onError);
    }
  }
}
