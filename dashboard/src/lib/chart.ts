export interface ScatterPoint {
  provider: string;
  model: string;
  score: number;
  time: number;
  tokens: number | null;
  runs?: number;
  isBaseline?: boolean;
  extra?: Record<string, string | number>;
}

export const BASELINE_TIERS = [
  'gemini-3.5-flash-lite',
  'gemini-3.7-flash',
  'gemini-4-hydrogen',
] as const;

export function computeParetoFrontier(points: ScatterPoint[]): ScatterPoint[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.time - b.time || b.score - a.score);
  const frontier: ScatterPoint[] = [];
  let bestScore = -Infinity;
  for (const p of sorted) {
    if (p.score > bestScore) {
      frontier.push(p);
      bestScore = p.score;
    }
  }
  return frontier;
}
