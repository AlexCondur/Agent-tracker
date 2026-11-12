import { useLayoutEffect, useRef, useState } from 'react';
import { MODEL_ORDER, modelGroup, OTHER_MODEL, formatCost } from '../models.ts';

export interface DailyRow {
  day: string;
  model: string | null;
  cost: number | null;
}

const HEIGHT = 220;
const PAD = { top: 12, right: 8, bottom: 22, left: 44 };
/** Surface gap between stacked segments and between bars. */
const GAP = 2;
const RADIUS = 4;

/** 1/2/5 × 10^n at or above v, so axis ticks land on round numbers. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].find(m => m * p >= v) ?? 10) * p;
}

function allDays(since: string, until: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${since}T12:00:00`); d.toLocaleDateString('sv') <= until; d.setDate(d.getDate() + 1)) out.push(d.toLocaleDateString('sv'));
  return out;
}

const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Daily estimated cost, stacked by model. */
export function DailyCostChart({ rows, since }: { rows: DailyRow[]; since: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number>();
  const [asTable, setAsTable] = useState(false);

  // Layout effect: measure before the first paint so the chart never shows at the fallback width.
  useLayoutEffect(() => {
    setWidth(host.current!.clientWidth);
    const ro = new ResizeObserver(([e]) => e.contentRect.width && setWidth(e.contentRect.width));
    ro.observe(host.current!);
    return () => ro.disconnect();
  }, []);

  const days = allDays(since, new Date().toLocaleDateString('sv'));
  const byDay = new Map(days.map(d => [d, new Map<string, number>()]));
  for (const r of rows) {
    const m = byDay.get(r.day);
    if (!m) continue;
    const label = modelGroup(r.model).label;
    m.set(label, (m.get(label) ?? 0) + (r.cost ?? 0));
  }
  const present = MODEL_ORDER.filter(label => [...byDay.values()].some(m => (m.get(label) ?? 0) > 0));
  const color = (label: string) => (label === OTHER_MODEL.label ? OTHER_MODEL.color : modelGroup(rows.find(r => modelGroup(r.model).label === label)?.model).color);
  const totals = days.map(d => [...byDay.get(d)!.values()].reduce((a, b) => a + b, 0));
  const max = niceMax(Math.max(...totals));

  const plotW = Math.max(100, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const step = plotW / days.length;
  const barW = Math.max(2, Math.min(28, step - GAP * 2));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max);
  const labelEvery = Math.ceil(days.length / Math.max(1, Math.floor(plotW / 56)));

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
        {present.map(label => (
          <span key={label} className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm" style={{ background: color(label) }} />
            {label}
          </span>
        ))}
        <button onClick={() => setAsTable(t => !t)} className="ml-auto text-zinc-500 hover:text-zinc-300">
          {asTable ? 'Show chart' : 'Show table'}
        </button>
      </div>

      <div ref={host} className="relative" style={{ display: asTable ? 'none' : undefined }}>
        <svg width={width} height={HEIGHT} role="img" aria-label="Estimated cost per day, stacked by model">
          {ticks.map(t => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="#27272a" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-zinc-500 text-[10px] tabular-nums">
                {formatCost(t)}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const x = PAD.left + i * step + (step - barW) / 2;
            let base = 0;
            const segs = present
              .map(label => ({ label, v: byDay.get(d)!.get(label) ?? 0 }))
              .filter(s => s.v > 0)
              .map(s => {
                const seg = { ...s, y0: base, y1: base + s.v };
                base += s.v;
                return seg;
              });
            return (
              <g key={d} opacity={hover === undefined || hover === i ? 1 : 0.55}>
                {segs.map((s, j) => {
                  const top = y(s.y1);
                  // GAP of surface between segments; the bottom segment sits on the baseline.
                  const h = Math.max(1, y(s.y0) - top - (j > 0 ? GAP : 0));
                  const isTop = j === segs.length - 1;
                  return isTop && h > RADIUS ? (
                    <g key={s.label}>
                      <rect x={x} y={top} width={barW} height={h} rx={Math.min(RADIUS, barW / 2)} fill={color(s.label)} />
                      <rect x={x} y={top + RADIUS} width={barW} height={h - RADIUS} fill={color(s.label)} />
                    </g>
                  ) : (
                    <rect key={s.label} x={x} y={top} width={barW} height={h} fill={color(s.label)} />
                  );
                })}
                {/* hit target: the whole column */}
                <rect x={PAD.left + i * step} y={PAD.top} width={step} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(undefined)} />
                {i % labelEvery === 0 && (
                  <text x={x + barW / 2} y={HEIGHT - 6} textAnchor="middle" className="fill-zinc-500 text-[10px]">
                    {shortDay(d)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {hover !== undefined && (
          <div
            className="pointer-events-none absolute z-10 min-w-36 rounded-md bg-zinc-800 px-2.5 py-2 text-xs shadow-lg ring-1 ring-zinc-700"
            style={{
              left: Math.min(width - 160, Math.max(0, PAD.left + hover * step + step / 2 - 72)),
              top: 0,
            }}
          >
            <div className="mb-1 flex justify-between gap-4 font-medium text-zinc-100">
              <span>{shortDay(days[hover])}</span>
              <span className="tabular-nums">{formatCost(totals[hover])}</span>
            </div>
            {present
              .filter(label => (byDay.get(days[hover])!.get(label) ?? 0) > 0)
              .map(label => (
                <div key={label} className="flex items-center justify-between gap-4 text-zinc-300">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block size-2 rounded-sm" style={{ background: color(label) }} />
                    {label}
                  </span>
                  <span className="tabular-nums">{formatCost(byDay.get(days[hover])!.get(label))}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      {asTable && (
        <table className="w-full text-left text-xs">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 font-normal">Day</th>
              {present.map(l => (
                <th key={l} className="py-1 text-right font-normal">
                  {l}
                </th>
              ))}
              <th className="py-1 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody className="tabular-nums text-zinc-300">
            {days
              .map((d, i) => ({ d, i }))
              .filter(({ i }) => totals[i] > 0)
              .reverse()
              .map(({ d, i }) => (
                <tr key={d} className="border-t border-zinc-800/80">
                  <td className="py-1">{shortDay(d)}</td>
                  {present.map(l => (
                    <td key={l} className="py-1 text-right">
                      {formatCost(byDay.get(d)!.get(l) ?? 0)}
                    </td>
                  ))}
                  <td className="py-1 text-right text-zinc-100">{formatCost(totals[i])}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
