import fs from 'node:fs';
import path from 'node:path';
import { CT_NODE } from '../shared/config.ts';

/** Homebrew's stable symlink survives `brew upgrade node`; the Cellar path in execPath doesn't. */
export function stableNode(): string {
  const stable = '/opt/homebrew/opt/node/bin/node';
  return fs.existsSync(stable) && fs.realpathSync(stable) === fs.realpathSync(process.execPath) ? stable : process.execPath;
}

/**
 * Path of `ct-node`, a symlink to the node running ct. ct and the daemon run under this name so that
 * `killall node` (a common way to clear stray dev servers) doesn't kill them; macOS names a process after
 * the symlink it was started through. Created or repaired on every call; falls back to plain node.
 */
export function trackerNode(): string {
  const target = stableNode();
  try {
    if (fs.readlinkSync(CT_NODE) === target && fs.existsSync(CT_NODE)) return CT_NODE;
  } catch {
    // missing; create it below
  }
  try {
    fs.mkdirSync(path.dirname(CT_NODE), { recursive: true });
    const tmp = `${CT_NODE}.${process.pid}`;
    fs.rmSync(tmp, { force: true });
    fs.symlinkSync(target, tmp);
    fs.renameSync(tmp, CT_NODE); // atomic, so a ct starting at the same moment never finds it missing
    return CT_NODE;
  } catch {
    return process.execPath;
  }
}
