import { DatabaseSync } from 'node:sqlite';
import type { Session } from '../shared/types.ts';

export class Db {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        cwd TEXT NOT NULL,
        last_activity_at INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_session ON events(session_id, ts);
    `);
  }

  loadSessions(): Session[] {
    const rows = this.db.prepare('SELECT data FROM sessions').all() as { data: string }[];
    return rows.map(r => JSON.parse(r.data) as Session);
  }

  saveSession(s: Session): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, state, cwd, last_activity_at, data) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET state = excluded.state, cwd = excluded.cwd,
           last_activity_at = excluded.last_activity_at, data = excluded.data`,
      )
      .run(s.id, s.state, s.cwd, s.lastActivityAt, JSON.stringify(s));
  }

  addEvent(sessionId: string, ts: number, type: string, payload: unknown): void {
    this.db
      .prepare('INSERT INTO events (session_id, ts, type, payload) VALUES (?, ?, ?, ?)')
      .run(sessionId, ts, type, JSON.stringify(payload));
  }
}
