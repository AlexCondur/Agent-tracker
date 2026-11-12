import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { sendInput } from '../api.ts';

/**
 * Replies the browser terminal generates to the program's capability queries (device attributes,
 * cursor position, focus reports...). The user's real terminal already answers these, so forwarding
 * them would type garbage into the session.
 */
const TERMINAL_REPORT = /^(\x1b\[[?>=]?[\d;]*[cnR]|\x1b\[\?[\d;]*\$y|\x1b\[[IO]|\x1b\][\s\S]*(\x07|\x1b\\)|\x1bP[\s\S]*\x1b\\)$/;

/** DECSET mouse-tracking modes (X10, VT200, highlight, button/any-event, UTF-8/SGR/urxvt/pixel encodings). */
const MOUSE_MODES = new Set(['9', '1000', '1001', '1002', '1003', '1005', '1006', '1015', '1016']);

/**
 * Removes mouse-tracking enables from program output, so the mirror never enters mouse mode: drags select
 * text (instead of becoming mouse reports for the app). The user's real
 * terminal owns mouse interaction with the session. A trailing incomplete escape is held back and
 * prepended to the next chunk, so a sequence split across chunks is still caught.
 */
function mouseModeFilter() {
  let pending = '';
  return (chunk: string) => {
    let data = pending + chunk;
    const tail = /\x1b(\[[?\d;]*)?$/.exec(data);
    pending = tail ? tail[0] : '';
    if (tail) data = data.slice(0, tail.index);
    return data.replace(/\x1b\[\?([\d;]*)h/g, (_, params: string) => {
      const kept = params.split(';').filter(p => !MOUSE_MODES.has(p));
      return kept.length ? `\x1b[?${kept.join(';')}h` : '';
    });
  };
}

/** Monospace glyph width relative to font size, used to fit the session's columns into the panel. */
const CHAR_WIDTH_RATIO = 0.602;
/** Row height relative to font size (slightly generous), used to fit the session's rows into the panel. */
const LINE_HEIGHT_RATIO = 1.2;

/** DECSET modes that turn mouse reporting on (X10, VT200, button-event, any-event). */
const MOUSE_TRACKING = new Set(['9', '1000', '1002', '1003']);
/**
 * Whether the program wants mouse reports, read from its raw output (the mirror's xterm never sees
 * the enables, they're stripped). `current` carries the state across chunks.
 */
function wantsMouse(data: string, current: boolean) {
  for (const [, params, set] of data.matchAll(/\x1b\[\?([\d;]+)([hl])/g)) {
    if (params.split(';').some(p => MOUSE_TRACKING.has(p))) current = set === 'h';
  }
  return current;
}

/** Ctrl+L: Claude clears and redraws its screen, refilling a mirror that missed earlier output. */
export const redraw = (sessionId: string) => sendInput(sessionId, { data: '\x0c' }).catch(() => {});

/** True if the snapshot draws nothing visible (only mode switches), e.g. ct reconnected without replaying. */
const isBlank = (data: string) => data.replace(/\x1b\[[\d;?]*[a-zA-Z]|\x1b[\]P][\s\S]*?(\x07|\x1b\\)|\s/g, '') === '';

/** Live mirror of a ct session's terminal. Typing here types into the session. */
export function TerminalView({ sessionId }: { sessionId: string }) {
  const root = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [ended, setEnded] = useState(false);
  const [blank, setBlank] = useState(false);

  useEffect(() => {
    const el = host.current!;
    const box = root.current!;
    const term = new Terminal({
      fontFamily: 'SF Mono, Menlo, Monaco, monospace',
      fontSize: 12,
      scrollback: 1000,
      theme: { background: '#00000000' },
      allowTransparency: true,
    });
    term.open(el);
    setEnded(false);

    // Keep the session's size (it belongs to the real terminal); scale the font so both its columns
    // and its rows fit the panel instead (a tall PTY would otherwise hide its bottom, where the prompt is).
    const fit = () => {
      const byWidth = box.clientWidth / (term.cols * CHAR_WIDTH_RATIO);
      const byHeight = box.clientHeight / (term.rows * LINE_HEIGHT_RATIO);
      term.options.fontSize = Math.max(6, Math.min(13, Math.floor(Math.min(byWidth, byHeight))));
    };
    const ro = new ResizeObserver(fit);
    ro.observe(box);

    let stripMouse = mouseModeFilter();
    let mouse = false;
    const es = new EventSource(`/api/sessions/${sessionId}/terminal`);
    es.addEventListener('init', e => {
      const { cols, rows, data } = JSON.parse(e.data) as { cols: number; rows: number; data: string };
      term.reset();
      mouse = wantsMouse(data, false);
      term.resize(cols, rows);
      fit();
      stripMouse = mouseModeFilter();
      term.write(stripMouse(data), () => term.scrollToBottom());
      setBlank(isBlank(data));
    });
    es.addEventListener('output', e => {
      const data = JSON.parse(e.data) as string;
      mouse = wantsMouse(data, mouse);
      term.write(stripMouse(data));
      if (!isBlank(data)) setBlank(false);
    });
    es.addEventListener('resize', e => {
      const { cols, rows } = JSON.parse(e.data) as { cols: number; rows: number };
      term.resize(cols, rows);
      fit();
    });
    es.addEventListener('end', () => {
      setEnded(true);
      es.close();
    });

    // Claude Code draws in the alternate screen, which has no scrollback: its conversation scrolls
    // inside the app, driven by mouse wheel reports. So when the program wants mouse reports, the wheel
    // is forwarded as SGR wheel reports (this scrolls the real terminal too: it's the same screen), as a
    // real terminal would. Mouse mode alone decides: a mirror rebuilt after a daemon restart may have
    // missed the alt-screen switch but still sees mouse mode, which Claude re-enables as it redraws.
    // Otherwise xterm scrolls its own scrollback, if any; with none it would turn the wheel into
    // Up/Down keys (scrolling prompt history in the session), so the wheel is ignored there.
    let wheelPx = 0;
    term.attachCustomWheelEventHandler(ev => {
      if (!mouse) return term.buffer.active.length > term.rows;
      if (ev.deltaY === 0 || ev.shiftKey) return false;
      ev.preventDefault();
      const screen = el.querySelector('.xterm-screen')!.getBoundingClientRect();
      const cell = screen.height / term.rows;
      wheelPx += ev.deltaMode === WheelEvent.DOM_DELTA_LINE ? ev.deltaY * cell : ev.deltaMode === WheelEvent.DOM_DELTA_PAGE ? ev.deltaY * screen.height : ev.deltaY;
      const lines = Math.trunc(wheelPx / cell);
      if (lines === 0) return false;
      wheelPx -= lines * cell;
      const col = Math.min(term.cols, Math.max(1, Math.ceil((ev.clientX - screen.left) / (screen.width / term.cols))));
      const row = Math.min(term.rows, Math.max(1, Math.ceil((ev.clientY - screen.top) / cell)));
      // One report per line scrolled (Claude moves one line per report), so the content follows the wheel.
      const report = `\x1b[<${lines < 0 ? 64 : 65};${col};${row}M`;
      sendInput(sessionId, { data: report.repeat(Math.min(Math.abs(lines), term.rows)) }).catch(() => {});
      return false;
    });

    const input = term.onData(data => {
      if (!TERMINAL_REPORT.test(data)) sendInput(sessionId, { data }).catch(() => {});
    });

    return () => {
      input.dispose();
      es.close();
      ro.disconnect();
      term.dispose();
    };
  }, [sessionId]);

  return (
    <div ref={root} className="relative h-full">
      <div ref={host} className="min-h-40 overflow-hidden" />
      {blank && !ended && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black text-sm text-zinc-400">
          <p>The screen hasn’t been captured yet (the daemon restarted since it was drawn).</p>
          <button className="rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-600" onClick={() => redraw(sessionId)}>
            Redraw screen (Ctrl+L)
          </button>
        </div>
      )}
      {ended && <div className="absolute inset-x-0 top-0 z-10 bg-zinc-900/90 p-2 text-center text-xs text-zinc-400">ct disconnected</div>}
    </div>
  );
}
