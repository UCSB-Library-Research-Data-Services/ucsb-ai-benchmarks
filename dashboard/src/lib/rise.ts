import * as fs from 'fs';

export interface RiseResult {
  service: string;
  model: string;
  benchmark: string;
  test_id: string;
  date: string;
  normalized_score: number | null;
  vision: boolean | null;
  vision_status: string | null;
  vision_note: string | null;
  raw_scoring: Record<string, unknown>;
  num_inputs: number;
  num_scored: number;
  tokens: { input: number; output: number; total: number };
  cost_usd: number | null;
  timing: {
    mean_response_s: number | null;
    total_response_s: number | null;
    slowest_response_s: number | null;
    span_s: number | null;
  };
}

export interface RiseRow {
  service: string;
  model: string;
  vision: boolean | null;
  runs: number;
  benchmarks: Record<string, number | null>;
  avg: number | null;
  lastRun: string;
}

export interface RiseStats {
  totalRuns: number;
  totalModels: number;
  providers: string[];
  benchmarks: string[];
}

export interface RiseLeaderboardData {
  stats: RiseStats;
  rows: RiseRow[];
  allBenchmarks: string[];
}

// All 12 RISE benchmark short-titles, reserved so the table grows without code
// changes: extra columns render only when data is present.
export const BENCHMARK_TITLES: Record<string, string> = {
  book_advert_xml: 'Book Advert XML',
  bibliographic_data: 'Bibliographic Data',
  fraktur_adverts: 'Fraktur Adverts',
  library_cards: 'Library Cards',
  business_letters: 'Business Letters',
  magazine_pages: 'Magazine Pages',
  blacklist_cards: 'Blacklist Cards',
  company_lists: 'Company Lists',
  duty_rosters: 'Duty Rosters',
  general_meeting_minutes: 'General Meeting Minutes',
  medieval_manuscripts: 'Medieval Manuscripts',
  personnel_cards: 'Personnel Cards',
};

// Pilot columns first, then the reserved expansion titles in stable order.
export const BENCHMARK_ORDER = [
  'book_advert_xml',
  'bibliographic_data',
  'fraktur_adverts',
  'library_cards',
  'business_letters',
  'magazine_pages',
  'blacklist_cards',
  'company_lists',
  'duty_rosters',
  'general_meeting_minutes',
  'medieval_manuscripts',
  'personnel_cards',
];

export function benchmarkTitle(name: string): string {
  return BENCHMARK_TITLES[name] ?? name.replace(/_/g, ' ');
}

export function parseRiseResults(filePath: string): RiseResult[] {
  if (!fs.existsSync(filePath)) {
    console.warn(`File not found: ${filePath}`);
    return [];
  }

  const results: RiseResult[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  for (const line of lines) {
    try {
      results.push(JSON.parse(line) as RiseResult);
    } catch (e) {
      console.error(`Error parsing line: ${line}`, e);
    }
  }

  return results.filter(r => !r.service?.toLowerCase().includes('dreamlab'));
}

export function aggregateRiseData(results: RiseResult[]): RiseLeaderboardData {
  // Keep the latest run per (service, model, benchmark) by date.
  const latestByKey = new Map<string, RiseResult>();
  for (const result of results) {
    const key = `${result.service}|${result.model}|${result.benchmark}`;
    const existing = latestByKey.get(key);
    if (
      !existing ||
      result.date > existing.date ||
      (result.date === existing.date && result.test_id > existing.test_id)
    ) {
      latestByKey.set(key, result);
    }
  }

  // Group kept runs by service|model
  const modelRuns = new Map<string, RiseResult[]>();
  for (const result of latestByKey.values()) {
    const key = `${result.service}|${result.model}`;
    if (!modelRuns.has(key)) {
      modelRuns.set(key, []);
    }
    modelRuns.get(key)!.push(result);
  }

  const rows: RiseRow[] = [];
  for (const [key, runs] of modelRuns.entries()) {
    const benchmarks: Record<string, number | null> = {};
    let lastRun = '';
    for (const run of runs) {
      benchmarks[run.benchmark] = run.normalized_score;
      if (run.date > lastRun) {
        lastRun = run.date;
      }
    }
    const scores = Object.values(benchmarks).filter(
      (v): v is number => v !== null && v !== undefined
    );
    rows.push({
      service: runs[0].service,
      model: runs[0].model,
      vision: runs[0].vision,
      runs: runs.length,
      benchmarks,
      avg: scores.length > 0 ? scores.reduce((s, v) => s + v, 0) / scores.length : null,
      lastRun,
    });
  }

  rows.sort((a, b) => (b.avg ?? -Infinity) - (a.avg ?? -Infinity));

  const benchmarksInData = new Set(results.map(r => r.benchmark));
  const allBenchmarks = BENCHMARK_ORDER.filter(name => benchmarksInData.has(name));
  // Benchmarks outside the reserved order still render (future-proofing).
  for (const name of Array.from(benchmarksInData).sort()) {
    if (!allBenchmarks.includes(name)) {
      allBenchmarks.push(name);
    }
  }

  const stats: RiseStats = {
    totalRuns: results.length,
    totalModels: modelRuns.size,
    providers: Array.from(new Set(results.map(r => r.service))).sort(),
    benchmarks: Array.from(benchmarksInData).sort(),
  };

  return { stats, rows, allBenchmarks };
}

export function getRiseDataPath(): string {
  const dashboardDir = process.cwd();
  const projectRoot = dashboardDir.replace('/dashboard', '');
  return `${projectRoot}/data/rise_results.jsonl`;
}
