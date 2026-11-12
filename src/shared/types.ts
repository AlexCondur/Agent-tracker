export type SessionState = 'working' | 'waiting' | 'idle' | 'ended';

export interface PendingPrompt {
  /** permission/question come from hooks; dialog is one of Claude's own dialogs, read from the screen. */
  kind: 'permission' | 'question' | 'dialog';
  toolName: string;
  /** For dialogs: ScreenDialog (title, body, options, selected). */
  toolInput: unknown;
  since: number;
  /** For dialogs: the state to return to once it closes. */
  resumeState?: SessionState;
}

export interface Session {
  id: string;
  tool: 'claude' | 'cursor';
  cwd: string;
  /** Git repository name (shared by all its worktrees) and the worktree folder name; used for grouping. */
  repo?: string;
  worktree?: string;
  transcriptPath?: string;
  name?: string;
  branch?: string;
  model?: string;
  state: SessionState;
  pending?: PendingPrompt;
  /** Short description of what the agent is doing right now, e.g. "Bash: npm test". */
  activity?: string;
  /** Working only because background shells or agents still run after Claude's turn ended (from Claude's own status). */
  background?: boolean;
  lastMessage?: string;
  firstPrompt?: string;
  startedAt: number;
  lastActivityAt: number;
  /** When you last looked at it in the dashboard; idle sessions with activity after this are unread. */
  seenAt?: number;
  /** Removed from the Live list at this time; it comes back once it has activity after this. */
  dismissedAt?: number;
  /** Pinned in the dashboard at this time: kept at the top of Home and Live, in pin order. */
  pinnedAt?: number;
  /** Name given in the dashboard; shown instead of Claude's or Cursor's own. */
  customTitle?: string;
  /** True once any hook event arrived; until then state is inferred from ~/.claude/sessions. */
  hooked: boolean;
  messages: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  /** Estimated $ from the history index; added by the API, not stored. */
  cost?: number | null;
  pid?: number;
  /** Set while the session runs under a connected `ct` wrapper, i.e. the dashboard can type into it. */
  ctId?: string;
}

/** Newline-delimited JSON over the unix socket between `ct` and the daemon. */
export type CtToDaemon =
  | { type: 'hello'; ctId: string; pid: number; ctPid?: number; cwd: string; cols: number; rows: number }
  | { type: 'output'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'exit'; code: number };

export type DaemonToCt = { type: 'input'; data: string };
