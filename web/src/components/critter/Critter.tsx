import { useSyncExternalStore } from 'react';
import { isUnread, type Session } from '../../api.ts';
import { H, runs, SCENES, W, type Scene } from './scenes.ts';

const SHARED = {
  E: '#18181b', // eyes
  S: '#27272a', // ground shadow
  G: '#3f3f46', // laptop
  g: '#71717a',
  T: '#6ee7b7', // flying bits
  W: '#e4e4e7', // mug
  V: '#78350f', // coffee
  M: '#a1a1aa', // steam
  B: '#e4e4e7', // speech bubble
  A: '#f59e0b', // "!"
  Z: '#a5b4fc', // Zs
  N: '#6366f1', // nightcap
};

/** Claude sessions get an orange critter, Cursor ones a silver one. */
const PALETTES: Record<Session['tool'], Record<string, string>> = {
  claude: { ...SHARED, C: '#D97757', D: '#B4583B', L: '#E99A80' },
  cursor: { ...SHARED, C: '#a1a1aa', D: '#71717a', L: '#d4d4d8' },
};

export function sceneOf(s: Session): Scene {
  if (s.state === 'waiting') return 'alert';
  if (s.state === 'working') return s.background ? 'chill' : 'work';
  if (s.state === 'idle' && isUnread(s)) return 'wave';
  return 'sleep';
}

// One clock for every critter, so they animate in step and only one timer runs.
const TICK_MS = 100;
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function subscribe(fn: () => void) {
  listeners.add(fn);
  timer ??= setInterval(() => {
    now = Date.now();
    listeners.forEach(l => l());
  }, TICK_MS);
  return () => {
    listeners.delete(fn);
    if (!listeners.size) clearInterval(timer), (timer = undefined);
  };
}
const useClock = () => useSyncExternalStore(subscribe, () => (reducedMotion ? 0 : now));

/** The session's critter, acting out its state. */
export function Critter({ session, className }: { session: Session; className?: string }) {
  const scene = SCENES[sceneOf(session)];
  const frame = scene.frames[Math.floor(useClock() / scene.ms) % scene.frames.length];
  const palette = PALETTES[session.tool];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} shapeRendering="crispEdges" role="img" aria-label={`${session.tool === 'cursor' ? 'Cursor' : 'Claude'} agent: ${sceneOf(session)}`}>
      {runs(frame).map(r => (
        <rect key={`${r.x},${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={palette[r.c]} />
      ))}
    </svg>
  );
}
