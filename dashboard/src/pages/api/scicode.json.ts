import * as fs from 'fs';
import * as path from 'path';
import { parseScicodeResults, aggregateScicodeData } from '../../lib/scicode';

export const GET = async () => {
  try {
    const workspaceRoot = path.resolve(process.cwd(), '..');
    const dataPath = path.join(workspaceRoot, 'data', 'scicode_results.jsonl');

    if (!fs.existsSync(dataPath)) {
      return new Response(
        JSON.stringify({
          error: 'SciCode results file not found',
          path: dataPath,
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const results = parseScicodeResults(dataPath);
    const scicodeData = aggregateScicodeData(results);

    return new Response(JSON.stringify(scicodeData), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error loading SciCode leaderboard data:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to load SciCode leaderboard data',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
