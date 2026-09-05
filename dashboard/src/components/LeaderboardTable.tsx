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
  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(
    new Set(data.stats.providers)
  );
  const [measurement, setMeasurement] = useState<Measurement>('avgGenTPS');
  const [onlyLatest, setOnlyLatest] = useState(false);

  // Filter rows based on selected providers
  const filteredRows = useMemo(() => {
    return data.rows.filter(row => selectedProviders.has(row.provider));
  }, [data.rows, selectedProviders]);

  const toggleProvider = (provider: string) => {
    const newSet = new Set(selectedProviders);
    if (newSet.has(provider)) {
      newSet.delete(provider);
    } else {
      newSet.add(provider);
    }
    setSelectedProviders(newSet);
  };

  const toggleAllProviders = () => {
    if (selectedProviders.size === data.stats.providers.length) {
      setSelectedProviders(new Set());
    } else {
      setSelectedProviders(new Set(data.stats.providers));
    }
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
            <button
              onClick={toggleAllProviders}
              className="text-sm px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded transition"
            >
              {selectedProviders.size === data.stats.providers.length ? 'Clear' : 'All'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.stats.providers.map(provider => (
              <button
                key={provider}
                onClick={() => toggleProvider(provider)}
                className={`px-4 py-2 rounded-lg font-medium transition ${
                  selectedProviders.has(provider)
                    ? 'bg-blue-600 text-white'
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
              <th className="px-4 py-3 text-left font-semibold text-gray-900 border-r border-gray-300">
                Model
              </th>
              <th className="px-4 py-3 text-center font-semibold text-gray-900 border-r border-gray-300 w-20">
                # of Runs
              </th>
              <th className="px-4 py-3 text-center font-semibold text-gray-900 border-r border-gray-300 w-32">
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
                <td className="px-4 py-3 font-medium text-gray-900 border-r border-gray-200">
                  {row.model}
                </td>
                <td className="px-4 py-3 text-center text-gray-700 border-r border-gray-200">
                  {row.runCount}
                </td>
                <td className="px-4 py-3 text-center font-semibold text-blue-600 border-r border-gray-200">
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
