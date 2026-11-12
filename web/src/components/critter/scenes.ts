/**
 * Pixel-art scenes for the agent critter: a 32×24 grid per frame, drawn with a few primitives so the
 * scenes stay editable. Letters are palette keys (see PALETTES in Critter.tsx); '.' is transparent.
 */

export const W = 32;
export const H = 24;

export type Scene = 'work' | 'chill' | 'alert' | 'wave' | 'sleep';
type Grid = string[][];

const blank = (): Grid => Array.from({ length: H }, () => Array<string>(W).fill('.'));

function rect(g: Grid, x: number, y: number, w: number, h: number, c: string): void {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (j >= 0 && j < H && i >= 0 && i < W) g[j][i] = c;
}

/** Draws a small bitmap ('#' = colour c) with its top-left at x, y. */
function glyph(g: Grid, x: number, y: number, rows: string[], c: string): void {
  rows.forEach((row, j) => [...row].forEach((ch, i) => ch === '#' && rect(g, x + i, y + j, 1, 1, c)));
}

type Eyes = 'open' | 'wide' | 'down' | 'closed' | 'happy';

/**
 * The critter: a 12-wide blocky body (rounded corners, light top, shaded bottom), two eyes, and legs
 * unless it's sitting or lying down. x, y is the body's top-left.
 */
function critter(g: Grid, x: number, y: number, opts: { h?: number; eyes: Eyes; legs?: boolean }): void {
  const h = opts.h ?? 8;
  rect(g, x, y, 12, h, 'C');
  rect(g, x + 1, y, 10, 1, 'L');
  rect(g, x, y + h - 1, 12, 1, 'D');
  for (const [cx, cy] of [[x, y], [x + 11, y], [x, y + h - 1], [x + 11, y + h - 1]]) rect(g, cx, cy, 1, 1, '.');
  const ey = y + 2;
  const eyes: Record<Eyes, () => void> = {
    open: () => (rect(g, x + 3, ey, 1, 2, 'E'), rect(g, x + 8, ey, 1, 2, 'E')),
    wide: () => (rect(g, x + 2, ey, 2, 2, 'E'), rect(g, x + 8, ey, 2, 2, 'E')),
    down: () => (rect(g, x + 3, ey + 1, 1, 2, 'E'), rect(g, x + 8, ey + 1, 1, 2, 'E')),
    closed: () => (rect(g, x + 2, ey + 1, 2, 1, 'E'), rect(g, x + 8, ey + 1, 2, 1, 'E')),
    // ^ ^
    happy: () => {
      glyph(g, x + 2, ey, ['.#.', '#.#'], 'E');
      glyph(g, x + 7, ey, ['.#.', '#.#'], 'E');
    },
  };
  eyes[opts.eyes]();
  if (opts.legs !== false) for (const lx of [1, 3, 8, 10]) rect(g, x + lx, y + h, 1, 2, 'D');
}

const shadow = (g: Grid, x: number, w: number, y = 21) => rect(g, x, y, w, 1, 'S');

/** Typing at a laptop, eyes on the screen; bits of code float up. */
function work(frame: number): Grid {
  const g = blank();
  critter(g, 10, 7, { eyes: 'down', legs: false });
  // Laptop lid (back to us) with a dot of a logo, then its base on the desk.
  rect(g, 8, 13, 16, 6, 'G');
  rect(g, 8, 13, 16, 1, 'g');
  rect(g, 15, 15, 2, 2, 'C');
  rect(g, 6, 19, 20, 1, 'g');
  shadow(g, 5, 22, 20);
  // Hands on the keyboard edge, alternating (darker, so they show against the body).
  rect(g, 11, frame ? 11 : 12, 2, 2, 'D');
  rect(g, 19, frame ? 12 : 11, 2, 2, 'D');
  // Bits rising from the keyboard.
  const bits = frame ? [[5, 9], [26, 6], [4, 4]] : [[5, 11], [26, 8], [27, 3]];
  for (const [bx, by] of bits) rect(g, bx, by, 1, 1, 'T');
  return g;
}

