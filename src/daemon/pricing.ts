/**
 * $ per million tokens, first-party API rates (Claude API reference, cached 2026-10-06).
 * Cache writes: 1.25× input for the 5-minute cache, 2× for the 1-hour cache.
 * Verified against Claude Code's own cost-state records (Opus 5.5 and Haiku 5.5 match to the cent).
 */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

const PRICES: [prefix: string, price: Price][] = [
  ['claude-fable-5-1', { input: 10, output: 50, cacheRead: 0.25 }],
  ['claude-fable-5', { input: 10, output: 50, cacheRead: 1 }],
  ['claude-mythos-5', { input: 10, output: 50, cacheRead: 1 }],
  ['claude-opus-5-5', { input: 4, output: 20, cacheRead: 0.2 }],
  ['claude-opus-5', { input: 5, output: 25, cacheRead: 0.5 }],
  ['claude-opus-4', { input: 5, output: 25, cacheRead: 0.5 }],
  ['claude-sonnet-5-5', { input: 2, output: 10, cacheRead: 0.2 }],
  ['claude-sonnet-5', { input: 2, output: 10, cacheRead: 0.2 }],
  ['claude-sonnet-4', { input: 3, output: 15, cacheRead: 0.3 }],
  ['claude-haiku-5-5', { input: 0.1, output: 0.5, cacheRead: 0.01 }],
  ['claude-haiku-4', { input: 1, output: 5, cacheRead: 0.1 }],
];

/** Fast mode bills at twice the standard rate. */
const FAST_MULTIPLIER = 2;

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  speed?: string;
}

/** Estimated $ for one API response; undefined for models we have no price for. */
export function costOf(model: string | undefined, u: Usage | undefined): number | undefined {
  if (!model || !u) return undefined;
  const price = PRICES.find(([prefix]) => model.startsWith(prefix))?.[1];
  if (!price) return undefined;
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const write5m = u.cache_creation ? (u.cache_creation.ephemeral_5m_input_tokens ?? 0) : (u.cache_creation_input_tokens ?? 0);
  const dollars =
    ((u.input_tokens ?? 0) * price.input +
      (u.output_tokens ?? 0) * price.output +
      (u.cache_read_input_tokens ?? 0) * price.cacheRead +
      write5m * price.input * 1.25 +
      write1h * price.input * 2) /
    1_000_000;
  return u.speed === 'fast' ? dollars * FAST_MULTIPLIER : dollars;
}
