import type { Usage } from './pricing.ts';

/** One line of a Claude Code transcript JSONL; only the fields we use. */
export interface TranscriptLine {
  type?: string;
  uuid?: string;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  message?: {
    id?: string;
    model?: string;
    content?: string | { type: string; text?: string }[];
    usage?: Usage;
  };
  aiTitle?: string;
  customTitle?: string;
  lastPrompt?: string;
  totalCostUSD?: number;
}

export function parseLine(raw: string): TranscriptLine | undefined {
  try {
    return JSON.parse(raw) as TranscriptLine;
  } catch {
    return undefined;
  }
}

/** Plain text a human typed or Claude wrote; undefined for tool calls/results and injected context. */
export function textOf(l: TranscriptLine): string | undefined {
  if (l.isMeta || (l.type !== 'user' && l.type !== 'assistant')) return undefined;
  const c = l.message?.content;
  const text = typeof c === 'string' ? c : c?.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n');
  const trimmed = text?.trim();
  if (!trimmed) return undefined;
  // Slash commands are stored as <command-name>/x</command-name><command-args>…</command-args>.
  const command = /<command-name>([^<]+)<\/command-name>/.exec(trimmed)?.[1];
  if (command) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(trimmed)?.[1]?.trim();
    return args ? `${command} ${args}` : command;
  }
  return trimmed.startsWith('<') ? undefined : trimmed;
}

/** Real model name, or undefined for placeholders like "<synthetic>". */
export function modelOf(l: TranscriptLine): string | undefined {
  const m = l.message?.model;
  return m && !m.startsWith('<') ? m : undefined;
}

/** Calendar day in local time, YYYY-MM-DD. */
export function localDay(ts: number): string {
  return new Date(ts).toLocaleDateString('sv');
}
