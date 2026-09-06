import React, { useState, useMemo } from 'react';
import type { AggregatedMetrics, LeaderboardData } from '../lib/leaderboard';

interface LeaderboardProps {
  data: LeaderboardData;
}

type Measurement = 'avgTTFT' | 'avgITL' | 'avgGenTPS' | 'avgTotalTPS';

// Higher is better for TPS; lower is better for TTFT and ITL
const higherIsBetter: Record<Measurement, boolean> = {
  avgTTFT: false,
  avgITL: false,
  avgGenTPS: true,
  avgTotalTPS: true,
};

const measurementLabels: Record<Measurement, string> = {
  avgTTFT: 'Avg TTFT (s)',
  avgITL: 'Avg ITL (ms)',
  avgGenTPS: 'Avg Gen TPS',
  avgTotalTPS: 'Avg Total TPS',
};

const measurementShort: Record<Measurement, string> = {
  avgTTFT: 'TTFT',
  avgITL: 'ITL',
  avgGenTPS: 'Gen TPS',
  avgTotalTPS: 'Total TPS',
};

// Provider color map — stable hues per provider name
const PROVIDER_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#84cc16',
];
function providerColor(providers: string[], name: string): string {
  const idx = providers.indexOf(name);
  return PROVIDER_PALETTE[idx % PROVIDER_PALETTE.length];
}

function RankBadge({ rank, sortDir }: { rank: number; sortDir: 'asc' | 'desc' }) {
  if (rank === 1 && sortDir === 'desc') {
    return (
      <span style={{ fontSize: '1.1rem', lineHeight: 1 }} title="1st place">
        🥇
      </span>
    );
  }
  if (rank === 2 && sortDir === 'desc') {
    return (
      <span style={{ fontSize: '1.1rem', lineHeight: 1 }} title="2nd place">
        🥈
      </span>
    );
  }
  if (rank === 3 && sortDir === 'desc') {
    return (
      <span style={{ fontSize: '1.1rem', lineHeight: 1 }} title="3rd place">
        🥉
      </span>
    );
  }
  return (
    <span
      style={{
        display: 'inline-block',
        width: '1.4rem',
        textAlign: 'center',
        fontVariantNumeric: 'tabular-nums',
        color: '#94a3b8',
        fontSize: '0.8rem',
        fontWeight: 600,
      }}
    >
      {rank}
    </span>
  );
}

