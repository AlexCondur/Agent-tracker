import { execFileSync } from 'node:child_process';
import path from 'node:path';

const cache = new Map<string, { repo: string; worktree: string }>();

/**
 * Repo name and worktree folder for a directory. All worktrees of a repo share the git common dir,
 * so its parent names the repo. Falls back to the folder name outside git.
 */
export function gitLocation(cwd: string): { repo: string; worktree: string } {
  let loc = cache.get(cwd);
  if (loc) return loc;
  try {
    const [top, common] = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel', '--git-common-dir'], {
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split('\n');
    const commonDir = path.resolve(cwd, common);
    loc = {
      repo: path.basename(path.basename(commonDir) === '.git' ? path.dirname(commonDir) : commonDir).replace(/\.git$/, ''),
      worktree: path.basename(top),
    };
  } catch {
    // Not a git dir (anymore). Worktrees made by Claude's Agent tool live in <repo>/.claude/worktrees/<name>.
    const agentWorktree = /^(.*)\/\.claude\/worktrees\/([^/]+)/.exec(cwd);
    loc = agentWorktree
      ? { repo: path.basename(agentWorktree[1]), worktree: agentWorktree[2] }
      : { repo: path.basename(cwd), worktree: path.basename(cwd) };
  }
  cache.set(cwd, loc);
  return loc;
}
