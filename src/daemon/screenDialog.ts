/**
 * Detects Claude Code's own dialogs (trust folder, "Teach auto mode…", update prompts) from the screen.
 * These fire no hook, so the screen is the only signal. Tool permissions and AskUserQuestion also render
 * as dialogs, but hooks report those with richer data; the store prefers the hook.
 */
export interface ScreenDialog {
  title: string;
  body?: string;
  options: { n: number; label: string }[];
  /** Option number the ❯ cursor is on. */
  selected?: number;
}

/** Footer hints that only appear while a dialog has focus. */
const FOOTER = /Enter to (confirm|select)|Esc to cancel/;
const RULE = /^\s*[─━╌▔▁]{8,}/;
const OPTION = /^\s*(❯\s*)?(\d+)\.\s+(.*\S)\s*$/;
/** The dialog footer must be near the bottom: below it there's at most the prompt box and status line. */
const FOOTER_SEARCH_LINES = 8;

export function parseDialog(screen: string): ScreenDialog | undefined {
  const lines = screen.split('\n').map(l => l.replace(/\s+$/, ''));
  const nonEmpty = lines.map((l, i) => [l, i] as const).filter(([l]) => l.trim());
  const footer = nonEmpty.slice(-FOOTER_SEARCH_LINES).find(([l]) => FOOTER.test(l));
  if (!footer) return undefined;

  // The dialog block starts after the nearest rule above the footer that has something above the options.
  let start = 0;
  for (let i = footer[1] - 1; i >= 0; i--) {
    if (RULE.test(lines[i]) && lines.slice(i + 1, footer[1]).some(l => l.trim() && !OPTION.test(l) && !RULE.test(l))) {
      start = i + 1;
      break;
    }
  }
  const block = lines.slice(start, footer[1]).filter(l => l.trim() && !RULE.test(l));

  const options: ScreenDialog['options'] = [];
  let selected: number | undefined;
  const text: string[] = [];
  for (const l of block) {
    const m = OPTION.exec(l);
    if (m) {
      // Some dialogs put a description column after the label, separated by a run of spaces.
      options.push({ n: Number(m[2]), label: m[3].split(/\s{2,}/)[0] });
      if (m[1]) selected = Number(m[2]);
    } else if (!options.length) {
      text.push(l.trim().replace(/^☐\s*/, ''));
    }
  }
  if (!options.length || !text.length) return undefined;
  return { title: text[0], body: text.slice(1).join(' ') || undefined, options, selected };
}
