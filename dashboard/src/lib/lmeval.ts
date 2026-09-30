import * as fs from 'fs';
import * as path from 'path';

export interface LmevalTaskScore {
  [metric: string]: number | undefined;
}

export interface LmevalResult {
  service: string;
  model: string;
  timestamp: string;
  tasks: Record<string, LmevalTaskScore>;
  composite_score: number | null;
  total_tokens: number | null;
  wall_time_sec: number | null;
  log_dir: string;
}

export interface LmevalRow {
  provider: string;
  model: string;
  timestamp: string;
  mmlu: number | null;
  gsm8k: number | null;
  arc_challenge: number | null;
  hellaswag: number | null;
  winogrande: number | null;
  truthfulqa_mc2: number | null;
  composite_score: number | null;
  wall_time_sec: number | null;
  log_dir: string;
}

export interface LmevalStats {
  totalRuns: number;
  totalModels: number;
  totalProviders: number;
  providers: string[];
  latestRun: string | null;
}

export interface LmevalLeaderboardData {
  stats: LmevalStats;
  rows: LmevalRow[];
}

/** Primary metric name for each lm-eval task. */
const TASK_PRIMARY_METRIC: Record<string, string> = {
  mmlu: 'acc',
  gsm8k: 'exact_match',
  arc_challenge: 'acc_norm',
  hellaswag: 'acc_norm',
  winogrande: 'acc',
  truthfulqa_mc2: 'acc',
};

function extractPrimary(tasks: Record<string, LmevalTaskScore>, taskName: string): number | null {
  const entry = tasks[taskName];
  if (!entry) return null;
  const metric = TASK_PRIMARY_METRIC[taskName];
  if (!metric) return null;
  const val = entry[metric];
  return typeof val === 'number' ? val : null;
}

export function parseLmevalResults(filePath: string): LmevalResult[] {
  if (!fs.existsSync(filePath)) {
    console.warn(`File not found: ${filePath}`);
    return [];
  }

  const results: LmevalResult[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  for (const line of lines) {
    try {
      results.push(JSON.parse(line) as LmevalResult);
    } catch (e) {
      console.error(`Error parsing line: ${line}`, e);
    }
  }

  return results;
}

export function aggregateLmevalData(results: LmevalResult[]): LmevalLeaderboardData {
  const providersSet = new Set<string>();
  for (const result of results) {
    providersSet.add(result.service);
  }

  // Group by (provider, model), pick latest run per pair
  const modelMap = new Map<string, LmevalResult[]>();
  for (const result of results) {
    const key = `${result.service}|${result.model}`;
    if (!modelMap.has(key)) {
      modelMap.set(key, []);
    }
    modelMap.get(key)!.push(result);
  }

  const rows: LmevalRow[] = [];
  for (const [key, runs] of modelMap.entries()) {
    const sepIdx = key.indexOf('|');
    const provider = key.slice(0, sepIdx);
    const model = key.slice(sepIdx + 1);

    // Pick the latest run
    const sorted = [...runs].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    const latest = sorted[0];

    rows.push({
      provider,
      model,
      timestamp: latest.timestamp,
      mmlu: extractPrimary(latest.tasks, 'mmlu'),
      gsm8k: extractPrimary(latest.tasks, 'gsm8k'),
      arc_challenge: extractPrimary(latest.tasks, 'arc_challenge'),
      hellaswag: extractPrimary(latest.tasks, 'hellaswag'),
      winogrande: extractPrimary(latest.tasks, 'winogrande'),
      truthfulqa_mc2: extractPrimary(latest.tasks, 'truthfulqa_mc2'),
      composite_score: latest.composite_score,
      wall_time_sec: latest.wall_time_sec,
      log_dir: latest.log_dir,
    });
  }

  const latestRun = rows.reduce<string | null>(
    (latest, r) => (latest === null || r.timestamp > latest ? r.timestamp : latest),
    null
  );

  const stats: LmevalStats = {
    totalRuns: results.length,
    totalModels: modelMap.size,
    totalProviders: providersSet.size,
    providers: Array.from(providersSet).sort(),
    latestRun,
  };

  return {
    stats,
    rows: rows.sort((a, b) => (b.composite_score ?? 0) - (a.composite_score ?? 0)),
  };
}

export function getLmevalDataPath(): string {
  return path.join(process.cwd(), '..', 'data', 'lmeval_results.jsonl');
}
