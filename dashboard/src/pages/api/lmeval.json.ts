import * as fs from 'fs';
import * as path from 'path';
import { parseLmevalResults, aggregateLmevalData } from '../../lib/lmeval';

export const GET = async () => {
  try {
    const workspaceRoot = path.resolve(process.cwd(), '..');
    const dataPath = path.join(workspaceRoot, 'data', 'lmeval_results.jsonl');

    if (!fs.existsSync(dataPath)) {
      return new Response(
        JSON.stringify({
          error: 'lm-eval results file not found',
          path: dataPath,
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const results = parseLmevalResults(dataPath);
    const lmevalData = aggregateLmevalData(results);

    return new Response(JSON.stringify(lmevalData), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error loading lm-eval leaderboard data:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to load lm-eval leaderboard data',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
