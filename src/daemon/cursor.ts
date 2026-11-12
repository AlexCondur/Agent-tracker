import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Store } from './store.ts';
import type { HistoryIndex } from './history.ts';
import { gitLocation } from './git.ts';
import type { PendingPrompt, Session } from '../shared/types.ts';

/**
 * Cursor IDE agent chats ("composers"), read from Cursor's own storage. Read-only and undocumented:
 * every field used is listed in ComposerMeta / the bubble queries below; if Cursor changes its
 * format, chats simply stop appearing. Verified against Cursor storage format _v 18 (Nov 2026).
 *
 * Storage: globalStorage/state.vscdb, table cursorDiskKV:
 *   composerData:<id>        chat metadata (name, status, folder, timestamps)
 *   bubbleId:<id>:<bubble>   one message or tool call each
 * globalStorage/storage.json  which Cursor windows are open
 * workspaceStorage/<hash>/    per-folder state; composer.composerData lists the chats open in tabs
 *
 * The database is several GB, so every query goes through the key index (key ranges), and the
 * JSON fields are extracted in SQL rather than loading whole values.
 */

const CURSOR_USER = path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User');
const GLOBAL_DB = path.join(CURSOR_USER, 'globalStorage', 'state.vscdb');
const STORAGE_JSON = path.join(CURSOR_USER, 'globalStorage', 'storage.json');
const WORKSPACES = path.join(CURSOR_USER, 'workspaceStorage');

const POLL_MS = 2000;
const WINDOWS_REFRESH_MS = 10_000;
const FULL_RESCAN_MS = 10 * 60_000;
const SCAN_CHUNK = 200;
/** Chats active this recently are shown in Live even if their tab is closed. */
const LIVE_RECENT_MS = 8 * 3600_000;
/** Chats updated this recently are re-read on every change. */
const HOT_MS = 30 * 60_000;
/** A chat with messages this recent, whose turn isn't marked finished, counts as working (model thinking/streaming). */
const ACTIVE_MS = 60_000;

/** What a chat's messages say about its current turn. */
interface TurnState {
  /** createdAt of the newest message or tool call. */
  latestAt?: number;
  /** The newest tool call is still running (and isn't waiting for you). */
  toolRunning: boolean;
  /** Cursor stamps the turn's final message with turnDurationMs when the turn completes. */
  turnEnded: boolean;
  pending?: Omit<PendingPrompt, 'since'>;
}

const SESSION_PREFIX = 'cursor:';

interface ComposerMeta {
  id: string;
  name: string | null;
  subtitle: string | null;
  status: string | null;
  generating: number | null;
  mode: string | null;
  model: string | null;
  folder: string | null;
  createdAt: number | null;
  lastUpdatedAt: number | null;
  /** Advances while a turn runs, unlike lastUpdatedAt. */
  checkpointAt: number | null;
  isDraft: number | null;
}

const META_COLUMNS = `
  substr(key, 14) AS id,
  json_extract(value, '$.name') AS name,
  json_extract(value, '$.subtitle') AS subtitle,
  json_extract(value, '$.status') AS status,
  json_array_length(json_extract(value, '$.generatingBubbleIds')) AS generating,
  json_extract(value, '$.unifiedMode') AS mode,
  json_extract(value, '$.modelConfig.modelName') AS model,
  json_extract(value, '$.workspaceIdentifier.uri.fsPath') AS folder,
  json_extract(value, '$.createdAt') AS createdAt,
  json_extract(value, '$.lastUpdatedAt') AS lastUpdatedAt,
  json_extract(value, '$.conversationCheckpointLastUpdatedAt') AS checkpointAt,
  json_extract(value, '$.isDraft') AS isDraft`;

const bubbleRange = (id: string): [string, string] => [`bubbleId:${id}:`, `bubbleId:${id};`];

export class CursorWatcher {
  private db?: DatabaseSync;
  private meta = new Map<string, ComposerMeta>();
  private openFolders = new Set<string>();
  /** Chats open in a tab of an open window, with that window's folder. */
  private openTabs = new Map<string, string>();
  private lastStamp = '';
  /** Chats already finished when first seen start out read; only turns that finish later count as unread. */
  private readonly startedAt = Date.now();
  /** While something runs, re-evaluate on every poll so "recent activity" can expire without a write. */
  private anyWorking = false;
  private lastWindowsRefresh = 0;
  private lastFullScan = 0;
  private scanning = false;
  /** Chats whose messages need (re)indexing into history, most recent first. */
  private historyQueue: string[] = [];
  private store: Store;
  private history: HistoryIndex;

  constructor(store: Store, history: HistoryIndex) {
    this.store = store;
    this.history = history;
  }