/** Leaning back with a steaming mug while something runs in the background. */
function chill(frame: number): Grid {
  const g = blank();
  critter(g, 9, 11, { eyes: 'happy', h: 8 });
  shadow(g, 9, 12);
  rect(g, 21, 15, 2, 1, 'C'); // arm to the mug
  rect(g, 23, 13, 3, 4, 'W'); // mug
  rect(g, 26, 14, 1, 2, 'W'); // handle
  rect(g, 23, 13, 3, 1, 'V'); // coffee
  const steam = [
    [[24, 11], [23, 10], [24, 9]],
    [[23, 11], [24, 10], [25, 8]],
    [[24, 11], [25, 10], [24, 8]],
  ][frame % 3];
  for (const [sx, sy] of steam) rect(g, sx, sy, 1, 1, 'M');
  // A foot tapping.
  if (frame === 1) rect(g, 19, 19, 1, 2, '.'), rect(g, 19, 19, 2, 1, 'D');
  return g;
}

/** Jumping with both arms up and a big "!": it needs you. */
function alert(frame: number): Grid {
  const g = blank();
  const y = frame ? 7 : 10;
  critter(g, 10, y, { eyes: 'wide' });
  rect(g, 8, y - 3, 2, 4, 'C');
  rect(g, 22, y - 3, 2, 4, 'C');
  shadow(g, frame ? 12 : 11, frame ? 8 : 10);
  // "!" in a bubble.
  const by = frame ? 0 : 1;
  rect(g, 25, by, 5, 9, 'B');
  for (const [cx, cy] of [[25, by], [29, by], [25, by + 8], [29, by + 8]]) rect(g, cx, cy, 1, 1, '.');
  rect(g, 27, by + 1, 1, 4, 'A');
  rect(g, 27, by + 6, 1, 1, 'A');
  return g;
}

/** Waving with a "…" bubble: done, your move. */
function wave(frame: number): Grid {
  const g = blank();
  critter(g, 10, 11, { eyes: 'open' });
  shadow(g, 10, 12);
  rect(g, 8, 14, 2, 2, 'C'); // resting arm
  if (frame) rect(g, 22, 8, 2, 5, 'C');
  else rect(g, 22, 12, 2, 2, 'C'), rect(g, 23, 10, 2, 2, 'C');
  // "…" bubble with a tail.
  rect(g, 24, 2, 7, 5, 'B');
  for (const [cx, cy] of [[24, 2], [30, 2], [24, 6], [30, 6]]) rect(g, cx, cy, 1, 1, '.');
  rect(g, 25, 7, 1, 1, 'B');
  for (const dx of [25, 27, 29]) rect(g, dx, 4, 1, 1, 'E');
  return g;
}

/** Asleep, breathing slowly, with Zs drifting up. */
function sleep(frame: number): Grid {
  const g = blank();
  const h = frame % 2 ? 6 : 7;
  const y = 21 - h;
  critter(g, 9, y, { h, eyes: 'closed', legs: false });
  // Nightcap, drooping to the right, with a pom-pom.
  rect(g, 13, y - 1, 6, 1, 'N');
  rect(g, 16, y - 2, 5, 1, 'N');
  rect(g, 19, y - 3, 3, 1, 'N');
  rect(g, 22, y - 3, 1, 1, 'W');
  shadow(g, 8, 14);
  const big = ['####', '..#.', '.#..', '####'];
  const small = ['##.', '.#.', '.##'];
  const zs = [
    [[23, 10, small]],
    [[24, 8, small], [26, 3, big]],
    [[23, 10, small], [27, 1, big]],
  ][frame % 3] as [number, number, string[]][];
  for (const [zx, zy, rows] of zs) glyph(g, zx, zy, rows, 'Z');
  return g;
}

/** Each scene's frames and how long each frame shows. */
export const SCENES: Record<Scene, { frames: Grid[]; ms: number }> = {
  work: { frames: [work(0), work(1)], ms: 220 },
  chill: { frames: [chill(0), chill(1), chill(2)], ms: 500 },
  alert: { frames: [alert(0), alert(1)], ms: 320 },
  wave: { frames: [wave(0), wave(1)], ms: 450 },
  sleep: { frames: [sleep(0), sleep(1), sleep(2)], ms: 900 },
};

/** A frame as horizontal runs of one colour, so it renders as few SVG rects. */
export function runs(g: Grid): { x: number; y: number; w: number; c: string }[] {
  const out: { x: number; y: number; w: number; c: string }[] = [];
  g.forEach((row, y) => {
    let x = 0;
    while (x < W) {
      const c = row[x];
      let w = 1;
      while (x + w < W && row[x + w] === c) w++;
      if (c !== '.') out.push({ x, y, w, c });
      x += w;
    }
  });
  return out;
}
