import * as fs from 'fs';
import { withBase } from './paths';

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
  runRefs: Record<string, { test_id: string; date: string }>;
  avg: number | null;
  lastRun: string;
}

export interface RiseStats {
  totalRuns: number;
  totalModels: number;
  providers: string[];
  benchmarks: string[];
  latestRun: string | null;
}

export interface RiseLeaderboardData {
  stats: RiseStats;
  rows: RiseRow[];
  flaggedModels: RiseRow[];
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

export interface BenchmarkMeta {
  tag: string;
  description: string;
}

// Active 6-benchmark suite first, then the 6 reserved expansion titles in stable order.
export const BENCHMARK_ORDER = [
  'book_advert_xml',
  'bibliographic_data',
  'fraktur_adverts',
  'medieval_manuscripts',
  'general_meeting_minutes',
  'magazine_pages',
  'library_cards',
  'business_letters',
  'blacklist_cards',
  'company_lists',
  'duty_rosters',
  'personnel_cards',
];

export const BENCHMARK_META: Record<string, BenchmarkMeta> = {
  book_advert_xml: {
    tag: 'Text XML · Fuzzy',
    description: 'Text-only XML data correction of 50 historical book advertisements (fuzzy match, 0-100).',
  },
  bibliographic_data: {
    tag: 'Printed List · Fuzzy',
    description: 'Structured extraction from 5 printed English bibliography pages (fuzzy match, 0-100).',
  },
  fraktur_adverts: {
    tag: 'Fraktur OCR · CER',
    description: 'Transcription of 5 printed German Fraktur advertisements (100 - CER x 100).',
  },
  medieval_manuscripts: {
    tag: 'Handwritten HTR · CER',
    description: '15th-century German manuscript transcription and marginalia segmentation across 12 folios (100 - CER x 100).',
  },
  general_meeting_minutes: {
    tag: 'Table Extraction · Fuzzy',
    description: 'Multilingual (IT/FR/DE) typed + handwritten shareholder table and signature extraction across 9 pages (fuzzy match, 0-100).',
  },
  magazine_pages: {
    tag: 'Ad Boxes · IoU F1',
    description: 'Spatial bounding-box detection of advertisements across 46 magazine pages (IoU >= 0.5 F1 x 100).',
  },
  library_cards: {
    tag: 'Catalog Cards · Fuzzy',
    description: 'Structured bibliographic extraction from handwritten/typed library catalog cards (fuzzy match, 0-100).',
  },
  business_letters: {
    tag: 'Handwritten NER · F1',
    description: 'Entity extraction from handwritten historical business correspondence (F1 x 100).',
  },
  blacklist_cards: {
    tag: 'Index Cards · Fuzzy',
    description: 'Structured field extraction from historical index cards (fuzzy match, 0-100).',
  },
  company_lists: {
    tag: 'Directory Tables · Fuzzy',
    description: 'Tabular extraction from printed company directory pages (fuzzy match, 0-100).',
  },
  duty_rosters: {
    tag: 'Roster Tables · Fuzzy',
    description: 'Structured extraction from historical duty roster tables (fuzzy match, 0-100).',
  },
  personnel_cards: {
    tag: 'Personnel Forms · Fuzzy',
    description: 'Multi-field extraction from historical personnel record cards (fuzzy match, 0-100).',
  },
};

export function benchmarkTitle(name: string): string {
  return BENCHMARK_TITLES[name] ?? name.replace(/_/g, ' ');
}

export function benchmarkMeta(name: string): BenchmarkMeta {
  return (
    BENCHMARK_META[name] ?? {
      tag: '0-100',
      description: benchmarkTitle(name),
    }
  );
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

  const allRows: RiseRow[] = [];
  for (const [, runs] of modelRuns.entries()) {
    const benchmarks: Record<string, number | null> = {};
    const runRefs: Record<string, { test_id: string; date: string }> = {};
    let lastRun = '';
    for (const run of runs) {
      benchmarks[run.benchmark] = run.normalized_score;
      runRefs[run.benchmark] = { test_id: run.test_id, date: run.date };
      if (run.date > lastRun) {
        lastRun = run.date;
      }
    }
    const scores = Object.values(benchmarks).filter(
      (v): v is number => v !== null && v !== undefined
    );
    allRows.push({
      service: runs[0].service,
      model: runs[0].model,
      vision: runs[0].vision,
      runs: runs.length,
      benchmarks,
      runRefs,
      avg: scores.length > 0 ? scores.reduce((s, v) => s + v, 0) / scores.length : null,
      lastRun,
    });
  }

  const rows = allRows
    .filter(r => r.avg === null || r.avg > 0)
    .sort((a, b) => {
      const aMulti = a.vision === true || a.runs > 1 ? 1 : 0;
      const bMulti = b.vision === true || b.runs > 1 ? 1 : 0;
      if (aMulti !== bMulti) return bMulti - aMulti;
      return (b.avg ?? -Infinity) - (a.avg ?? -Infinity);
    });

  const flaggedModels = allRows
    .filter(r => r.avg !== null && r.avg <= 0)
    .sort((a, b) => a.service.localeCompare(b.service) || a.model.localeCompare(b.model));

  const flaggedKeys = new Set(flaggedModels.map(r => `${r.service}|${r.model}`));
  const activeResults = results.filter(r => !flaggedKeys.has(`${r.service}|${r.model}`));

  const benchmarksInData = new Set(activeResults.map(r => r.benchmark));
  const allBenchmarks = BENCHMARK_ORDER.filter(name => benchmarksInData.has(name));
  // Benchmarks outside the reserved order still render (future-proofing).
  for (const name of Array.from(benchmarksInData).sort()) {
    if (!allBenchmarks.includes(name)) {
      allBenchmarks.push(name);
    }
  }

  const stats: RiseStats = {
    totalRuns: activeResults.length,
    totalModels: rows.length,
    providers: Array.from(new Set(activeResults.map(r => r.service))).sort(),
    benchmarks: Array.from(benchmarksInData).sort(),
    latestRun: rows.reduce<string | null>(
      (latest, r) => (r.lastRun && (latest === null || r.lastRun > latest) ? r.lastRun : latest),
      null,
    ),
  };

  return { stats, rows, flaggedModels, allBenchmarks };
}

export function getRiseDataPath(): string {
  const dashboardDir = process.cwd();
  const projectRoot = dashboardDir.replace('/dashboard', '');
  return `${projectRoot}/data/rise_results.jsonl`;
}

export function riseDetailPath(ref: { test_id: string; date: string }): string {
  return withBase(`data/details/rise/${ref.date}/${ref.test_id}.json`);
}