  start(): void {
    if (!fs.existsSync(GLOBAL_DB)) return; // Cursor not installed
    try {
      this.db = new DatabaseSync(GLOBAL_DB, { readOnly: true });
    } catch (e) {
      console.error(`cursor: cannot open ${GLOBAL_DB}: ${e}`);
      return;
    }
    this.refreshWindows();
    this.fullScan();
    setInterval(() => this.poll(), POLL_MS);
  }

  /** Reads all chat metadata in chunks, then publishes. */
  private fullScan(): void {
    if (this.scanning || !this.db) return;
    this.scanning = true;
    this.lastFullScan = Date.now();
    const q = this.db.prepare(`SELECT ${META_COLUMNS} FROM cursorDiskKV WHERE key > ? AND key < 'composerData;' ORDER BY key LIMIT ${SCAN_CHUNK}`);
    let after = 'composerData:';
    const step = () => {
      try {
        const rows = q.all(after) as unknown as ComposerMeta[];
        for (const r of rows) this.setMeta(r);
        if (rows.length === SCAN_CHUNK) {
          after = `composerData:${rows[rows.length - 1].id}`;
          return void setImmediate(step);
        }
      } catch (e) {
        console.error(`cursor: scan failed: ${e}`);
      }
      this.scanning = false;
      this.publish();
      this.drainHistory();
    };
    step();
  }

  private poll(): void {
    if (!this.db || this.scanning) return;
    if (Date.now() - this.lastWindowsRefresh > WINDOWS_REFRESH_MS) this.refreshWindows();
    if (Date.now() - this.lastFullScan > FULL_RESCAN_MS) return this.fullScan();

    // Only look when Cursor wrote something.
    const stamp = [GLOBAL_DB, `${GLOBAL_DB}-wal`].map(f => fs.statSync(f, { throwIfNoEntry: false })).map(s => `${s?.mtimeMs}:${s?.size}`).join('|');
    if (stamp === this.lastStamp && !this.anyWorking) return;
    this.lastStamp = stamp;

    try {
      // New chats: a key-only scan uses the index and reads no values.
      const keys = this.db.prepare("SELECT substr(key, 14) AS id FROM cursorDiskKV WHERE key > 'composerData:' AND key < 'composerData;'").all() as { id: string }[];
      const hot = new Set(keys.filter(k => !this.meta.has(k.id)).map(k => k.id));
      const now = Date.now();
      for (const m of this.meta.values()) {
        const touched = Math.max(m.lastUpdatedAt ?? 0, m.checkpointAt ?? 0);
        if (this.openTabs.has(m.id) || touched > now - HOT_MS || m.generating || m.status === 'generating') hot.add(m.id);
      }
      const one = this.db.prepare(`SELECT ${META_COLUMNS} FROM cursorDiskKV WHERE key = ?`);
      for (const id of hot) {
        const r = one.get(`composerData:${id}`) as unknown as ComposerMeta | undefined;
        if (r) this.setMeta(r);
      }
    } catch (e) {
      console.error(`cursor: poll failed: ${e}`);
      return;
    }
    this.publish();
    this.drainHistory();
  }

  private setMeta(r: ComposerMeta): void {
    const prev = this.meta.get(r.id);
    // Newer chats can lack workspaceIdentifier; the window that has the chat open in a tab names its folder.
    r.folder ??= this.openTabs.get(r.id) ?? prev?.folder ?? null;
    this.meta.set(r.id, r);
    if (!r.isDraft && r.lastUpdatedAt && r.lastUpdatedAt !== prev?.lastUpdatedAt && !this.historyQueue.includes(r.id)) this.historyQueue.push(r.id);
  }

  /** Open Cursor windows (storage.json) and the chats open in tabs of each (workspaceStorage). */
  private refreshWindows(): void {
    this.lastWindowsRefresh = Date.now();
    try {
      const state = JSON.parse(fs.readFileSync(STORAGE_JSON, 'utf8')) as { windowsState?: { openedWindows?: { folder?: string }[]; lastActiveWindow?: { folder?: string } } };
      const ws = state.windowsState;
      this.openFolders = new Set(
        [...(ws?.openedWindows ?? []), ws?.lastActiveWindow ?? {}].map(w => w.folder).filter((f): f is string => !!f).map(f => decodeURIComponent(new URL(f).pathname)),
      );
    } catch {
      this.openFolders = new Set();
    }
    const tabs = new Map<string, string>();
    for (const dir of fs.readdirSync(WORKSPACES, { withFileTypes: true }).filter(d => d.isDirectory())) {
      try {
        const folderUri = (JSON.parse(fs.readFileSync(path.join(WORKSPACES, dir.name, 'workspace.json'), 'utf8')) as { folder?: string }).folder;
        const folder = folderUri && decodeURIComponent(new URL(folderUri).pathname);
        if (!folder || !this.openFolders.has(folder)) continue;
        const db = new DatabaseSync(path.join(WORKSPACES, dir.name, 'state.vscdb'), { readOnly: true });
        const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData'").get() as { value: string } | undefined;
        db.close();
        const data = row ? (JSON.parse(row.value) as { selectedComposerIds?: string[] }) : {};
        for (const id of data.selectedComposerIds ?? []) tabs.set(id, folder);
      } catch {
        // workspace without composer state
      }
    }
    this.openTabs = tabs;
    for (const [id, folder] of tabs) {
      const m = this.meta.get(id);
      if (m && !m.folder) m.folder = folder;
    }
  }

