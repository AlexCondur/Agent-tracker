import { runClaude } from './run.ts';
import { installHooks, uninstallHooks, hooksStatus } from './hooks.ts';
import { ls, send, screen } from './commands.ts';
import { installService, uninstallService, restartDaemon, daemonStatus } from './service.ts';
import { execFileSync } from 'node:child_process';
import { DAEMON_URL } from '../shared/config.ts';

const USAGE = `ct — run claude so agent-tracker can see and answer it

  ct [claude args...]          start claude (same args as claude)
  ct ls [--all]                list sessions (--all includes ended)
  ct send <id> <text...>       type text into a session and press Enter
  ct send <id> --key <key>     press a key: 1-9, enter, esc, up, down, tab, shift+tab, ctrl+c
  ct screen <id>               print a session's current screen
  ct hooks install|uninstall|status
  ct open                      open the dashboard
  ct daemon status|restart     daemon state / restart it (e.g. after updating agent-tracker)
  ct daemon install|uninstall  start the daemon at login (launchd)
  ct daemon run                run the daemon in the foreground
`;

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'ls':
    await ls(rest.includes('--all'));
    break;
  case 'send':
    if (rest.length < 2) throw new Error(USAGE);
    await send(rest[0], rest.slice(1));
    break;
  case 'screen':
    await screen(rest[0]);
    break;
  case 'hooks': {
    const actions: Record<string, () => void> = { install: installHooks, uninstall: uninstallHooks, status: hooksStatus };
    const action = actions[rest[0] ?? ''];
    if (action) action();
    else console.log(USAGE);
    break;
  }
  case 'open':
    execFileSync('open', [DAEMON_URL]);
    break;
  case 'daemon': {
    const actions: Record<string, () => Promise<void>> = {
      install: installService,
      uninstall: uninstallService,
      restart: restartDaemon,
      status: daemonStatus,
      run: async () => void (await import('../daemon/main.ts')),
    };
    const action = actions[rest[0] ?? 'status'];
    if (action) await action();
    else console.log(USAGE);
    break;
  }
  case 'help':
    console.log(USAGE);
    break;
  default:
    await runClaude(process.argv.slice(2));
}
