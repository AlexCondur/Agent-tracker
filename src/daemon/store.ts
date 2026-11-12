import { EventEmitter } from 'node:events';
import { gitLocation } from './git.ts';
import type { Db } from './db.ts';
import type { PtyBroker, CtConn } from './ptyBroker.ts';
import { applyHook, type HookPayload } from './hookState.ts';
import { TranscriptTailer } from './transcripts.ts';
import { scanLiveSessions } from './liveSessions.ts';
import { transcriptPathFor } from '../shared/config.ts';
import type { Session, SessionState } from '../shared/types.ts';

/** Sessions with no liveness signal are ended only after this long without activity (covers `claude -p`). */
const END_GRACE_MS = 30_000;
const MAX_EVENT_PAYLOAD = 10_000;

const STATE_ORDER: Record<SessionState, number> = { waiting: 0, working: 1, idle: 2, ended: 3 };

/** Single source of truth for session state. Emits 'change' (session) on every update. */
export class Store extends EventEmitter {
  private sessions = new Map<string, Session>();
  private tailers = new Map<string, TranscriptTailer>();
  private dirty = new Set<string>();
  /** ctId -> session currently running under that wrapper */
  private ctSession = new Map<string, string>();

  private db: Db;
  private broker: PtyBroker;

  constructor(db: Db, broker: PtyBroker) {
    super();
    this.db = db;
    this.broker = broker;
    for (const s of db.loadSessions()) {
      s.ctId = undefined; // wrappers reconnect and re-link
      this.sessions.set(s.id, s);
    }
    broker.on('connect', (c: CtConn) => this.linkByPid(c));
    broker.on('exit', (c: CtConn) => this.endCt(c.ctId));
    broker.on('disconnect', (c: CtConn) => this.unlinkCt(c.ctId));
    broker.on('dialog', (c: CtConn) => this.onDialog(c));
  }

  start(): void {
    this.scanLive();
    setInterval(() => this.scanLive(), 2000);
    setInterval(() => this.pollTranscripts(), 1000);
    setInterval(() => this.flush(), 1000);
  }

