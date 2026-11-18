export interface BaselineTier {
  service: string;
  runs: Record<string, number>;
  latest: Record<string, string | null>;
  values: {
    performance?: Record<string, Record<string, number>>;
    rise?: { score?: Record<string, number> };
    scicode?: { resolve?: Record<string, number>; substep?: Record<string, number> };
  };
}

export interface BaselinesFile {
  generated_at: string;
  tiers: Record<string, BaselineTier>;
}

export interface Boundary {
  value: number;
  tier: string;
}

export const BAND_PALETTE = ['#9ecae1', '#4292c6', '#2171b5', '#084594'];
export const NO_BASELINE_COLOR = '#cbd5e1';

export const PERF_METRIC_KEY = {
  avgTTFT: 'ttft_sec',
  avgITL: 'itl_ms_per_token',
  avgGenTPS: 'generation_tps',
  avgTotalTPS: 'total_tps',
} as const;

export function tierValue(
  tier: BaselineTier,
  suite: 'performance' | 'rise' | 'scicode',
  metric: string,
  key: string,
): number | undefined {
  let v: number | undefined;
  if (suite === 'performance') v = tier.values.performance?.[metric]?.[key];
  else if (suite === 'rise') v = tier.values.rise?.score?.[key];
  else if (metric === 'resolve') v = tier.values.scicode?.resolve?.[key];
  else v = tier.values.scicode?.substep?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

// Boundaries are the baseline tier values for one metric, sorted ascending.
// Tiers without a value drop out. Equal values collapse into one boundary.
export function baselineBoundaries(
  baselines: BaselinesFile | null | undefined,
  suite: 'performance' | 'rise' | 'scicode',
  metric: string,
  key: string,
): Boundary[] {
  if (!baselines) return [];
  const raw: Boundary[] = [];
  for (const [name, tier] of Object.entries(baselines.tiers)) {
    const v = tierValue(tier, suite, metric, key);
    if (v !== undefined) raw.push({ value: v, tier: name });
  }
  raw.sort((a, b) => a.value - b.value || a.tier.localeCompare(b.tier));
  const merged: Boundary[] = [];
  for (const b of raw) {
    const last = merged[merged.length - 1];
    if (last && last.value === b.value) last.tier = `${last.tier}/${b.tier}`;
    else merged.push({ ...b });
  }
  return merged;
}

// Quality rank of a value: 0 = weakest band, n = strongest. Lower-is-better
// metrics invert the rank. Returns null when fewer than two boundaries exist.
export function bandRank(value: number, boundaries: Boundary[], higherIsBetter: boolean): number | null {
  const n = boundaries.length;
  if (n < 2) return null;
  const passed = boundaries.filter(b => value >= b.value).length;
  return higherIsBetter ? passed : n - passed;
}

export function bandColor(value: number, boundaries: Boundary[], higherIsBetter: boolean): string {
  const rank = bandRank(value, boundaries, higherIsBetter);
  if (rank === null) return NO_BASELINE_COLOR;
  const n = boundaries.length;
  const idx = Math.round((rank * (BAND_PALETTE.length - 1)) / n);
  return BAND_PALETTE[idx];
}

export function bandTooltip(boundaries: Boundary[], higherIsBetter: boolean, fmt: (v: number) => string): string {
  if (boundaries.length < 2) return 'No baseline for this metric';
  const parts = boundaries.map(b => `${fmt(b.value)} (${b.tier})`);
  const dir = higherIsBetter ? 'higher is better' : 'lower is better';
  return `Baselines: ${parts.join(', ')} · ${dir}`;
}
