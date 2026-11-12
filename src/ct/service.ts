import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DAEMON_LOG, DAEMON_URL, DATA_DIR } from '../shared/config.ts';
import { ensureDaemon, isDaemonUp } from './daemon.ts';
import { trackerNode } from './node.ts';

const LABEL = 'com.agent-tracker.daemon';
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const DAEMON_MAIN = path.join(import.meta.dirname, '..', 'daemon', 'main.ts');
const DOMAIN = `gui/${process.getuid?.() ?? 501}`;

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function plist(): string {
  const args = [trackerNode(), '--no-warnings', DAEMON_MAIN].map(a => `    <string>${escapeXml(a)}</string>`).join('\n');
  // git (repo detection) and terminal-notifier must be on PATH; launchd's default PATH is minimal.
  const pathEnv = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${pathEnv}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <!-- Restart on crash only: a second instance exits 0 when the port is taken, which must not loop. -->
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(DAEMON_LOG)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(DAEMON_LOG)}</string>
</dict>
</plist>
`;
}

const isInstalled = () => fs.existsSync(PLIST);

function launchctl(...args: string[]): void {
  try {
    execFileSync('launchctl', args, { stdio: 'ignore' });
  } catch {
    // bootout of a service that isn't loaded fails; that's fine
  }
}

async function stopRunningDaemon(): Promise<void> {
  try {
    const { pid } = (await (await fetch(`${DAEMON_URL}/api/health`)).json()) as { pid: number };
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  for (let i = 0; i < 20 && (await isDaemonUp()); i++) await new Promise(r => setTimeout(r, 100));
}

async function waitUp(): Promise<boolean> {
  for (let i = 0; i < 30; i++) {
    if (await isDaemonUp()) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

export async function installService(): Promise<void> {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  launchctl('bootout', `${DOMAIN}/${LABEL}`);
  await stopRunningDaemon(); // so the launchd instance gets the port
  fs.writeFileSync(PLIST, plist());
  launchctl('bootstrap', DOMAIN, PLIST);
  console.log(`installed ${PLIST}`);
  console.log((await waitUp()) ? 'daemon running under launchd (starts at login)' : `daemon did not come up; see ${DAEMON_LOG}`);
}

export async function uninstallService(): Promise<void> {
  launchctl('bootout', `${DOMAIN}/${LABEL}`);
  fs.rmSync(PLIST, { force: true });
  console.log('removed launchd service; the daemon will start with the next `ct` session');
}

export async function restartDaemon(): Promise<void> {
  if (isInstalled()) {
    launchctl('kickstart', '-k', `${DOMAIN}/${LABEL}`);
  } else {
    await stopRunningDaemon();
    await ensureDaemon();
  }
  console.log((await waitUp()) ? 'daemon restarted' : `daemon did not come up; see ${DAEMON_LOG}`);
}

export async function daemonStatus(): Promise<void> {
  const up = await isDaemonUp();
  console.log(`daemon: ${up ? `running at ${DAEMON_URL}` : 'not running'}`);
  console.log(`start at login: ${isInstalled() ? 'yes (launchd)' : 'no (run: ct daemon install)'}`);
}
