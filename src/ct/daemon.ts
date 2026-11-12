import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CT_SOCKET, DAEMON_LOG, DATA_DIR, DAEMON_URL } from '../shared/config.ts';
import { readNdjson, writeNdjson } from '../shared/ndjson.ts';
import type { CtToDaemon, DaemonToCt } from '../shared/types.ts';
import { trackerNode } from './node.ts';

const DAEMON_MAIN = path.join(import.meta.dirname, '..', 'daemon', 'main.ts');
const RECONNECT_MS = 2000;

export async function isDaemonUp(): Promise<boolean> {
  try {
    return (await fetch(`${DAEMON_URL}/api/health`, { signal: AbortSignal.timeout(500) })).ok;
  } catch {
    return false;
  }
}

/** Starts the daemon in the background if it isn't running. Never throws. */
export async function ensureDaemon(): Promise<void> {
  if (await isDaemonUp()) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const log = fs.openSync(DAEMON_LOG, 'a');
    spawn(trackerNode(), ['--no-warnings', DAEMON_MAIN], { detached: true, stdio: ['ignore', log, log] }).unref();
  } catch {
    // ct works without the daemon
  }
}

/**
 * Keeps a connection to the daemon for one wrapped session, reconnecting if the daemon restarts.
 * Messages sent while disconnected are dropped: ct must never block on the daemon.
 */
export class DaemonLink {
  private sock?: net.Socket;
  private closed = false;
  private hello: () => Extract<CtToDaemon, { type: 'hello' }>;
  private onInput: (data: string) => void;
  private onConnect: () => void;

  constructor(hello: () => Extract<CtToDaemon, { type: 'hello' }>, onInput: (data: string) => void, onConnect: () => void) {
    this.hello = hello;
    this.onInput = onInput;
    this.onConnect = onConnect;
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    const sock = net.connect(CT_SOCKET);
    sock.on('connect', () => {
      this.sock = sock;
      writeNdjson(sock, this.hello());
      this.onConnect();
    });
    readNdjson(sock, raw => {
      const msg = raw as DaemonToCt;
      if (msg.type === 'input') this.onInput(msg.data);
    });
    sock.on('error', () => {});
    sock.on('close', () => {
      if (this.sock === sock) this.sock = undefined;
      if (!this.closed) setTimeout(() => this.connect(), RECONNECT_MS).unref();
    });
  }

  send(msg: CtToDaemon): void {
    if (this.sock) writeNdjson(this.sock, msg);
  }

  close(): void {
    this.closed = true;
    this.sock?.end();
  }
}
