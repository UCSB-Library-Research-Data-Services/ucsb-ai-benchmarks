import * as fs from 'fs';
import { parseRiseResults, aggregateRiseData, getRiseDataPath } from '../../lib/rise';

export const GET = async () => {
  try {
    const dataPath = getRiseDataPath();

    if (!fs.existsSync(dataPath)) {
      return new Response(
        JSON.stringify({
          error: 'RISE results file not found',
          path: dataPath,
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const results = parseRiseResults(dataPath);
    const riseData = aggregateRiseData(results);

    return new Response(JSON.stringify(riseData), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error loading RISE leaderboard data:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to load RISE leaderboard data',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
