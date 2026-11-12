#!/usr/bin/env -S node --no-warnings
import fs from 'node:fs';
import { DATA_DIR, DB_PATH, CT_SOCKET, PORT } from '../shared/config.ts';
import { Db } from './db.ts';
import { PtyBroker } from './ptyBroker.ts';
import { Store } from './store.ts';
import { createHttpServer } from './http.ts';
import { Notifier } from './notifier.ts';
import { HistoryIndex } from './history.ts';
import { HistoryQueries } from './historyQueries.ts';
import { CursorWatcher } from './cursor.ts';

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Db(DB_PATH);
const broker = new PtyBroker();
const store = new Store(db, broker);
const history = new HistoryIndex(db.db);
const server = createHttpServer(store, broker, new Notifier(store), new HistoryQueries(db.db));

// Bind the TCP port first: it is the single-instance lock. Only the winner takes over the ct socket.
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`agent-tracker daemon already running on port ${PORT}`);
    process.exit(0);
  }
  throw e;
});
server.listen(PORT, '127.0.0.1', () => {
  broker.listen(CT_SOCKET);
  store.start();
  history.start();
  new CursorWatcher(store, history).start();
  console.log(`${new Date().toISOString()} agent-tracker daemon pid ${process.pid} on http://127.0.0.1:${PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    store.flush();
    process.exit(0);
  });
