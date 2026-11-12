import type { Socket } from 'node:net';

/** Calls onMessage for every complete JSON line received on the socket. */
export function readNdjson(sock: Socket, onMessage: (msg: unknown) => void): void {
  let buf = '';
  sock.setEncoding('utf8');
  sock.on('data', (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        onMessage(JSON.parse(line));
      } catch {
        // ignore malformed line
      }
    }
  });
}

export function writeNdjson(sock: Socket, msg: unknown): void {
  if (!sock.destroyed) sock.write(JSON.stringify(msg) + '\n');
}
