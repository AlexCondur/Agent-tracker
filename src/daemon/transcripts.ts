import fs from 'node:fs';
import type { Session } from '../shared/types.ts';
import { modelOf, parseLine, textOf } from './transcriptLine.ts';

/**
 * Incrementally reads a Claude transcript JSONL and folds it into session stats.
 * Assistant turns with several content blocks are written as several lines sharing one
 * message id and usage, so usage is counted once per message id.
 */
export class TranscriptTailer {
  private offset = 0;
  private partial = '';
  private seenMessageIds = new Set<string>();

  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  /** Returns true if the session changed. */
  poll(s: Session): boolean {
    let size: number;
    try {
      size = fs.statSync(this.path).size;
    } catch {
      return false;
    }
    if (size < this.offset) this.reset(s); // file rewritten
    if (size === this.offset) return false;

    const fd = fs.openSync(this.path, 'r');
    try {
      const buf = Buffer.alloc(size - this.offset);
      fs.readSync(fd, buf, 0, buf.length, this.offset);
      this.offset = size;
      const lines = (this.partial + buf.toString('utf8')).split('\n');
      this.partial = lines.pop() ?? '';
      for (const line of lines) if (line) this.apply(s, line);
    } finally {
      fs.closeSync(fd);
    }
    return true;
  }

  private reset(s: Session): void {
    this.offset = 0;
    this.partial = '';
    this.seenMessageIds.clear();
    s.messages = s.tokensIn = s.tokensOut = s.cacheRead = s.cacheWrite = 0;
  }

  private apply(s: Session, raw: string): void {
    const l = parseLine(raw);
    if (!l) return;
    if (l.gitBranch && l.gitBranch !== 'HEAD') s.branch = l.gitBranch;
    if (l.isSidechain || (l.type !== 'user' && l.type !== 'assistant')) return;

    const id = l.message?.id;
    if (l.type === 'assistant' && id) {
      if (this.seenMessageIds.has(id)) return;
      this.seenMessageIds.add(id);
      s.model = modelOf(l) ?? s.model;
      const u = l.message?.usage;
      s.tokensIn += u?.input_tokens ?? 0;
      s.tokensOut += u?.output_tokens ?? 0;
      s.cacheRead += u?.cache_read_input_tokens ?? 0;
      s.cacheWrite += u?.cache_creation_input_tokens ?? 0;
    }
    s.messages++;

    // Text for cards of sessions whose hooks we never saw (started before hooks were installed).
    const text = textOf(l);
    if (!text) return;
    if (l.type === 'user' && !s.firstPrompt) s.firstPrompt = text.slice(0, 200);
    if (l.type === 'assistant' && !s.hooked) s.lastMessage = text.slice(0, 500);
  }
}