  /** Pushes the chats that belong in the Live view into the store; others are marked ended. */
  private publish(): void {
    const now = Date.now();
    const live = new Set<string>();
    let anyWorking = false;
    for (const m of this.meta.values()) {
      if (m.isDraft || !m.folder || !this.openFolders.has(m.folder)) continue;
      const touched = Math.max(m.lastUpdatedAt ?? 0, m.checkpointAt ?? 0);
      // The chat record's status isn't kept current while an agent runs (it can still say "aborted" from
      // an earlier turn), so a recently touched chat's own messages decide.
      const turn: TurnState = touched > now - HOT_MS ? this.turnState(m.id) : { toolRunning: false, turnEnded: true };
      // Until the final message is stamped, a running tool or recent messages mean it's working; the
      // time window also ends turns that never get stamped (e.g. stopped mid-way).
      const working =
        !!m.generating || m.status === 'generating' || (!turn.turnEnded && (turn.toolRunning || now - (turn.latestAt ?? 0) < ACTIVE_MS));
      const pending = turn.turnEnded ? undefined : turn.pending;
      anyWorking ||= working || !!pending;
      if (!working && !pending && !this.openTabs.has(m.id) && touched < now - LIVE_RECENT_MS) continue;
      if (!m.name && !m.subtitle && !working) continue; // empty chat
      live.add(SESSION_PREFIX + m.id);
      this.store.upsertExternal(this.toSession(m, working, pending, Math.max(touched, turn.latestAt ?? 0)));
    }
    this.anyWorking = anyWorking;
    for (const s of this.store.list()) if (s.tool === 'cursor' && !live.has(s.id)) this.store.endExternal(s.id);
  }

  private toSession(m: ComposerMeta, working: boolean, pending: TurnState['pending'], touched: number): Session {
    const id = SESSION_PREFIX + m.id;
    const prev = this.store.find(id);
    const lastActivityAt = touched || m.createdAt || Date.now();
    const state: Session['state'] = pending ? 'waiting' : working ? 'working' : 'idle';
    return {
      id,
      tool: 'cursor',
      cwd: m.folder!,
      ...gitLocation(m.folder!),
      name: m.name ?? undefined,
      model: m.model ?? undefined,
      state,
      pending: pending ? { ...pending, since: prev?.pending?.toolName === pending.toolName ? prev.pending.since : Date.now() } : undefined,
      activity: working ? (m.mode === 'agent' ? 'Agent working…' : 'Generating…') : undefined,
      lastMessage: m.subtitle ?? undefined,
      startedAt: m.createdAt ?? lastActivityAt,
      lastActivityAt,
      // Cursor's hasUnreadMessages is never set in practice, so read state is tracked here like for Claude.
      seenAt: prev ? prev.seenAt : state === 'idle' && lastActivityAt < this.startedAt ? lastActivityAt : undefined,
      hooked: true,
      messages: prev?.messages ?? 0,
      tokensIn: 0,
      tokensOut: 0,
      cacheRead: 0,
      cacheWrite: 0,
    };
  }

