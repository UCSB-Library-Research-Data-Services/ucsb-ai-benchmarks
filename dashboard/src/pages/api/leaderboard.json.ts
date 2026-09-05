import * as fs from 'fs';
import * as path from 'path';
import { parsePerformanceResults, aggregatePerformanceData } from '../../lib/leaderboard';

export const GET = async () => {
  try {
    // Get the performance results file path
    const workspaceRoot = path.resolve(process.cwd(), '..');
    const dataPath = path.join(workspaceRoot, 'data', 'performance_results.jsonl');

    if (!fs.existsSync(dataPath)) {
      return new Response(
        JSON.stringify({
          error: 'Performance results file not found',
          path: dataPath,
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Parse and aggregate the data
    const results = parsePerformanceResults(dataPath);
    const leaderboardData = aggregatePerformanceData(results, false);

    return new Response(JSON.stringify(leaderboardData), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error loading leaderboard data:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to load leaderboard data',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
