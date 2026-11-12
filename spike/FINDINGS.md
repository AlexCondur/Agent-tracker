# Phase 0 spike findings (2026-11-04, Claude Code 2.1.304)

Run: `node spike/drive.mjs` — drives a real interactive `claude` in a PTY, no human.

## Confirmed
- node-pty works on Node 23 (prebuilt `spawn-helper` needs `chmod +x` → postinstall script).
- Headless emulator (@xterm/headless) MUST pipe its replies back (`term.onData → pty.write`),
  otherwise Claude's TUI waits on terminal-capability queries and ignores input.
- Keystrokes answer prompts: AskUserQuestion → option number (`2`); permission prompt → `1` Yes / `4` No.
- HTTP hooks work and carry structured data:
  - `UserPromptSubmit` (prompt text) → state `working`
  - `PreToolUse` (tool_name, tool_input, tool_use_id) → `working`, current activity
  - `PermissionRequest` fires for BOTH Bash approvals and AskUserQuestion; tool_input has the full
    questions/options → state `waiting`, render buttons from this (no screen scraping needed)
  - `Stop` (last_assistant_message) → `idle` / your turn
  - `SessionEnd` (reason) → `ended`
  - Every payload: session_id, cwd, transcript_path, permission_mode, prompt_id
- Transcript JSONL path from hooks exists and is written live.

## Gotchas
- `SessionStart` did not reach the HTTP hook, and `Notification` didn't fire within the 15s run →
  don't depend on them; first `UserPromptSubmit`/`PreToolUse` registers the session.
- Spawning claude from inside another Claude session inherits `CLAUDE_CODE_*` env
  (child-session marker disables transcripts, inherits auto mode) → `ct` strips these.
- Trust dialog defaults to "No, exit"; new folders need ↓ + Enter.

## Linking a PTY to a session_id
`ct` sets `CT_ID=<uuid>` in the child env; the HTTP hook sends it as a header
(`headers: {"X-CT-Id": "$CT_ID"}`, `allowedEnvVars: ["CT_ID"]`) → daemon maps session_id ↔ PTY. To verify in phase 1.

## Not yet tested (needs a human terminal)
- `ct` as a transparent passthrough in iTerm / Cursor terminal (raw mode, resize, Ctrl-C, scrollback).
