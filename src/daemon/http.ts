import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { Store } from './store.ts';
import type { PtyBroker, CtConn } from './ptyBroker.ts';
import type { HookPayload } from './hookState.ts';
import type { Notifier, Notification } from './notifier.ts';
import type { HistoryQueries } from './historyQueries.ts';
import type { Session } from '../shared/types.ts';
import { PORT } from '../shared/config.ts';
import { execFile } from 'node:child_process';
import { cursorOpenArgs } from './cursor.ts';
import { listCommands } from './commands.ts';

/** Named keys accepted by POST /api/sessions/:id/input {key}; single printable characters pass through. */
const KEYS: Record<string, string> = {
  enter: '\r', esc: '\x1b', tab: '\t', 'shift+tab': '\x1b[Z', up: '\x1b[A', down: '\x1b[B',
  left: '\x1b[D', right: '\x1b[C', backspace: '\x7f', 'ctrl+c': '\x03', space: ' ',
};
/** Pause between typing text and pressing Enter, so the TUI doesn't treat Enter as part of a paste. */
const SUBMIT_DELAY_MS = 150;
const SSE_HEARTBEAT_MS = 15_000;
const WEB_DIST = path.join(import.meta.dirname, '..', '..', 'web', 'dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

/** The Vite dev server proxies to us during development. */
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`, 'http://localhost:5173', 'http://127.0.0.1:5173']);
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

/**
 * This API can type into terminals, so a web page open in the browser must not reach it.
 * Host check blocks DNS rebinding; Origin check blocks cross-site requests (curl and ct send no Origin).
 */
function isTrusted(req: http.IncomingMessage): boolean {
  if (!ALLOWED_HOSTS.has(req.headers.host ?? '')) return false;
  const origin = req.headers.origin;
  return origin === undefined || ALLOWED_ORIGINS.has(origin);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let b = '';
    req.setEncoding('utf8');
    req.on('data', c => (b += c));
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

/** Opens a server-sent events stream; returns a send function. cleanup runs when the client goes away. */
function sse(req: http.IncomingMessage, res: http.ServerResponse, cleanup: () => void) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), SSE_HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(heartbeat);
    cleanup();
  });
  return (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function serveStatic(pathname: string, res: http.ServerResponse): void {
  const file = path.join(WEB_DIST, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  const target = file.startsWith(WEB_DIST) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(WEB_DIST, 'index.html');
  if (!fs.existsSync(target)) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('dashboard not built: run `npm run build`');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(target)] ?? 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
}

export function createHttpServer(store: Store, broker: PtyBroker, notifier: Notifier, history: HistoryQueries): http.Server {
  /** Live sessions carry their estimated cost from the history index. */
  const withCost = (s: Session) => ({ ...s, cost: history.sessionCost(s.id) });

  return http.createServer(async (req, res) => {
    try {
      if (!isTrusted(req)) return json(res, 403, { error: 'forbidden' });
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

      if (req.method === 'POST' && url.pathname === '/hooks') {
        const ctId = req.headers['x-ct-id'];
        store.onHook(JSON.parse(await readBody(req)) as HookPayload, typeof ctId === 'string' && ctId ? ctId : undefined);
        return json(res, 200, {}); // no decision: Claude shows its normal prompt
      }

      if (parts[0] !== 'api') return serveStatic(url.pathname, res);

      if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, pid: process.pid });

      if (req.method === 'GET' && url.pathname === '/api/commands') return json(res, 200, listCommands());

      if (req.method === 'GET' && url.pathname === '/api/sessions') return json(res, 200, store.list(url.searchParams.has('all')).map(withCost));

      if (req.method === 'GET' && url.pathname === '/api/history') {
        const limit = Math.min(200, Number(url.searchParams.get('limit') ?? 50));
        const offset = Number(url.searchParams.get('offset') ?? 0);
        return json(res, 200, {
          ...history.list({
            q: url.searchParams.get('q') ?? undefined,
            repo: url.searchParams.get('repo') ?? undefined,
            tool: url.searchParams.get('tool') ?? undefined,
            limit,
            offset,
          }),
          repos: history.repos(),
        });
      }

      if (req.method === 'POST' && parts[1] === 'history' && parts[2] && parts[3] === 'focus') {
        const loc = history.folderOf(parts[2]);
        if (loc?.tool !== 'cursor' || !loc.cwd) return json(res, 409, { error: 'only Cursor chats can be opened' });
        const [cmd, args] = cursorOpenArgs(loc.cwd);
        execFile(cmd, args, () => {});
        return json(res, 200, { ok: true });
      }

      if (req.method === 'GET' && parts[1] === 'history' && parts[2]) {
        const detail = history.detail(parts[2]);
        return detail ? json(res, 200, detail) : json(res, 404, { error: 'session not in history' });
      }

      if (req.method === 'GET' && url.pathname === '/api/usage') {
        return json(res, 200, history.usage(Math.min(365, Number(url.searchParams.get('days') ?? 30))));
      }

      // Live session list: a snapshot, then every change. ?notify=1: this dashboard shows notifications itself.
      if (req.method === 'GET' && url.pathname === '/api/events') {
        const notifies = url.searchParams.get('notify') === '1';
        const onChange = (s: Session) => send('session', withCost(s));
        const onNotify = (n: Notification) => send('notify', n);
        const send = sse(req, res, () => {
          store.off('change', onChange);
          notifier.off('notify', onNotify);
          if (notifies) notifier.browserClients--;
        });
        send('snapshot', store.list().map(withCost));
        store.on('change', onChange);
        notifier.on('notify', onNotify);
        if (notifies) notifier.browserClients++;
        return;
      }

      if (parts[1] === 'sessions' && parts[2]) {
        const s = store.find(parts[2]);
        if (!s) return json(res, 404, { error: 'session not found (or prefix is ambiguous)' });

        if (req.method === 'GET' && !parts[3]) return json(res, 200, withCost(s));

        if (req.method === 'GET' && parts[3] === 'screen') {
          const screen = s.ctId ? broker.screen(s.ctId) : undefined;
          return screen === undefined ? json(res, 409, { error: 'session is not running under ct' }) : json(res, 200, { screen });
        }

        // Live terminal: current contents, then raw output as it happens.
        if (req.method === 'GET' && parts[3] === 'terminal') {
          const ctId = s.ctId;
          const snap = ctId ? broker.snapshot(ctId) : undefined;
          if (!ctId || !snap) return json(res, 409, { error: 'session is not running under ct' });
          const onOutput = (c: CtConn, data: string) => c.ctId === ctId && send('output', data);
          const onResize = (c: CtConn) => c.ctId === ctId && send('resize', { cols: c.term.cols, rows: c.term.rows });
          const onGone = (c: CtConn) => c.ctId === ctId && send('end', {});
          const send = sse(req, res, () => {
            broker.off('output', onOutput);
            broker.off('resize', onResize);
            broker.off('disconnect', onGone);
          });
          send('init', snap);
          broker.on('output', onOutput);
          broker.on('resize', onResize);
          broker.on('disconnect', onGone);
          return;
        }

        // Bring the window this session runs in to the front (Cursor chats: their project window).
        if (req.method === 'POST' && parts[3] === 'focus') {
          if (s.tool !== 'cursor') return json(res, 409, { error: 'only Cursor sessions can be focused' });
          const [cmd, args] = cursorOpenArgs(s.cwd);
          execFile(cmd, args, () => {});
          return json(res, 200, { ok: true });
        }

        if (req.method === 'POST' && parts[3] === 'seen') {
          store.markSeen(s);
          return json(res, 200, { ok: true });
        }

        if (req.method === 'POST' && parts[3] === 'dismiss') {
          store.dismiss(s);
          return json(res, 200, { ok: true });
        }

        if (req.method === 'POST' && parts[3] === 'pin') {
          const body = JSON.parse((await readBody(req)) || '{}') as { pinned?: boolean };
          store.setPinned(s, body.pinned !== false);
          return json(res, 200, { ok: true });
        }

        if (req.method === 'POST' && parts[3] === 'rename') {
          const body = JSON.parse((await readBody(req)) || '{}') as { title?: string };
          store.rename(s, String(body.title ?? '').slice(0, 200));
          return json(res, 200, { ok: true });
        }

        if (req.method === 'POST' && parts[3] === 'input') {
          if (!s.ctId) return json(res, 409, { error: 'session is not running under ct; cannot type into it' });
          const body = JSON.parse((await readBody(req)) || '{}') as { text?: string; key?: string; data?: string; submit?: boolean; option?: number };
          const ctId = s.ctId;
          if (body.option !== undefined) {
            // Not every dialog accepts number keys; moving the ❯ cursor and pressing Enter works in all of them.
            const dialog = broker.conns.get(ctId)?.dialog;
            const from = dialog?.options.findIndex(o => o.n === dialog.selected) ?? -1;
            const to = dialog?.options.findIndex(o => o.n === body.option) ?? -1;
            if (!dialog || from < 0 || to < 0) return json(res, 409, { error: 'no dialog with that option on screen' });
            broker.write(ctId, (to > from ? KEYS.down : KEYS.up).repeat(Math.abs(to - from)));
            setTimeout(() => broker.write(ctId, '\r'), SUBMIT_DELAY_MS);
          } else if (body.data !== undefined) {
            broker.write(ctId, body.data); // raw keystrokes from the dashboard terminal
          } else if (body.key !== undefined) {
            const seq = KEYS[body.key.toLowerCase()] ?? (body.key.length === 1 ? body.key : undefined);
            if (seq === undefined) return json(res, 400, { error: `unknown key "${body.key}"`, keys: Object.keys(KEYS) });
            broker.write(ctId, seq);
          } else if (body.text) {
            // Multi-line text goes in as a bracketed paste so newlines don't submit early.
            broker.write(ctId, body.text.includes('\n') ? `\x1b[200~${body.text}\x1b[201~` : body.text);
            if (body.submit !== false) setTimeout(() => broker.write(ctId, '\r'), SUBMIT_DELAY_MS);
          } else {
            return json(res, 400, { error: 'expected {text}, {key} or {data}' });
          }
          return json(res, 200, { ok: true });
        }
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      if (!res.headersSent) json(res, 500, { error: String(e) });
    }
  });
}