  list(includeEnded = false): Session[] {
    return [...this.sessions.values()]
      .filter(s => includeEnded || s.state !== 'ended')
      .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.lastActivityAt - a.lastActivityAt);
  }

  /** Resolves a full id or unique prefix. */
  find(idOrPrefix: string): Session | undefined {
    const exact = this.sessions.get(idOrPrefix);
    if (exact) return exact;
    const matches = [...this.sessions.values()].filter(s => s.id.startsWith(idOrPrefix));
    return matches.length === 1 ? matches[0] : undefined;
  }

  /** Sessions owned by another watcher (Cursor): replaces the stored copy, emitting only on change. */
  upsertExternal(next: Session): void {
    const prev = this.sessions.get(next.id);
    // Dashboard-side state (read, dismissed, pinned, renamed) isn't known to the watcher; keep it.
    const merged = {
      ...next,
      seenAt: next.seenAt ?? prev?.seenAt,
      dismissedAt: next.dismissedAt ?? prev?.dismissedAt,
      pinnedAt: prev?.pinnedAt,
      customTitle: prev?.customTitle,
    };
    if (prev && JSON.stringify(prev) === JSON.stringify(merged)) return;
    this.sessions.set(next.id, merged);
    this.changed(this.sessions.get(next.id)!);
  }

  endExternal(id: string): void {
    const s = this.sessions.get(id);
    if (!s || s.state === 'ended') return;
    s.state = 'ended';
    s.pending = s.activity = undefined;
    this.changed(s);
  }

  markSeen(s: Session): void {
    s.seenAt = Date.now();
    this.changed(s);
  }

  /** Hides it from Live until its next activity; dismissing also counts as having read it. */
  dismiss(s: Session): void {
    s.seenAt = s.dismissedAt = Date.now();
    this.changed(s);
  }

  setPinned(s: Session, pinned: boolean): void {
    s.pinnedAt = pinned ? Date.now() : undefined;
    this.changed(s);
  }

  /** An empty title restores the session's own name. */
  rename(s: Session, title: string): void {
    s.customTitle = title.trim() || undefined;
    this.changed(s);
  }

  onHook(h: HookPayload, ctId: string | undefined): void {
    // Cursor runs the hooks in ~/.claude/settings.json too; its chats are tracked from its own storage
    // (cursor.ts), so its events would only add empty, folderless "Claude" sessions.
    if (!h.session_id || 'cursor_version' in h) return;
    const now = Date.now();
    const s = this.ensure(h.session_id, h.cwd, now);
    s.background = undefined; // hooks describe the turn itself; scanLive re-applies background work after it ends
    applyHook(s, h, now);
    // A turn can end with background shells still running; check Claude's status soon rather than at the next scan.
    if (h.hook_event_name === 'Stop') setTimeout(() => this.scanLive(), 500).unref();
    // CT_ID is inherited by everything Claude starts, including other sessions hosted by Claude Code's own
    // background daemon, so a hook's CT_ID alone doesn't make a session that wrapper's: its claude process
    // must be the wrapper's child. Otherwise two sessions keep taking the wrapper from each other (and each
    // marks the other ended). Unknown pid: the next scan links by pid instead.
    const wrapper = ctId ? this.broker.conns.get(ctId) : undefined;
    s.pid ??= scanLiveSessions().find(l => l.sessionId === s.id)?.pid;
    if (wrapper && s.state !== 'ended' && s.pid === wrapper.pid) this.link(wrapper.ctId, s);
    // A hook (e.g. Stop) may have cleared a dialog that is still on screen.
    const conn = s.ctId ? this.broker.conns.get(s.ctId) : undefined;
    if (conn?.dialog && !s.pending && s.state !== 'ended') this.onDialog(conn);
    if (h.hook_event_name === 'SessionEnd') this.ctSession.forEach((sid, ct) => sid === s.id && this.ctSession.delete(ct));
    const payload = JSON.stringify(h);
    this.db.addEvent(s.id, now, h.hook_event_name, payload.length > MAX_EVENT_PAYLOAD ? { truncated: payload.slice(0, MAX_EVENT_PAYLOAD) } : h);
    this.pollTranscript(s);
    this.changed(s);
  }

  private ensure(id: string, cwd: string, now: number): Session {
    let s = this.sessions.get(id);
    if (!s) {
      s = {
        id, tool: 'claude', cwd, state: 'idle', startedAt: now, lastActivityAt: now, hooked: false,
        messages: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0,
        transcriptPath: transcriptPathFor(cwd, id),
      };
      this.sessions.set(id, s);
    }
    if (!s.repo) Object.assign(s, gitLocation(s.cwd));
    return s;
  }

  private link(ctId: string, s: Session): void {
    const prev = this.ctSession.get(ctId);
    if (prev === s.id) return;
    // Same wrapper, new session id (/clear, /resume): the previous session is over.
    const old = prev ? this.sessions.get(prev) : undefined;
    if (old && old.state !== 'ended') {
      old.state = 'ended';
      old.ctId = old.pending = old.activity = undefined;
      this.changed(old);
    }
    this.ctSession.set(ctId, s.id);
    s.ctId = ctId;
    const conn = this.broker.conns.get(ctId);
    if (conn?.dialog) queueMicrotask(() => this.onDialog(conn));
  }

  private linkByPid(c: CtConn): void {
    const s = [...this.sessions.values()].find(x => x.pid === c.pid && x.state !== 'ended');
    if (s) {
      this.link(c.ctId, s);
      this.changed(s);
    }
  }

  /** Claude's own dialogs, seen on screen. Hook-reported prompts (permission/question) take precedence. */
  private onDialog(c: CtConn): void {
    const s = this.sessions.get(this.ctSession.get(c.ctId) ?? '');
    if (!s || s.state === 'ended') return;
    if (c.dialog && (!s.pending || s.pending.kind === 'dialog')) {
      s.pending = {
        kind: 'dialog',
        toolName: 'dialog',
        toolInput: c.dialog,
        since: s.pending?.since ?? Date.now(),
        resumeState: s.pending?.resumeState ?? s.state,
      };
      s.state = 'waiting';
      this.changed(s);
    } else if (!c.dialog && s.pending?.kind === 'dialog') {
      this.closeDialog(s);
      this.changed(s);
    }
  }

  private closeDialog(s: Session): void {
    s.state = s.pending?.resumeState === 'waiting' ? 'idle' : (s.pending?.resumeState ?? 'idle');
    s.pending = undefined;
  }

  private unlinkCt(ctId: string): void {
    const s = this.sessions.get(this.ctSession.get(ctId) ?? '');
    this.ctSession.delete(ctId);
    if (s?.ctId === ctId) {
      s.ctId = undefined;
      if (s.pending?.kind === 'dialog') this.closeDialog(s); // can't see the screen anymore
      this.changed(s);
    }
  }

  private endCt(ctId: string): void {
    const s = this.sessions.get(this.ctSession.get(ctId) ?? '');
    if (s && s.state !== 'ended') {
      s.state = 'ended';
      s.pending = s.activity = undefined;
      this.changed(s);
    }
  }

  private scanLive(): void {
    const now = Date.now();
    const alive = new Set<string>();
    for (const l of scanLiveSessions()) {
      alive.add(l.sessionId);
      const s = this.ensure(l.sessionId, l.cwd, l.startedAt ?? now);
      let changed = false;
      if (l.name && s.name !== l.name) (s.name = l.name), (changed = true);
      if (s.pid !== l.pid) (s.pid = l.pid), (changed = true);
      if (s.state === 'ended') (s.state = 'idle'), (changed = true); // resumed
      // Claude's own status: "busy" in a turn, "idle" or "waiting" between turns, anything else (e.g. "shell")
      // while background shells or agents still run after the turn ended.
      const background = !!l.status && !['busy', 'idle', 'waiting'].includes(l.status);
      // Before any hook arrives (e.g. sessions started before hooks were installed), trust Claude's own status.
      if (!s.hooked) {
        const st: SessionState = l.status === 'busy' || background ? 'working' : l.status === 'waiting' ? 'waiting' : 'idle';
        if (s.state !== st) (s.state = st), (changed = true);
      } else if (background && s.state === 'idle') {
        s.state = 'working';
        s.activity = l.status === 'shell' ? 'Background shell running' : `Background work running (${l.status})`;
        s.background = true;
        changed = true;
      } else if (!background && s.background) {
        // Finished without a new turn (a new turn would have cleared the flag through its hooks).
        s.background = undefined;
        if (s.state === 'working') (s.state = 'idle'), (s.activity = undefined);
        changed = true;
      }
      for (const [ctId, c] of this.broker.conns) if (c.pid === l.pid && s.ctId !== ctId) (this.link(ctId, s), (changed = true));
      if (changed) this.changed(s);
    }
    for (const s of this.sessions.values()) {
      if (s.tool !== 'claude' || s.state === 'ended' || alive.has(s.id) || s.ctId) continue;
      if (now - s.lastActivityAt < END_GRACE_MS) continue;
      s.state = 'ended';
      s.pending = s.activity = undefined;
      this.changed(s);
    }
  }

  private pollTranscripts(): void {
    for (const s of this.sessions.values()) if (s.state !== 'ended' && s.tool === 'claude') this.pollTranscript(s);
  }

  private pollTranscript(s: Session): void {
    if (!s.transcriptPath) return;
    let t = this.tailers.get(s.id);
    if (!t || t.path !== s.transcriptPath) this.tailers.set(s.id, (t = new TranscriptTailer(s.transcriptPath)));
    if (t.poll(s)) this.changed(s);
  }

  private changed(s: Session): void {
    this.dirty.add(s.id);
    this.emit('change', s);
  }

  flush(): void {
    for (const id of this.dirty) {
      const s = this.sessions.get(id);
      if (s) this.db.saveSession(s);
    }
    this.dirty.clear();
  }
}