function PerformanceBar({
  value,
  max,
  min,
  higherBetter,
  color,
}: {
  value: number;
  max: number;
  min: number;
  higherBetter: boolean;
  color: string;
}) {
  const range = max - min || 1;
  const pct = higherBetter
    ? ((value - min) / range) * 100
    : ((max - value) / range) * 100;
  const clamped = Math.max(4, Math.min(100, pct));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <span
        style={{
          fontFamily: "'JetBrains Mono', 'Fira Mono', 'Courier New', monospace",
          fontSize: '0.78rem',
          fontWeight: 600,
          color: '#1e293b',
          letterSpacing: '-0.01em',
        }}
      >
        {value.toFixed(value < 10 ? 2 : 1)}
      </span>
      <div
        style={{
          height: '4px',
          borderRadius: '2px',
          background: '#e2e8f0',
          width: '100%',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            borderRadius: '2px',
            background: color,
            width: `${clamped}%`,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: string;
}) {
  return (
    <div
      style={{
        borderRadius: '8px',
        padding: '1rem 1.25rem',
        background: '#f8fafc',
        borderLeft: `3px solid ${accent}`,
        borderTop: '1px solid #e2e8f0',
        borderRight: '1px solid #e2e8f0',
        borderBottom: '1px solid #e2e8f0',
      }}
    >
      <div
        style={{
          fontSize: '0.7rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: '#64748b',
          marginBottom: '0.3rem',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', 'Fira Mono', monospace",
          fontSize: '1.5rem',
          fontWeight: 700,
          color: accent,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

type SortDir = 'asc' | 'desc';
// null column means "sort by overall metric (best-first per hiBetter)"
type SortState = { col: string | null; dir: SortDir };

function SortIcon({ dir, active }: { dir: SortDir | null; active: boolean }) {
  const up = active && dir === 'asc';
  const down = active && dir === 'desc';
  return (
    <span
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        marginLeft: '4px',
        gap: '1px',
        verticalAlign: 'middle',
        opacity: active ? 1 : 0.35,
      }}
    >
      <svg width="7" height="5" viewBox="0 0 7 5">
        <path d="M3.5 0L7 5H0z" fill={up ? '#2563eb' : '#94a3b8'} />
      </svg>
      <svg width="7" height="5" viewBox="0 0 7 5">
        <path d="M3.5 5L0 0H7z" fill={down ? '#2563eb' : '#94a3b8'} />
      </svg>
    </span>
  );
}

export const LeaderboardTable: React.FC<LeaderboardProps> = ({ data }) => {
  const [selectedProviders, setSelectedProviders] = useState<Set<string> | null>(null);
  const [measurement, setMeasurement] = useState<Measurement>('avgGenTPS');
  const [onlyLatest, setOnlyLatest] = useState(false);
  const [sort, setSort] = useState<SortState>({ col: null, dir: 'desc' });
  const [isDescExpanded, setIsDescExpanded] = useState(false);

  const isAllMode = selectedProviders === null;

  // When metric changes, reset sort to Overall and pick the natural "best first" direction
  const handleMeasurementChange = (m: Measurement) => {
    setMeasurement(m);
    setSort({ col: null, dir: higherIsBetter[m] ? 'desc' : 'asc' });
  };

  // Cycle sort: clicking active col toggles asc↔desc; clicking a new col sets desc first
  const handleColSort = (col: string | null) => {
    setSort(prev => {
      if (prev.col === col) {
        return { col, dir: prev.dir === 'desc' ? 'asc' : 'desc' };
      }
      return { col, dir: 'desc' };
    });
  };

  const filteredRows = useMemo(() => {
    let rows = isAllMode
      ? data.rows
      : data.rows.filter(row => selectedProviders!.has(row.provider));
    if (onlyLatest) {
      const latestMap = new Map<string, AggregatedMetrics>();
      for (const row of rows) {
        const existing = latestMap.get(row.provider + '/' + row.model);
        if (!existing || row.latestTimestamp > existing.latestTimestamp) {
          latestMap.set(row.provider + '/' + row.model, row);
        }
      }
      rows = Array.from(latestMap.values());
    }
    return rows;
  }, [data.rows, selectedProviders, isAllMode, onlyLatest]);

  // Compute per-column min/max for performance bars
  const colStats = useMemo(() => {
    const vals = filteredRows.map(r => r[measurement]);
    const max = Math.max(...vals, 0);
    const min = Math.min(...vals, 0);
    const catStats: Record<string, { max: number; min: number }> = {};
    for (const cat of data.allCategories) {
      const catVals = filteredRows
        .map(r => r.categoryMetrics[cat]?.[measurement])
        .filter((v): v is number => v !== undefined);
      catStats[cat] = {
        max: Math.max(...catVals, 0),
        min: Math.min(...catVals, 0),
      };
    }
    return { max, min, catStats };
  }, [filteredRows, measurement, data.allCategories]);

  const toggleProvider = (provider: string) => {
    if (isAllMode) {
      setSelectedProviders(new Set([provider]));
    } else {
      const newSet = new Set(selectedProviders);
      if (newSet.has(provider)) {
        newSet.delete(provider);
      } else {
        newSet.add(provider);
      }
      setSelectedProviders(newSet.size === 0 ? null : newSet);
    }
  };

  const hiBetter = higherIsBetter[measurement];

  // Sort rows: by selected column, or overall metric by default
  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((a, b) => {
      let aVal: number;
      let bVal: number;

      if (sort.col === null || sort.col === 'overall') {
        aVal = a[measurement];
        bVal = b[measurement];
      } else {
        aVal = a.categoryMetrics[sort.col]?.[measurement] ?? -Infinity;
        bVal = b.categoryMetrics[sort.col]?.[measurement] ?? -Infinity;
      }

      return sort.dir === 'desc' ? bVal - aVal : aVal - bVal;
    });
  }, [filteredRows, measurement, hiBetter, sort]);

  const ACCENT = '#2563eb';

  return (
    <div
      style={{
        width: '100%',
        fontFamily:
          "Inter, 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        color: '#1e293b',
        background: '#ffffff',
      }}
    >
      {/* Page header */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)',
          color: '#fff',
          padding: '2rem 2rem 1.75rem',
          borderRadius: '12px 12px 0 0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div
              style={{
                fontSize: '0.65rem',
                fontWeight: 700,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: '#93c5fd',
                marginBottom: '0.4rem',
              }}
            >
              UCSB AI Benchmarks
            </div>
            <h1
              style={{
                fontSize: '1.65rem',
                fontWeight: 800,
                letterSpacing: '-0.03em',
                lineHeight: 1.15,
                margin: 0,
              }}
            >
              Performance Leaderboard
            </h1>
            <p
              style={{
                marginTop: '0.5rem',
                color: '#94a3b8',
                fontSize: '0.83rem',
                lineHeight: 1.5,
              }}
            >
              Inference performance allows users to evaluate how long a model takes to process average prompts from a particular inference provider.{' '}
              {isDescExpanded ? (
                <>
                  <br /><br />
                  This leaderboard tracks four key metrics:
                  <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
                    <li><strong>Time to First Token (TTFT):</strong> Duration from sending a prompt until the first token is received.</li>
                    <li><strong>Inter-Token Latency (ITL):</strong> Average time between consecutive generated tokens.</li>
                    <li><strong>Generation Tokens per Second (Gen TPS):</strong> Speed of generating new text, excluding initial prompt processing time.</li>
                    <li><strong>Total Tokens per Second (Total TPS):</strong> Overall speed of the round-trip interaction.</li>
                  </ul>
                  A high-performing model minimizes TTFT and ITL while maximizing average tokens per second. High performance and low latency are especially relevant for products that rely on real-time user experience (like chat interfaces), whereas less performant models can still be highly valuable for asynchronous or iterative tasks (like cron jobs and batch processing). Note that these metrics measure speed and latency, not model intelligence or output quality.{' '}
                  <button 
                    onClick={() => setIsDescExpanded(false)}
                    style={{ background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline' }}
                  >
                    [see less]
                  </button>
                </>
              ) : (
                <>
                  <button 
                    onClick={() => setIsDescExpanded(true)}
                    style={{ background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline' }}
                  >
                    [see more]
                  </button>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Stats row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '0.75rem',
            marginTop: '1.5rem',
          }}
        >
          <StatCard label="Total Runs" value={data.stats.totalRuns} accent="#3b82f6" />
          <StatCard label="Benchmarks" value={data.stats.totalBenchmarks} accent="#10b981" />
          <StatCard label="Models" value={data.stats.totalModels} accent="#8b5cf6" />
          <StatCard label="Providers" value={data.stats.totalProviders} accent="#f59e0b" />
        </div>
      </div>

      {/* Controls panel */}
      <div
        style={{
          background: '#f8fafc',
          borderLeft: '1px solid #e2e8f0',
          borderRight: '1px solid #e2e8f0',
          padding: '1.25rem 2rem',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1.5rem',
          alignItems: 'flex-start',
        }}
      >
        {/* Provider chips */}
        <div style={{ flex: '1 1 auto' }}>
          <div
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: '#64748b',
              marginBottom: '0.5rem',
            }}
          >
            Provider
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
            <button
              onClick={() => setSelectedProviders(null)}
              style={{
                padding: '0.3rem 0.75rem',
                borderRadius: '999px',
                fontSize: '0.75rem',
                fontWeight: 600,
                border: isAllMode ? `1.5px solid ${ACCENT}` : '1.5px solid #cbd5e1',
                background: isAllMode ? ACCENT : '#fff',
                color: isAllMode ? '#fff' : '#475569',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              All
            </button>
            {data.stats.providers.map(provider => {
              const active = !isAllMode && selectedProviders!.has(provider);
              const color = providerColor(data.stats.providers, provider);
              return (
                <button
                  key={provider}
                  onClick={() => toggleProvider(provider)}
                  style={{
                    padding: '0.3rem 0.75rem',
                    borderRadius: '999px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    border: active ? `1.5px solid ${color}` : '1.5px solid #cbd5e1',
                    background: active ? color : '#fff',
                    color: active ? '#fff' : '#475569',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                  }}
                >
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: active ? '#fff' : color,
                      flexShrink: 0,
                    }}
                  />
                  {provider}
                </button>
              );
            })}
          </div>
        </div>

        {/* Measurement select */}
        <div style={{ flexShrink: 0 }}>
          <div
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: '#64748b',
              marginBottom: '0.5rem',
            }}
          >
            Metric
          </div>
          <select
            value={measurement}
            onChange={e => handleMeasurementChange(e.target.value as Measurement)}
            style={{
              padding: '0.35rem 2rem 0.35rem 0.75rem',
              borderRadius: '6px',
              border: '1.5px solid #cbd5e1',
              background: '#fff',
              color: '#1e293b',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
              appearance: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2364748b'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 0.6rem center',
              outline: 'none',
            }}
          >
            {(Object.keys(measurementLabels) as Measurement[]).map(key => (
              <option key={key} value={key}>
                {measurementLabels[key]}
              </option>
            ))}
          </select>
        </div>

        {/* Latest only toggle */}
        <div style={{ flexShrink: 0 }}>
          <div
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: '#64748b',
              marginBottom: '0.5rem',
            }}
          >
            Filter
          </div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 500,
              color: '#475569',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={onlyLatest}
              onChange={e => setOnlyLatest(e.target.checked)}
              style={{ width: '14px', height: '14px', accentColor: ACCENT, cursor: 'pointer' }}
            />
            Most recent only
          </label>
        </div>
      </div>

      {/* Results count */}
      <div
        style={{
          padding: '0.5rem 2rem',
          fontSize: '0.72rem',
          color: '#94a3b8',
          background: '#f8fafc',
          borderLeft: '1px solid #e2e8f0',
          borderRight: '1px solid #e2e8f0',
          fontWeight: 500,
          letterSpacing: '0.01em',
        }}
      >
        Showing <strong style={{ color: '#475569' }}>{sortedRows.length}</strong> of{' '}
        <strong style={{ color: '#475569' }}>{data.rows.length}</strong> models &mdash; sorted by{' '}
        <strong style={{ color: ACCENT }}>
          {sort.col === null
            ? measurementLabels[measurement] + ' (overall)'
            : sort.col.replace(/_/g, ' ') + ' — ' + measurementLabels[measurement]}
        </strong>{' '}
        ({sort.col === null
          ? hiBetter ? 'higher is better' : 'lower is better'
          : sort.dir === 'desc' ? 'high → low' : 'low → high'})
      </div>

      {/* Table */}
      <div
        style={{
          overflowX: 'auto',
          border: '1px solid #e2e8f0',
          borderTop: 'none',
          borderRadius: '0 0 12px 12px',
        }}
      >
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '0.8rem',
          }}
        >
          <thead>
            <tr
              style={{
                background: '#f1f5f9',
                borderBottom: '2px solid #cbd5e1',
              }}
            >
              {/* Rank */}
              <th
                style={{
                  position: 'sticky',
                  left: 0,
                  zIndex: 20,
                  background: '#f1f5f9',
                  padding: '0.7rem 0.75rem',
                  textAlign: 'center',
                  fontWeight: 700,
                  fontSize: '0.65rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: '#64748b',
                  width: '2.5rem',
                  borderRight: '1px solid #e2e8f0',
                }}
              >
                #
              </th>
              {/* Model */}
              <th
                style={{
                  position: 'sticky',
                  left: '2.5rem',
                  zIndex: 20,
                  background: '#f1f5f9',
                  padding: '0.7rem 1rem',
                  textAlign: 'left',
                  fontWeight: 700,
                  fontSize: '0.65rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: '#64748b',
                  minWidth: '220px',
                  borderRight: '1px solid #e2e8f0',
                }}
              >
                Model
              </th>
              {/* Runs */}
              <th
                style={{
                  padding: '0.7rem 0.75rem',
                  textAlign: 'center',
                  fontWeight: 700,
                  fontSize: '0.65rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: '#64748b',
                  width: '4rem',
                  borderRight: '1px solid #e2e8f0',
                }}
              >
                Runs
              </th>
              {/* Overall metric */}
              <th
                onClick={() => handleColSort(null)}
                style={{
                  padding: '0.7rem 1rem',
                  textAlign: 'left',
                  fontWeight: 700,
                  fontSize: '0.65rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: sort.col === null ? ACCENT : '#64748b',
                  minWidth: '110px',
                  borderRight: '2px solid #cbd5e1',
                  background: sort.col === null ? '#eff6ff' : '#f1f5f9',
                  cursor: 'pointer',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                Overall
                <SortIcon dir={sort.dir} active={sort.col === null} />
                <br />
                <span style={{ color: '#94a3b8', fontWeight: 600 }}>
                  {measurementShort[measurement]}
                </span>
              </th>
              {/* Category columns */}
              {data.allCategories.map(category => {
                const isActive = sort.col === category;
                return (
                  <th
                    key={category}
                    onClick={() => handleColSort(category)}
                    style={{
                      padding: '0.7rem 1rem',
                      textAlign: 'left',
                      fontWeight: 700,
                      fontSize: '0.65rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: isActive ? ACCENT : '#64748b',
                      minWidth: '120px',
                      borderRight: '1px solid #e2e8f0',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                      userSelect: 'none',
                      background: isActive ? '#eff6ff' : '#f1f5f9',
                      transition: 'background 0.1s, color 0.1s',
                    }}
                  >
                    {category.replace(/_/g, ' ')}
                    <SortIcon dir={sort.dir} active={isActive} />
                    <br />
                    <span style={{ color: '#94a3b8', fontWeight: 600 }}>
                      {measurementShort[measurement]}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, idx) => {
              const rank = idx + 1;
              const provColor = providerColor(data.stats.providers, row.provider);
              const isEven = idx % 2 === 0;
              return (
                <tr
                  key={`${row.provider}-${row.model}`}
                  style={{
                    background: rank <= 3
                      ? rank === 1
                        ? '#fffbeb'
                        : rank === 2
                        ? '#f8fafc'
                        : '#fafaf9'
                      : isEven
                      ? '#ffffff'
                      : '#f8fafc',
                    borderBottom: '1px solid #e2e8f0',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLTableRowElement).style.background = '#eff6ff';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLTableRowElement).style.background =
                      rank <= 3
                        ? rank === 1
                          ? '#fffbeb'
                          : rank === 2
                          ? '#f8fafc'
                          : '#fafaf9'
                        : isEven
                        ? '#ffffff'
                        : '#f8fafc';
                  }}
                >
                  {/* Rank */}
                  <td
                    style={{
                      position: 'sticky',
                      left: 0,
                      zIndex: 10,
                      background: 'inherit',
                      padding: '0.65rem 0.5rem',
                      textAlign: 'center',
                      borderRight: '1px solid #e2e8f0',
                      width: '2.5rem',
                    }}
                  >
                    <RankBadge rank={rank} sortDir={sort.dir} />
                  </td>
                  {/* Model name + provider chip */}
                  <td
                    style={{
                      position: 'sticky',
                      left: '2.5rem',
                      zIndex: 10,
                      background: 'inherit',
                      padding: '0.65rem 1rem',
                      borderRight: '1px solid #e2e8f0',
                      minWidth: '220px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '0.1rem 0.45rem',
                          borderRadius: '4px',
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          background: provColor + '18',
                          color: provColor,
                          border: `1px solid ${provColor}40`,
                          flexShrink: 0,
                        }}
                      >
                        {row.provider}
                      </span>
                      <span
                        style={{
                          fontWeight: 600,
                          color: '#1e293b',
                          fontSize: '0.8rem',
                          fontFamily: "'JetBrains Mono', 'Fira Mono', monospace",
                        }}
                      >
                        {/* Strip the provider prefix that leaderboard.ts prepends */}
                        {row.model.startsWith(row.provider + ' ')
                          ? row.model.slice(row.provider.length + 1)
                          : row.model}
                      </span>
                    </div>
                  </td>
                  {/* Run count */}
                  <td
                    style={{
                      padding: '0.65rem 0.75rem',
                      textAlign: 'center',
                      color: '#94a3b8',
                      fontFamily: "'JetBrains Mono', 'Fira Mono', monospace",
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      borderRight: '1px solid #e2e8f0',
                    }}
                  >
                    {row.runCount}
                  </td>
                  {/* Overall metric with bar */}
                  <td
                    style={{
                      padding: '0.55rem 1rem',
                      borderRight: '2px solid #cbd5e1',
                      minWidth: '110px',
                      background: rank === 1 ? '#fefce8' : 'inherit',
                    }}
                  >
                    <PerformanceBar
                      value={row[measurement]}
                      max={colStats.max}
                      min={colStats.min}
                      higherBetter={hiBetter}
                      color={ACCENT}
                    />
                  </td>
                  {/* Per-category metrics */}
                  {data.allCategories.map(category => {
                    const cm = row.categoryMetrics[category];
                    const isActive = sort.col === category;
                    return (
                      <td
                        key={category}
                        style={{
                          padding: '0.55rem 1rem',
                          borderRight: '1px solid #e2e8f0',
                          minWidth: '120px',
                          background: isActive ? 'rgba(239,246,255,0.6)' : undefined,
                        }}
                      >
                        {cm ? (
                          <PerformanceBar
                            value={cm[measurement]}
                            max={colStats.catStats[category]?.max ?? 0}
                            min={colStats.catStats[category]?.min ?? 0}
                            higherBetter={hiBetter}
                            color={isActive ? ACCENT : provColor}
                          />
                        ) : (
                          <span style={{ color: '#cbd5e1', fontSize: '0.75rem' }}>—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>

        {sortedRows.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: '3rem',
              color: '#94a3b8',
              fontSize: '0.85rem',
            }}
          >
            No data for the selected providers.
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: '0.75rem',
          fontSize: '0.7rem',
          color: '#94a3b8',
          textAlign: 'right',
          paddingRight: '0.25rem',
        }}
      >
        Bars show relative performance within the visible selection.
      </div>
    </div>
  );
};
