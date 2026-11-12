# agent-tracker

Local tracker for Claude Code sessions: see every session, which ones need you, and answer them without finding the window.

```sh
npm install && npm link     # puts `ct` on PATH
npm run build               # builds the dashboard
ct hooks install            # one-time: adds silent curl hooks to ~/.claude/settings.json (backup made)
ct                          # use instead of `claude` (same args); starts the daemon if needed
ct ls                       # live sessions; "ct" column = can be answered remotely
ct send <id> --key 2        # answer a question / approve a prompt
ct send <id> some text      # type a follow-up
ct screen <id>              # see the session's screen
```

Dashboard: http://127.0.0.1:47800 — sessions that need you at the top with one-click answers,
click a session for its live terminal (type into it directly) and a reply box. `npm run dev` runs it with hot reload on :5173.

History (`#/history`): every Claude Code transcript on disk, searchable, with titles, per-model cost and a resume command.
Usage (`#/usage`): estimated cost per day / repo / session at API list prices. Estimates come from transcript
tokens, so they miss background calls (auto-mode checks, titles); where Claude Code records its own total it is shown too.

Cursor: agent chats are read (read-only) from Cursor's storage. Chats in open Cursor windows show in Live
(working / waiting on an approval or question / your turn, with notifications); all chats are searchable in
History. Cursor can't be answered from outside, so its cards have "Open in Cursor", which brings the window forward.
The storage format is undocumented (verified on format _v 18); if Cursor changes it, chats stop appearing.

Notifications: when a session asks a question or needs approval (and isn't answered within ~1.5s), or
finishes a turn that ran 30s+. Click "Enable notifications" in the dashboard; clicking one opens that session.
With no dashboard open the daemon sends a macOS notification instead (`brew install terminal-notifier` makes those clickable).

`ct daemon install` starts the daemon at login (launchd) and restarts it if it crashes; `ct daemon restart` after pulling changes,
`ct daemon status` to check. Without `install`, `ct` starts the daemon on demand as a background process, and it can stop
when the terminal or session that started it goes away. The dashboard is then unreachable until the next `ct` or `ct daemon restart`.

`ct` and the daemon run as `ct-node` (a symlink to node in `~/.agent-tracker/bin/`), so `killall node` doesn't kill them.
`pkill node` still would: it matches any name containing "node".

If a `ct` session is killed (e.g. `kill -9`, or the terminal shows `killed ct`), Claude can't switch off mouse and focus reporting,
so scrolling, clicking and selecting in that terminal print garbage like `35;43;1M`. Run `reset` in it, or just
`printf '\e[?1000l\e[?1002l\e[?1003l\e[?1006l\e[?1004l\e[?2004l'`; iTerm's "Turn off focus reporting?" banner fixes part of it.
Then `ct --resume <id>` to continue the session.

Sessions started with plain `claude` are tracked (state, activity, tokens) but can't be typed into.

Daemon: `http://127.0.0.1:47800`, data in `~/.agent-tracker/`. API: `GET /api/sessions`, `GET /api/sessions/:id/screen`, `POST /api/sessions/:id/input {text|key}`.

Tests: `node spike/e2e.mjs` drives a real `ct` session (Haiku) end to end through the API.
