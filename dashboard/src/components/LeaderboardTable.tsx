import React, { useState, useMemo } from 'react';
import type { AggregatedMetrics, LeaderboardData } from '../lib/leaderboard';

interface LeaderboardProps {
  data: LeaderboardData;
}

type Measurement = 'avgTTFT' | 'avgITL' | 'avgGenTPS' | 'avgTotalTPS';

const measurementLabels: Record<Measurement, string> = {
  avgTTFT: 'Avg TTFT (s)',
  avgITL: 'Avg ITL (ms)',
  avgGenTPS: 'Avg Gen TPS',
  avgTotalTPS: 'Avg Total TPS',
};

export const LeaderboardTable: React.FC<LeaderboardProps> = ({ data }) => {
  // null = "All" mode (no filter); a Set means specific providers are selected
  const [selectedProviders, setSelectedProviders] = useState<Set<string> | null>(null);
  const [measurement, setMeasurement] = useState<Measurement>('avgGenTPS');
  const [onlyLatest, setOnlyLatest] = useState(false);

  const isAllMode = selectedProviders === null;

  // Filter rows based on selected providers
  const filteredRows = useMemo(() => {
    if (isAllMode) return data.rows;
    return data.rows.filter(row => selectedProviders!.has(row.provider));
  }, [data.rows, selectedProviders, isAllMode]);

  const toggleProvider = (provider: string) => {
    if (isAllMode) {
      // Landing state: clicking a provider enters filter mode with just that one
      setSelectedProviders(new Set([provider]));
    } else {
      const newSet = new Set(selectedProviders);
      if (newSet.has(provider)) {
        newSet.delete(provider);
      } else {
        newSet.add(provider);
      }
      // If nothing remains selected, fall back to All
      setSelectedProviders(newSet.size === 0 ? null : newSet);
    }
  };

  const selectAllProviders = () => {
    setSelectedProviders(null);
  };

  const formatValue = (value: number, key: Measurement): string => {
    if (key === 'avgTTFT' || key === 'avgITL') {
      return value.toFixed(2);
    }
    return value.toFixed(1);
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-6 bg-white rounded-lg shadow">
      {/* Header Stats */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-4 text-gray-900">Performance Leaderboard</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
            <div className="text-sm font-semibold text-blue-900">Total Runs</div>
            <div className="text-2xl font-bold text-blue-600">{data.stats.totalRuns}</div>
          </div>
          <div className="bg-green-50 p-4 rounded-lg border border-green-200">
            <div className="text-sm font-semibold text-green-900">Benchmarks</div>
            <div className="text-2xl font-bold text-green-600">{data.stats.totalBenchmarks}</div>
          </div>
          <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
            <div className="text-sm font-semibold text-purple-900">Models</div>
            <div className="text-2xl font-bold text-purple-600">{data.stats.totalModels}</div>
          </div>
          <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
            <div className="text-sm font-semibold text-orange-900">Providers</div>
            <div className="text-2xl font-bold text-orange-600">{data.stats.totalProviders}</div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="mb-8 space-y-4">
        {/* Provider Filter */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold text-gray-900">Filter by Provider</h2>
          </div>
           <div className="flex flex-wrap gap-2">
             <button
               onClick={selectAllProviders}
               className={`px-4 py-2 rounded-lg font-medium transition ${
                 isAllMode
                   ? 'bg-blue-600 text-white hover:bg-blue-700'
                   : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
               }`}
             >
               All
             </button>
             {data.stats.providers.map(provider => (
               <button
                 key={provider}
                 onClick={() => toggleProvider(provider)}
                 className={`px-4 py-2 rounded-lg font-medium transition ${
                   !isAllMode && selectedProviders!.has(provider)
                     ? 'bg-blue-600 text-white hover:bg-blue-700'
                     : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                 }`}
               >
                 {provider}
               </button>
             ))}
          </div>
        </div>

        {/* Measurement Selector and Toggle */}
        <div className="flex flex-col md:flex-row gap-4 md:items-center">
          <div>
            <label htmlFor="measurement" className="block text-sm font-medium text-gray-900 mb-2">
              Measurement
            </label>
            <select
              id="measurement"
              value={measurement}
              onChange={e => setMeasurement(e.target.value as Measurement)}
              className="px-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 hover:border-gray-400 focus:outline-none focus:border-blue-500"
            >
              {(Object.keys(measurementLabels) as Measurement[]).map(key => (
                <option key={key} value={key}>
                  {measurementLabels[key]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="latest-only"
              checked={onlyLatest}
              onChange={e => setOnlyLatest(e.target.checked)}
              className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            />
            <label htmlFor="latest-only" className="text-sm font-medium text-gray-900">
              Only most recent runs
            </label>
          </div>
        </div>
      </div>

      {/* Results info */}
      <div className="mb-4 text-sm text-gray-600">
        Showing {filteredRows.length} of {data.rows.length} models
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-100 border-b border-gray-300">
              <th className="sticky left-0 z-20 bg-gray-100 px-4 py-3 text-left font-semibold text-gray-900 border-r border-gray-300 min-w-[200px]">
                Model
              </th>
              <th className="sticky left-[200px] z-20 bg-gray-100 px-4 py-3 text-center font-semibold text-gray-900 border-r border-gray-300 w-20">
                # of Runs
              </th>
              <th className="sticky left-[280px] z-20 bg-gray-100 px-4 py-3 text-center font-semibold text-gray-900 border-r border-gray-300 w-32">
                Overall<br />
                {measurementLabels[measurement]}
              </th>
              {data.allCategories.map(category => (
                <th
                  key={category}
                  className="px-4 py-3 text-center font-semibold text-gray-900 border-r border-gray-300 min-w-32"
                >
                  {category}
                  <br />
                  {measurementLabels[measurement]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, idx) => (
              <tr
                key={idx}
                className={`border-b border-gray-200 ${idx % 2 === 0 ? 'bg-gray-50' : 'bg-white'} hover:bg-blue-50 transition`}
              >
                <td className="sticky left-0 z-10 px-4 py-3 font-medium text-gray-900 border-r border-gray-200 min-w-[200px] bg-inherit">
                  {row.model}
                </td>
                <td className="sticky left-[200px] z-10 px-4 py-3 text-center text-gray-700 border-r border-gray-200 w-20 bg-inherit">
                  {row.runCount}
                </td>
                <td className="sticky left-[280px] z-10 px-4 py-3 text-center font-semibold text-blue-600 border-r border-gray-200 w-32 bg-inherit">
                  {formatValue(row[measurement], measurement)}
                </td>
                {data.allCategories.map(category => (
                  <td
                    key={category}
                    className="px-4 py-3 text-center text-gray-700 border-r border-gray-200"
                  >
                    {row.categoryMetrics[category]
                      ? formatValue(row.categoryMetrics[category][measurement], measurement)
                      : '-'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredRows.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          No data available for the selected providers.
        </div>
      )}
    </div>
  );
};
