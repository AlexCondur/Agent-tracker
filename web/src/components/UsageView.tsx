import { useEffect, useState } from 'react';
import { formatCost } from '../models.ts';
import { href } from '../route.ts';
import { DailyCostChart, type DailyRow } from './DailyCostChart.tsx';

interface Usage {
  since: string;
  totals: { today: number; week: number; month: number; all: number };
  daily: DailyRow[];
  byRepo: { repo: string; cost: number; sessions: number }[];
  topSessions: { id: string; title: string | null; repo: string | null; worktree: string | null; cost: number }[];
  check: { claude: number | null; ours: number | null; sessions: number };
  unpriced: number;
}

const RANGES = [7, 30, 90];
/** Single-series bars use the sequential default hue. */
const BAR_COLOR = '#3987e5';

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-zinc-900 px-4 py-3 ring-1 ring-zinc-800">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">{formatCost(value)}</div>
    </div>
  );
}

export function UsageView() {
  const [days, setDays] = useState(30);
  const [usage, setUsage] = useState<Usage>();

  useEffect(() => {
    fetch(`/api/usage?days=${days}`).then(async r => setUsage((await r.json()) as Usage));
  }, [days]);

  if (!usage) return <div className="p-5 text-sm text-zinc-500">Loading…</div>;
  const coverage = usage.check.claude && usage.check.ours ? Math.round((usage.check.ours / usage.check.claude) * 100) : undefined;
  const maxRepo = Math.max(...usage.byRepo.map(r => r.cost), 0.01);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Today" value={usage.totals.today} />
        <Tile label="Last 7 days" value={usage.totals.week} />
        <Tile label="Last 30 days" value={usage.totals.month} />
        <Tile label="All time" value={usage.totals.all} />
      </div>
      <p className="text-xs text-zinc-500">
        Estimated from the tokens in your transcripts at API list prices.
        {coverage !== undefined &&
          ` That comes to ${coverage}% of Claude Code's own totals for the ${usage.check.sessions} sessions that record one; the rest is background calls (auto-mode checks, titles) that transcripts don't include.`}
        {usage.unpriced > 0 && ` ${usage.unpriced} responses use a model with no known price and aren't counted.`}
      </p>

      <section className="rounded-lg bg-zinc-900 p-4 ring-1 ring-zinc-800">
        <div className="mb-3 flex items-center">
          <h2 className="text-sm font-medium text-zinc-200">Cost per day</h2>
          <div className="ml-auto flex gap-1">
            {RANGES.map(r => (
              <button
                key={r}
                onClick={() => setDays(r)}
                className={`rounded px-2 py-0.5 text-xs ${r === days ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                {r}d
              </button>
            ))}
          </div>
        </div>
        <DailyCostChart rows={usage.daily} since={usage.since} />
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-lg bg-zinc-900 p-4 ring-1 ring-zinc-800">
          <h2 className="mb-3 text-sm font-medium text-zinc-200">By repo · last {days} days</h2>
          <div className="space-y-2">
            {usage.byRepo.map(r => (
              <div key={r.repo}>
                <div className="flex justify-between text-xs">
                  <span className="truncate text-zinc-300">
                    {r.repo} <span className="text-zinc-500">· {r.sessions} sessions</span>
                  </span>
                  <span className="tabular-nums text-zinc-200">{formatCost(r.cost)}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-zinc-800">
                  <div className="h-1.5 rounded-full" style={{ width: `${(r.cost / maxRepo) * 100}%`, background: BAR_COLOR }} />
                </div>
              </div>
            ))}
            {!usage.byRepo.length && <p className="text-xs text-zinc-500">No usage in this range.</p>}
          </div>
        </section>

        <section className="rounded-lg bg-zinc-900 p-4 ring-1 ring-zinc-800">
          <h2 className="mb-3 text-sm font-medium text-zinc-200">Most expensive sessions · last {days} days</h2>
          <div className="divide-y divide-zinc-800/80">
            {usage.topSessions.map(s => (
              <a key={s.id} href={href({ view: 'history', sessionId: s.id })} className="flex gap-3 py-1.5 text-xs hover:text-zinc-100">
                <span className="min-w-0 flex-1 truncate text-zinc-300">{s.title ?? s.id.slice(0, 8)}</span>
                <span className="shrink-0 text-zinc-500">{s.worktree ?? s.repo}</span>
                <span className="w-14 shrink-0 text-right tabular-nums text-zinc-200">{formatCost(s.cost)}</span>
              </a>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
