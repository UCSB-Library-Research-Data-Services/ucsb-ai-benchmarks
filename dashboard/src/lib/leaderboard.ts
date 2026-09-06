import * as fs from 'fs';
import * as path from 'path';

export interface PerformanceResult {
  service: string;
  model: string;
  test_id: string;
  category: string;
  timestamp: string;
  total_time_sec: number;
  ttft_sec: number;
  itl_ms_per_token: number;
  generation_tps: number;
  total_tps: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface AggregatedMetrics {
  model: string;
  provider: string;
  runCount: number;
  latestTimestamp: string;
  avgTTFT: number;
  avgITL: number;
  avgGenTPS: number;
  avgTotalTPS: number;
  categoryMetrics: {
    [category: string]: {
      avgTTFT: number;
      avgITL: number;
      avgGenTPS: number;
      avgTotalTPS: number;
      runCount: number;
    };
  };
}

export interface LeaderboardStats {
  totalRuns: number;
  totalBenchmarks: number;
  totalModels: number;
  totalProviders: number;
  providers: string[];
  categories: string[];
}

export interface LeaderboardData {
  stats: LeaderboardStats;
  rows: AggregatedMetrics[];
  allCategories: string[];
}

export function parsePerformanceResults(filePath: string): PerformanceResult[] {
  if (!fs.existsSync(filePath)) {
    console.warn(`File not found: ${filePath}`);
    return [];
  }

  const results: PerformanceResult[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  for (const line of lines) {
    try {
      const data = JSON.parse(line);
      results.push(data as PerformanceResult);
    } catch (e) {
      console.error(`Error parsing line: ${line}`, e);
    }
  }

  return results;
}

export function aggregatePerformanceData(
  results: PerformanceResult[],
  onlyLatest: boolean = false
): LeaderboardData {
  const modelMap = new Map<string, PerformanceResult[]>();
  const categoriesSet = new Set<string>();
  let totalBenchmarks = 0;
  const providersSet = new Set<string>();

  // Filter out Dreamlab
  const filteredResults = results.filter(r => !r.service?.toLowerCase().includes('dreamlab'));

  // Collect unique service values as providers
  for (const result of filteredResults) {
    providersSet.add(result.service);
  }

  // Group by model
  for (const result of filteredResults) {
    categoriesSet.add(result.category);
    const key = result.model;
    if (!modelMap.has(key)) {
      modelMap.set(key, []);
    }
    modelMap.get(key)!.push(result);
  }

  // Get latest run per model if requested
  let resultsToProcess = filteredResults;
  if (onlyLatest) {
    const latestMap = new Map<string, PerformanceResult>();
    for (const result of filteredResults) {
      const key = result.model;
      const existing = latestMap.get(key);
      if (!existing || new Date(result.timestamp) > new Date(existing.timestamp)) {
        latestMap.set(key, result);
      }
    }
    resultsToProcess = Array.from(latestMap.values());
  }

  totalBenchmarks = filteredResults.length;

  // Aggregate metrics per model
  const rows: AggregatedMetrics[] = [];
  const modelGrouped = new Map<string, PerformanceResult[]>();

  for (const result of resultsToProcess) {
    const key = result.model;
    if (!modelGrouped.has(key)) {
      modelGrouped.set(key, []);
    }
    modelGrouped.get(key)!.push(result);
  }

  for (const [model, results] of modelGrouped.entries()) {
    const provider = results[0].service;
    providersSet.add(provider);

    // Calculate category-level metrics
    const categoryMap = new Map<string, PerformanceResult[]>();
    for (const result of results) {
      if (!categoryMap.has(result.category)) {
        categoryMap.set(result.category, []);
      }
      categoryMap.get(result.category)!.push(result);
    }

    const categoryMetrics: AggregatedMetrics['categoryMetrics'] = {};
    for (const [category, categoryResults] of categoryMap.entries()) {
      const avgTTFT = categoryResults.reduce((sum, r) => sum + r.ttft_sec, 0) / categoryResults.length;
      const avgITL = categoryResults.reduce((sum, r) => sum + r.itl_ms_per_token, 0) / categoryResults.length;
      const avgGenTPS = categoryResults.reduce((sum, r) => sum + r.generation_tps, 0) / categoryResults.length;
      const avgTotalTPS = categoryResults.reduce((sum, r) => sum + r.total_tps, 0) / categoryResults.length;

      categoryMetrics[category] = {
        avgTTFT,
        avgITL,
        avgGenTPS,
        avgTotalTPS,
        runCount: categoryResults.length,
      };
    }

    // Calculate overall metrics
    const avgTTFT = results.reduce((sum, r) => sum + r.ttft_sec, 0) / results.length;
    const avgITL = results.reduce((sum, r) => sum + r.itl_ms_per_token, 0) / results.length;
    const avgGenTPS = results.reduce((sum, r) => sum + r.generation_tps, 0) / results.length;
    const avgTotalTPS = results.reduce((sum, r) => sum + r.total_tps, 0) / results.length;
    const latestTimestamp = results.reduce((latest, r) => 
      new Date(r.timestamp) > new Date(latest) ? r.timestamp : latest
    , results[0].timestamp);

    rows.push({
      model: `${provider} ${model}`,
      provider,
      runCount: results.length,
      latestTimestamp,
      avgTTFT,
      avgITL,
      avgGenTPS,
      avgTotalTPS,
      categoryMetrics,
    });
  }

  const stats: LeaderboardStats = {
    totalRuns: filteredResults.length,
    totalBenchmarks: totalBenchmarks,
    totalModels: modelGrouped.size,
    totalProviders: providersSet.size,
    providers: Array.from(providersSet).sort(),
    categories: Array.from(categoriesSet).sort(),
  };

  const allCategories = Array.from(categoriesSet).sort();

  return {
    stats,
    rows: rows.sort((a, b) => b.avgGenTPS - a.avgGenTPS), // Sort by throughput descending
    allCategories,
  };
}

export function getLeaderboardDataPath(): string {
  // Return path relative to project root
  return path.join(process.cwd(), '..', 'data', 'performance_results.jsonl');
}
