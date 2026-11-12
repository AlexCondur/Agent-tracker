// Runs the watcher's pending detection on a real Cursor approval request, isolated so it is the
// latest tool call (copied into an in-memory DB; Cursor's DB is only read).
import { CursorWatcher } from '../src/daemon/cursor.ts';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
const id = process.argv[2];
const src = new DatabaseSync(os.homedir() + '/Library/Application Support/Cursor/User/globalStorage/state.vscdb', { readOnly: true });
const row = src
  .prepare("SELECT key, value FROM cursorDiskKV WHERE key > ? AND key < ? AND json_extract(value, '$.toolFormerData.additionalData.reviewData.status') = 'Requested' LIMIT 1")
  .get(`bubbleId:${id}:`, `bubbleId:${id};`) as { key: string; value: string };
const mem = new DatabaseSync(':memory:');
mem.exec('CREATE TABLE cursorDiskKV (key TEXT UNIQUE, value BLOB)');
mem.prepare('INSERT INTO cursorDiskKV VALUES (?, ?)').run(row.key, row.value);
const w = new CursorWatcher({} as never, {} as never) as unknown as { db: DatabaseSync; turnState(id: string): { pending: unknown } };
w.db = mem;
console.log(JSON.stringify(w.turnState(id).pending, null, 1).slice(0, 600));
