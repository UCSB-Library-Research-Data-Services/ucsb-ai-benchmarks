import * as fs from 'fs';
import * as path from 'path';

export interface ScicodeProblem {
  problem_id: string;
  problem_correct: number;
  total_correct: number;
  total_steps: number;
  output_tokens: number;
  reasoning_tokens: number | null;
  model_time_sec: number;
}

export interface ScicodeResult {
  service: string;
  model: string;
  log_file: string;
  split: string;
  with_background: boolean;
  mode: string;
  timestamp: string;
  started_at: string;
  completed_at: string;
  wall_time_sec: number;
  num_problems: number;
  main_resolve_rate: number;
  sub_step_accuracy: number;
  steps_passed: number;
  steps_total: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_reasoning_tokens: number | null;
  avg_output_tokens_per_task: number;
  avg_reasoning_tokens_per_task: number | null;
  avg_answer_tokens_per_task: number;
  avg_model_time_min_per_task: number;
  problems: ScicodeProblem[];
}

export interface ScicodeRow {
  provider: string;
  model: string;
  split: string;
  runCount: number;
  latestTimestamp: string;
  logFile: string;
  numProblems: number;
  mainResolveRate: number;
  subStepAccuracy: number;
  stepsPassed: number;
  stepsTotal: number;
  avgOutputTokensPerTask: number;
  avgReasoningTokensPerTask: number | null;
  avgAnswerTokensPerTask: number;
  totalOutputTokens: number;
  avgModelTimeMin: number;
  withBackground: boolean;
}

export interface ScicodeStats {
  totalRuns: number;
  totalModels: number;
  totalProviders: number;
  providers: string[];
  latestRun: string | null;
}

export interface ScicodeLeaderboardData {
  stats: ScicodeStats;
  rows: ScicodeRow[];
}

export function parseScicodeResults(filePath: string): ScicodeResult[] {
  if (!fs.existsSync(filePath)) {
    console.warn(`File not found: ${filePath}`);
    return [];
  }

  const results: ScicodeResult[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  for (const line of lines) {
    try {
      results.push(JSON.parse(line) as ScicodeResult);
    } catch (e) {
      console.error(`Error parsing line: ${line}`, e);
    }
  }

  return results;
}

export function aggregateScicodeData(results: ScicodeResult[]): ScicodeLeaderboardData {
  const filteredResults = results.filter(r => !r.service?.toLowerCase().includes('dreamlab'));

  const providersSet = new Set<string>();
  for (const result of filteredResults) {
    providersSet.add(result.service);
  }

  const modelMap = new Map<string, ScicodeResult[]>();
  for (const result of filteredResults) {
    const key = `${result.service}|${result.model}`;
    if (!modelMap.has(key)) {
      modelMap.set(key, []);
    }
    modelMap.get(key)!.push(result);
  }

  const rows: ScicodeRow[] = [];
  for (const [key, runs] of modelMap.entries()) {
    const sepIdx = key.indexOf('|');
    const provider = key.slice(0, sepIdx);
    const model = key.slice(sepIdx + 1);

    const splitMap = new Map<string, ScicodeResult[]>();
    for (const run of runs) {
      if (!splitMap.has(run.split)) {
        splitMap.set(run.split, []);
      }
      splitMap.get(run.split)!.push(run);
    }

    for (const [split, splitRuns] of splitMap.entries()) {
      const sorted = [...splitRuns].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      const latest = sorted[0];
      rows.push({
        provider,
        model,
        split,
        runCount: splitRuns.length,
        latestTimestamp: latest.timestamp,
        logFile: latest.log_file,
        numProblems: latest.num_problems,
        mainResolveRate: latest.main_resolve_rate * 100,
        subStepAccuracy: latest.sub_step_accuracy * 100,
        stepsPassed: latest.steps_passed,
        stepsTotal: latest.steps_total,
        avgOutputTokensPerTask: latest.avg_output_tokens_per_task,
        avgReasoningTokensPerTask: latest.avg_reasoning_tokens_per_task,
        avgAnswerTokensPerTask: latest.avg_answer_tokens_per_task,
        totalOutputTokens: latest.total_output_tokens,
        avgModelTimeMin: latest.avg_model_time_min_per_task,
        withBackground: latest.with_background,
      });
    }
  }

  const latestRun = rows.reduce<string | null>(
    (latest, r) => (latest === null || r.latestTimestamp > latest ? r.latestTimestamp : latest),
    null
  );

  const stats: ScicodeStats = {
    totalRuns: filteredResults.length,
    totalModels: modelMap.size,
    totalProviders: providersSet.size,
    providers: Array.from(providersSet).sort(),
    latestRun,
  };

  return {
    stats,
    rows: rows.sort((a, b) => b.mainResolveRate - a.mainResolveRate),
  };
}

export function getScicodeDataPath(): string {
  return path.join(process.cwd(), '..', 'data', 'scicode_results.jsonl');
}

export function scicodeDetailPath(logFile: string): string {
  const stem = logFile.replace(/\.eval$/, '');
  return `${import.meta.env.BASE_URL}data/details/scicode/${stem}.json`;
}
