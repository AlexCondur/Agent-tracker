import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_DIR } from '../shared/config.ts';

/** A personal Claude Code command (~/.claude/commands/<name>.md), run in a session as /<name>. */
export interface SavedCommand {
  name: string;
  description?: string;
  argumentHint?: string;
}

const COMMANDS_DIR = path.join(CLAUDE_DIR, 'commands');

/** The value of `key: value` (optionally quoted) in a command file's frontmatter. */
function frontmatter(text: string, key: string): string | undefined {
  const head = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
  const v = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(head)?.[1].trim();
  return v ? v.replace(/^(["'])(.*)\1$/, '$2') : undefined;
}

/** Read fresh on every call: the files are few and small, and edits show up without a restart. */
export function listCommands(): SavedCommand[] {
  let files: string[];
  try {
    files = fs.readdirSync(COMMANDS_DIR).filter(f => f.endsWith('.md'));
  } catch {
    return [];
  }
  return files
    .map(f => {
      const text = fs.readFileSync(path.join(COMMANDS_DIR, f), 'utf8');
      return { name: f.slice(0, -3), description: frontmatter(text, 'description'), argumentHint: frontmatter(text, 'argument-hint') };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
