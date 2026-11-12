import net from 'node:net';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import xterm from '@xterm/headless';
import serializeAddon from '@xterm/addon-serialize';
import { readNdjson, writeNdjson } from '../shared/ndjson.ts';
import type { CtToDaemon, DaemonToCt } from '../shared/types.ts';
import { parseDialog, type ScreenDialog } from './screenDialog.ts';
import { isAlive } from './liveSessions.ts';

export interface CtConn {
  ctId: string;
  pid: number;
  /** The `ct` wrapper's own pid (older wrappers don't send it). */
  ctPid?: number;
  exited?: boolean;
  cwd: string;
  sock: net.Socket;
  /** Headless mirror of the real terminal, so we can read the screen without the window. */
  term: xterm.Terminal;
  serializer: serializeAddon.SerializeAddon;
  dialog?: ScreenDialog;
  dialogTimer?: NodeJS.Timeout;
}

/** How often (at most) a busy screen is checked for dialogs. */
const DIALOG_CHECK_MS = 250;

/** Scrollback kept in the mirror and replayed when the dashboard opens a terminal. */
const MIRROR_SCROLLBACK = 1000;

/**
 * Accepts connections from `ct` wrappers. Each wrapper streams its terminal output here and
 * receives input to type into its claude process.
 * Events: 'connect' (conn), 'output' (conn, data), 'resize' (conn), 'dialog' (conn) when conn.dialog changes,
 * 'exit' (conn, code), 'disconnect' (conn).
 */
export class PtyBroker extends EventEmitter {
  readonly conns = new Map<string, CtConn>();

  listen(socketPath: string): void {
    fs.rmSync(socketPath, { force: true });
    const server = net.createServer(sock => this.accept(sock));
    server.listen(socketPath, () => fs.chmodSync(socketPath, 0o600));
  }

  private accept(sock: net.Socket): void {
    let conn: CtConn | undefined;
    readNdjson(sock, raw => {
      const msg = raw as CtToDaemon;
      if (msg.type === 'hello') {
        // The real terminal answers capability queries; the mirror must stay silent.
        const term = new xterm.Terminal({ cols: msg.cols, rows: msg.rows, scrollback: MIRROR_SCROLLBACK, allowProposedApi: true });
        const serializer = new serializeAddon.SerializeAddon();
        term.loadAddon(serializer);
        conn = { ctId: msg.ctId, pid: msg.pid, ctPid: msg.ctPid, cwd: msg.cwd, sock, term, serializer };
        this.conns.get(msg.ctId)?.sock.destroy();
        this.conns.set(msg.ctId, conn);
        this.emit('connect', conn);
      } else if (!conn) {
        return;
      } else if (msg.type === 'output') {
        conn.term.write(msg.data);
        this.emit('output', conn, msg.data);
        this.scheduleDialogCheck(conn);
      } else if (msg.type === 'resize') {
        conn.term.resize(msg.cols, msg.rows);
        this.emit('resize', conn);
      } else if (msg.type === 'exit') {
        conn.exited = true;
        this.emit('exit', conn, msg.code);
      }
    });
    const drop = () => {
      if (conn && this.conns.get(conn.ctId) === conn) {
        this.conns.delete(conn.ctId);
        clearTimeout(conn.dialogTimer);
        conn.term.dispose();
        // A wrapper that vanishes without saying it exited was killed (e.g. SIGKILL); record what survived.
        if (!conn.exited) {
          console.log(
            `${new Date().toISOString()} ct ${conn.ctId} dropped without exiting: ct pid ${conn.ctPid ?? '?'} ${conn.ctPid ? (isAlive(conn.ctPid) ? 'alive' : 'gone') : ''}, claude pid ${conn.pid} ${isAlive(conn.pid) ? 'alive' : 'gone'}, cwd ${conn.cwd}`,
          );
        }
        this.emit('disconnect', conn);
      }
    };
    sock.on('close', drop);
    sock.on('error', drop);
  }

  private scheduleDialogCheck(conn: CtConn): void {
    if (conn.dialogTimer) return;
    conn.dialogTimer = setTimeout(() => {
      conn.dialogTimer = undefined;
      if (this.conns.get(conn.ctId) !== conn) return;
      const dialog = parseDialog(this.screen(conn.ctId) ?? '');
      if (JSON.stringify(dialog) === JSON.stringify(conn.dialog)) return;
      conn.dialog = dialog;
      this.emit('dialog', conn);
    }, DIALOG_CHECK_MS);
  }

  write(ctId: string, data: string): boolean {
    const conn = this.conns.get(ctId);
    if (!conn) return false;
    writeNdjson(conn.sock, { type: 'input', data } satisfies DaemonToCt);
    return true;
  }

  /** Current terminal contents as escape sequences that reproduce it (screen + scrollback). */
  snapshot(ctId: string): { cols: number; rows: number; data: string } | undefined {
    const conn = this.conns.get(ctId);
    return conn && { cols: conn.term.cols, rows: conn.term.rows, data: conn.serializer.serialize() };
  }

  screen(ctId: string): string | undefined {
    const term = this.conns.get(ctId)?.term;
    if (!term) return undefined;
    const b = term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < term.rows; i++) lines.push(b.getLine(b.viewportY + i)?.translateToString(true) ?? '');
    return lines.join('\n').replace(/\n+$/, '');
  }
}
