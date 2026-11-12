import path from 'node:path';
import { DAEMON_URL } from '../shared/config.ts';
import type { Session } from '../shared/types.ts';
import { isDaemonUp } from './daemon.ts';

const color = (code: number, s: string) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const STATE_COLOR = { waiting: 33, working: 32, idle: 2, ended: 90 } as const;

async function api<T>(p: string, init?: RequestInit): Promise<T> {
  if (!(await isDaemonUp())) {
    console.error('daemon is not running (it starts with the first `ct` session, or run: ct daemon)');
    process.exit(1);
  }
  const res = await fetch(DAEMON_URL + p, init);
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    console.error(body.error ?? res.statusText);
    process.exit(1);
  }
  return body;
}

function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
}

function detail(s: Session): string {
  if (s.pending?.kind === 'question') {
    const q = (s.pending.toolInput as { questions?: { question: string; options?: { label: string }[] }[] })?.questions?.[0];
    return q ? `? ${q.question} [${q.options?.map((o, i) => `${i + 1}:${o.label}`).join(' ')}]` : '? question';
  }
  if (s.pending?.kind === 'dialog') return `dialog: ${(s.pending.toolInput as { title?: string })?.title ?? ''}`;
  if (s.pending) return `needs approval: ${s.pending.toolName}`;
  return s.activity ?? s.lastMessage?.replace(/\s+/g, ' ') ?? s.firstPrompt ?? '';
}

export async function ls(all: boolean): Promise<void> {
  const sessions = await api<Session[]>(`/api/sessions${all ? '?all' : ''}`);
  if (!sessions.length) return console.log('no sessions');
  const width = process.stdout.columns || 160;
  for (const s of sessions) {
    const state = color(STATE_COLOR[s.state], s.state.padEnd(7));
    const where = `${path.basename(s.cwd)}${s.branch ? `@${s.branch}` : ''}`;
    const reply = s.ctId ? color(36, 'ct') : '  ';
    const head = `${state} ${s.id.slice(0, 8)} ${reply} ${ago(s.lastActivityAt).padStart(4)}  ${(s.name ?? '').slice(0, 18).padEnd(18)} ${where.slice(0, 32).padEnd(32)} `;
    console.log(head + detail(s).slice(0, Math.max(10, width - 80)));
  }
}

export async function send(id: string, args: string[]): Promise<void> {
  const keyIdx = args.indexOf('--key');
  const body = keyIdx >= 0 ? { key: args[keyIdx + 1] } : { text: args.join(' ') };
  await api(`/api/sessions/${id}/input`, { method: 'POST', body: JSON.stringify(body) });
}

export async function screen(id: string): Promise<void> {
  console.log((await api<{ screen: string }>(`/api/sessions/${id}/screen`)).screen);
}
