import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import pty from 'node-pty';
import xterm from '@xterm/headless';
import serializeAddon from '@xterm/addon-serialize';
import { DaemonLink, ensureDaemon } from './daemon.ts';
import { trackerNode } from './node.ts';
import { CT_LOG } from '../shared/config.ts';

/** Appends a line to ct.log; never throws (ct must keep working without it). */
function ctLog(line: string): void {
  try {
    fs.appendFileSync(CT_LOG, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // no log dir
  }
}

/**
 * Variables that tie a process to a parent Claude session. Inherited by a nested claude they
 * disable transcript saving and copy the parent's permission mode, so they are removed.
 */
const PARENT_SESSION_ENV = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_(SESSION_ID|CHILD_SESSION|ENTRYPOINT|MESSAGING_SOCKET|MESSAGING_TOKEN|SESSION_ATTENDED|EXECPATH))$/;

/** Runs claude in a PTY mirrored to this terminal and to the daemon. Behaves like plain `claude`. */
export async function runClaude(args: string[]): Promise<never> {
  const ctId = randomUUID();
  trackerNode(); // keep the ct-node link current for the next start (bin/ct runs under it)
  await ensureDaemon();

  const env: Record<string, string> = { CT_ID: ctId };
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !PARENT_SESSION_ENV.test(k)) env[k] = v;
  env.CT_ID = ctId;

  const size = () => ({ cols: process.stdout.columns || 120, rows: process.stdout.rows || 40 });
  const child = pty.spawn(process.env.CT_CLAUDE_BIN ?? 'claude', args, {
    name: process.env.TERM || 'xterm-256color',
    cwd: process.cwd(),
    env,
    ...size(),
  });

  // Our own copy of the screen, replayed whenever we (re)connect so a restarted daemon doesn't start blank.
  const mirror = new xterm.Terminal({ ...size(), scrollback: 1000, allowProposedApi: true });
  const serializer = new serializeAddon.SerializeAddon();
  mirror.loadAddon(serializer);
  /** Output produced while a replay snapshot is being taken; sent right after it, in order. */
  let held: string[] | undefined;

  const link = new DaemonLink(
    () => ({ type: 'hello', ctId, pid: child.pid, ctPid: process.pid, cwd: process.cwd(), ...size() }),
    data => child.write(data),
    () => {
      held = [];
      // The callback runs once everything written so far is parsed, so the snapshot covers exactly that.
      mirror.write('', () => {
        link.send({ type: 'output', data: serializer.serialize() });
        for (const d of held ?? []) link.send({ type: 'output', data: d });
        held = undefined;
      });
    },
  );

  const stdin = process.stdin;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.on('data', (d: string) => child.write(d));
  stdin.resume();

  child.onData(d => {
    process.stdout.write(d);
    mirror.write(d);
    if (held) held.push(d);
    else link.send({ type: 'output', data: d });
  });

  process.stdout.on('resize', () => {
    const { cols, rows } = size();
    child.resize(cols, rows);
    mirror.resize(cols, rows);
    link.send({ type: 'resize', cols, rows });
  });

  ctLog(`ct ${ctId} pid ${process.pid} (parent ${process.ppid}) started claude pid ${child.pid} in ${process.cwd()}`);
  // Passed on to claude so it can restore the terminal before exiting; logged to explain sessions that die.
  for (const sig of ['SIGHUP', 'SIGTERM', 'SIGINT', 'SIGQUIT'] as const)
    process.on(sig, () => {
      ctLog(`ct ${ctId} pid ${process.pid} received ${sig} (parent ${process.ppid})`);
      child.kill(sig);
    });

  return new Promise<never>(() => {
    child.onExit(({ exitCode, signal }) => {
      ctLog(`ct ${ctId} pid ${process.pid}: claude exited with code ${exitCode}${signal ? ` on signal ${signal}` : ''}`);
      link.send({ type: 'exit', code: exitCode });
      link.close();
      if (stdin.isTTY) stdin.setRawMode(false);
      // let the exit message flush
      setTimeout(() => process.exit(exitCode), 50);
    });
  });
}