  /**
   * Reads a chat's messages for its current turn: the newest activity, whether the newest tool call is
   * still running, and whether it waits on you. It waits when that call is still loading and is either an
   * approval request (a command or MCP tool outside the allowlist) or Cursor's ask_question tool.
   */
  private turnState(composerId: string): TurnState {
    const rows = this.db!.prepare(
      `SELECT json_extract(value, '$.createdAt') AS createdAt,
              json_extract(value, '$.turnDurationMs') AS turnDurationMs,
              json_extract(value, '$.toolFormerData.name') AS name,
              json_extract(value, '$.toolFormerData.status') AS status,
              json_extract(value, '$.toolFormerData.additionalData.reviewData.status') AS review,
              json_extract(value, '$.toolFormerData.additionalData.blockReason') AS blockReason,
              substr(json_extract(value, '$.toolFormerData.params'), 1, 8000) AS params
       FROM cursorDiskKV WHERE key > ? AND key < ?`,
    ).all(...bubbleRange(composerId)) as { createdAt: string | null; turnDurationMs: number | null; name: string | null; status: string | null; review: string | null; blockReason: string | null; params: string | null }[];
    rows.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
    const newest = rows.at(-1);
    const latestAt = newest?.createdAt ? Date.parse(newest.createdAt) : undefined;
    const turnEnded = newest?.turnDurationMs != null;
    const last = rows.filter(r => r.name).at(-1);
    if (!last || last.status !== 'loading') return { latestAt, toolRunning: false, turnEnded };

    let params: Record<string, unknown> = {};
    try {
      params = JSON.parse(last.params ?? '{}') as Record<string, unknown>;
    } catch {
      // truncated params
    }
    if (last.name === 'ask_question') {
      const qs = (params.questions as { prompt?: string; options?: { label: string }[] }[] | undefined) ?? [];
      return {
        latestAt,
        toolRunning: false,
        turnEnded,
        pending: {
          kind: 'question',
          toolName: 'ask_question',
          // Same shape as Claude's AskUserQuestion so the dashboard renders it the same way.
          toolInput: { questions: qs.map(q => ({ question: q.prompt ?? String(params.title ?? 'Question'), options: q.options ?? [] })) },
        },
      };
    }
    // Commands outside the allowlist wait with review "Requested"; MCP tools outside it with review "None" and a
    // blockReason. Approved calls keep their blockReason, but their review moves on (e.g. "Done").
    if (last.review === 'Requested' || (last.review === 'None' && last.blockReason)) {
      // MCP calls keep their arguments as a JSON string under tools[0]; show them like a command.
      const mcp = (params.tools as { name?: string; parameters?: string; serverName?: string }[] | undefined)?.[0];
      return {
        latestAt,
        toolRunning: false,
        turnEnded,
        pending: mcp
          ? {
              kind: 'permission',
              toolName: `${mcp.serverName ?? 'MCP'} ${mcp.name ?? last.name}`,
              toolInput: { command: mcp.parameters, blockReason: last.blockReason === 'notInAllowlist' ? 'Not in allowlist' : (last.blockReason ?? undefined) },
            }
          : { kind: 'permission', toolName: last.name!.replace(/_v\d+$/, ''), toolInput: { ...params, blockReason: last.blockReason ?? undefined } },
      };
    }
    return { latestAt, toolRunning: true, turnEnded };
  }

  /** Indexes chat messages into history, one chat per tick (≈20 ms each). */
  private drainHistory(): void {
    if (this.historyDraining) return;
    this.historyQueue.sort((a, b) => (this.meta.get(b)?.lastUpdatedAt ?? 0) - (this.meta.get(a)?.lastUpdatedAt ?? 0));
    this.historyDraining = true;
    const step = () => {
      const id = this.historyQueue.shift();
      const m = id ? this.meta.get(id) : undefined;
      if (!id || !m || !this.db) {
        this.historyDraining = false;
        return;
      }
      try {
        if (this.history.cursorIndexedAt(SESSION_PREFIX + id) !== m.lastUpdatedAt) {
          const bubbles = this.db
            .prepare(
              `SELECT substr(key, 47) AS uuid, json_extract(value, '$.type') AS type, json_extract(value, '$.text') AS text, json_extract(value, '$.createdAt') AS createdAt
               FROM cursorDiskKV WHERE key > ? AND key < ? AND json_extract(value, '$.text') <> ''`,
            )
            .all(...bubbleRange(id)) as { uuid: string; type: number; text: string; createdAt: string | null }[];
          this.history.indexCursorChat({
            id: SESSION_PREFIX + id,
            cwd: m.folder,
            title: m.name,
            model: m.model,
            startedAt: m.createdAt,
            lastAt: m.lastUpdatedAt,
            messages: bubbles.map(b => ({ uuid: b.uuid, role: b.type === 1 ? 'user' : 'assistant', text: b.text, ts: b.createdAt ? Date.parse(b.createdAt) : null })),
          });
        }
      } catch (e) {
        console.error(`cursor: history index failed for ${id}: ${e}`);
      }
      setImmediate(step);
    };
    step();
  }
  private historyDraining = false;
}

/** Brings the Cursor window for a folder to the front (opens it if needed). */
export function cursorOpenArgs(folder: string): [string, string[]] {
  return ['open', ['-a', 'Cursor', folder]];
}
