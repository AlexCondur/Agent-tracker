/**
 * Fixed model → color mapping (color follows the model, never its rank). Dark-mode categorical slots 1–4
 * of the reference palette, validated against the card surface #18181b (all checks pass).
 */
const MODELS: { prefix: string; label: string; color: string }[] = [
  { prefix: 'claude-opus-5-5', label: 'Opus 5.5', color: '#3987e5' },
  { prefix: 'claude-sonnet-5-5', label: 'Sonnet 5.5', color: '#d95926' },
  { prefix: 'claude-haiku-5-5', label: 'Haiku 5.5', color: '#199e70' },
  { prefix: 'claude-fable-5-1', label: 'Fable 5.1', color: '#c98500' },
];
export const OTHER_MODEL = { label: 'Other', color: '#71717a' };
export const MODEL_ORDER = [...MODELS.map(m => m.label), OTHER_MODEL.label];

export function modelGroup(model: string | null | undefined): { label: string; color: string } {
  return MODELS.find(m => model?.startsWith(m.prefix)) ?? OTHER_MODEL;
}

/** Readable name for any model id, e.g. claude-opus-4-8 → Opus 4.8. */
export function modelName(model: string | null | undefined): string {
  if (!model) return 'unknown';
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : model;
}

export function formatCost(n: number | null | undefined): string {
  if (n == null) return '–';
  return n >= 100 ? `$${Math.round(n)}` : n >= 0.01 ? `$${n.toFixed(2)}` : n > 0 ? '<$0.01' : '$0';
}
