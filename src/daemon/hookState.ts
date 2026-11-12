import type { Session } from '../shared/types.ts';

/** Raw Claude Code hook payload; only the fields we use. */
export interface HookPayload {
  hook_event_name: string;
  session_id: string;
  cwd: string;
  transcript_path?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  notification_type?: string;
  message?: string;
  last_assistant_message?: string;
  reason?: string;
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function describeTool(name: string, input: Record<string, unknown> | undefined): string {
  const arg = input?.command ?? input?.file_path ?? input?.pattern ?? input?.url ?? input?.description ?? input?.query;
  return typeof arg === 'string' ? `${name}: ${truncate(arg.replace(/\s+/g, ' '), 80)}` : name;
}

/** Applies a hook event to the session's live state. */
export function applyHook(s: Session, h: HookPayload, now: number): void {
  s.hooked = true;
  // Notifications are Claude reminding you, not the agent doing anything (idle_prompt arrives ~60s after Stop).
  if (h.hook_event_name !== 'Notification') s.lastActivityAt = now;
  s.cwd = h.cwd || s.cwd;
  if (h.transcript_path) s.transcriptPath = h.transcript_path;

  switch (h.hook_event_name) {
    case 'SessionStart':
      s.state = 'idle';
      break;
    case 'UserPromptSubmit':
      s.state = 'working';
      s.pending = undefined;
      s.activity = undefined;
      if (h.prompt && !s.firstPrompt) s.firstPrompt = truncate(h.prompt, 200);
      break;
    case 'PreToolUse':
    case 'PostToolUse':
      s.state = 'working';
      s.pending = undefined;
      if (h.tool_name) s.activity = describeTool(h.tool_name, h.tool_input);
      break;
    case 'PermissionRequest':
      s.state = 'waiting';
      s.pending = {
        kind: h.tool_name === 'AskUserQuestion' ? 'question' : 'permission',
        toolName: h.tool_name ?? 'unknown',
        toolInput: h.tool_input,
        since: now,
      };
      break;
    case 'Notification':
      // permission prompts are already covered by PermissionRequest; idle_prompt = "Claude is waiting for your input"
      if (h.notification_type === 'idle_prompt' && s.state !== 'waiting') s.state = 'idle';
      break;
    case 'Stop':
      s.state = 'idle';
      s.pending = undefined;
      s.activity = undefined;
      if (h.last_assistant_message) s.lastMessage = truncate(h.last_assistant_message, 500);
      break;
    case 'SessionEnd':
      s.state = 'ended';
      s.pending = undefined;
      s.activity = undefined;
      s.ctId = undefined;
      break;
  }
}
