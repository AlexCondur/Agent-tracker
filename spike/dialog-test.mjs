// Unit checks for parseDialog against real screens.
import { parseDialog } from '../src/daemon/screenDialog.ts';
import assert from 'node:assert/strict';

const teach = `  I classified it as a task because its Task ID is ABC-1234.
  worktree, branch or code was created.

────────────────────────────────────────────────────────────
  Teach auto mode about your environment?

  Auto mode works better when it knows your environment. Takes about a minute.

    1. Yes
    2. Not now
  ❯ 3. Don't show again

  Enter to confirm · Esc to cancel
────────────────────────────────────────────────────────────
❯
────────────────────────────────────────────────────────────
  ⏵⏵ auto mode on (shift+tab to cycle)`;
let d = parseDialog(teach);
assert.equal(d.title, 'Teach auto mode about your environment?');
assert.match(d.body, /Auto mode works better/);
assert.deepEqual(d.options.map(o => o.label), ['Yes', 'Not now', "Don't show again"]);
assert.equal(d.selected, 3);

const trust = `────────────────────────────────────────────────
 Accessing workspace:
 /Users/me/agent-tracker/spike/sandbox
 Quick safety check: Is this a project you created or one you trust?
 Security guide
 ❯ No, exit
   Yes, I trust this folder
 Enter to confirm · Esc to cancel`;
// Unnumbered options: not answerable by number, so not reported (the user opens the terminal).
assert.equal(parseDialog(trust), undefined);

const question = `❯ Spike test. Step 1: use the AskUserQuestion tool
────────────────────────────────────────────────
 ☐ Color
Which color do you prefer?
❯ 1. red
     Write 'red' to picked.txt
  2. blue
     Write 'blue' to picked.txt
  3. Type something.
────────────────────────────────────────────────
  4. Chat about this
Enter to select · ↑/↓ to navigate · Esc to cancel`;
d = parseDialog(question);
assert.equal(d.title, 'Color');
assert.deepEqual(d.options.map(o => o.n), [1, 2, 3, 4]);
assert.equal(d.selected, 1);

const permission = ` Bash command
 echo blue > picked.txt
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and always allow access
   4. No
 Esc to cancel · Tab to amend`;
assert.equal(parseDialog(permission).options.length, 3);

const idle = `⏺ DONE
✻ Baked for 6s · done 12:59
────────────────────────────────
❯
────────────────────────────────
  ⏵⏵ auto mode on (shift+tab to cycle)`;
assert.equal(parseDialog(idle), undefined);

const working = `⏺ Bash(npm test)
✻ Churning… (esc to interrupt)
────────────────────────────────
❯ 1. something typed in the prompt
────────────────────────────────`;
assert.equal(parseDialog(working), undefined);
const model = `▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ ◐ medium · /effort ▔
   Select model
   Switch between Claude models. Your pick becomes the default for new sessions.

     1. Default (recommended)  Use the default model (currently Opus 5.5)
     2. Opus                   Opus 5.5 · Best for everyday, complex tasks
   ❯ 5. Haiku ✔                Haiku 5.5 · Fastest for quick answers
                               ($0.50/$2.50 for prompts over 100k)

   Enter to set as default · s to use this session only · Esc to cancel`;
d = parseDialog(model);
assert.equal(d.title, 'Select model');
assert.deepEqual(d.options.map(o => o.label), ['Default (recommended)', 'Opus', 'Haiku ✔']);
assert.equal(d.selected, 5);
console.log('dialog tests passed');
