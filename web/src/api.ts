import type { Session } from '../../src/shared/types.ts';

export type { Session };

export type InputBody = { text: string } | { key: string } | { data: string } | { option: number };

export async function sendInput(id: string, body: InputBody): Promise<void> {
  const res = await fetch(`/api/sessions/${id}/input`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? res.statusText);
}

/** Brings the Cursor window for this chat to the front. */
export function openInCursor(id: string, from: 'live' | 'history' = 'live'): void {
  fetch(from === 'live' ? `/api/sessions/${encodeURIComponent(id)}/focus` : `/api/history/${encodeURIComponent(id)}/focus`, { method: 'POST' }).catch(() => {});
}

export function markSeen(id: string): void {
  fetch(`/api/sessions/${encodeURIComponent(id)}/seen`, { method: 'POST' }).catch(() => {});
}

export function setPinned(id: string, pinned: boolean): void {
  fetch(`/api/sessions/${encodeURIComponent(id)}/pin`, { method: 'POST', body: JSON.stringify({ pinned }) }).catch(() => {});
}

/** An empty title restores the session's own name. */
export function renameSession(id: string, title: string): void {
  fetch(`/api/sessions/${encodeURIComponent(id)}/rename`, { method: 'POST', body: JSON.stringify({ title }) }).catch(() => {});
}

export interface SavedCommand {
  name: string;
  description?: string;
  argumentHint?: string;
}

/** Your Claude Code commands (~/.claude/commands), run in a session as /<name>. */
export async function fetchCommands(): Promise<SavedCommand[]> {
  const res = await fetch('/api/commands');
  return res.ok ? ((await res.json()) as SavedCommand[]) : [];
}

/** Removes it from Live until it has new activity. */
export function dismiss(id: string): void {
  fetch(`/api/sessions/${encodeURIComponent(id)}/dismiss`, { method: 'POST' }).catch(() => {});
}

export function isDismissed(s: Session): boolean {
  return s.dismissedAt != null && s.dismissedAt >= s.lastActivityAt;
}

/** Oldest session first: a fixed order, so sessions don't swap places every time one of them updates. */
export const byStart = (a: Session, b: Session) => a.startedAt - b.startedAt || a.id.localeCompare(b.id);
/** Pinned sessions in the order they were pinned. */
export const byPinned = (a: Session, b: Session) => (a.pinnedAt ?? 0) - (b.pinnedAt ?? 0) || byStart(a, b);

/** Finished since you last looked at it. */
export function isUnread(s: Session): boolean {
  return s.state === 'idle' && (s.seenAt ?? 0) < s.lastActivityAt;
}

export interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options?: { label: string; description?: string }[];
}

export function questionsOf(s: Session): Question[] {
  return (s.pending?.toolInput as { questions?: Question[] } | undefined)?.questions ?? [];
}

export interface Dialog {
  title: string;
  body?: string;
  options: { n: number; label: string }[];
  selected?: number;
}

export function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
}

export function sessionTitle(s: Session): string {
  return s.customTitle ?? s.name ?? s.worktree ?? s.id.slice(0, 8);
}

export function formatTokens(n: number): string {
  return n < 1000 ? String(n) : n < 1_000_000 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1_000_000).toFixed(1)}M`;
}
