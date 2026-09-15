import React, { useState, useMemo } from 'react';
import type { RiseLeaderboardData } from '../lib/rise';
import { benchmarkTitle } from '../lib/rise';

interface RiseLeaderboardProps {
  data: RiseLeaderboardData;
}

type VisionFilter = 'all' | 'vision' | 'text';

// Provider color map — stable hues per provider name
const PROVIDER_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#84cc16',
];
function providerColor(providers: string[], name: string): string {
  const idx = providers.indexOf(name);
  return PROVIDER_PALETTE[idx % PROVIDER_PALETTE.length];
}

const ACCENT = '#2563eb';
const AVG_TOOLTIP =
  'Normalized to a 0-100 scale per benchmark ranking metric: fuzzy as-is, F1 x 100, CER inverted to 100 - CER x 100. Avg is the mean over completed benchmarks (nulls excluded).';

function RankBadge({ rank, sortDir }: { rank: number; sortDir: 'asc' | 'desc' }) {
  if (sortDir !== 'desc') {
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
  const medals: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
  if (medals[rank]) {
    return (
      <span style={{ fontSize: '1.1rem', lineHeight: 1 }} title={`${rank} place`}>
        {medals[rank]}
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

// All RISE cells share the same 0-100 normalized scale, so bars are absolute.
function ScoreBar({ value, color }: { value: number; color: string }) {
  const pct = Math.max(2, Math.min(100, value));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <span
        style={{
          fontFamily: "'JetBrains Mono', 'Fira Mono', 'Courier New', monospace",
          fontSize: '0.78rem',
          fontWeight: 600,
          color: '#1e293b',
          letterSpacing: '-0.01em',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value.toFixed(1)}
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
            width: `${pct}%`,
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

function VisionBadge({ vision }: { vision: boolean | null }) {
  if (vision === true) {
    return (
      <span
        title="Vision-capable (probed via fixture transcription)"
        style={{
          display: 'inline-block',
          padding: '0.1rem 0.45rem',
          borderRadius: '4px',
          fontSize: '0.65rem',
          fontWeight: 700,
          background: '#ecfdf5',
          color: '#047857',
          border: '1px solid #6ee7b7',
          flexShrink: 0,
        }}
      >
        👁️ vision
      </span>
    );
  }
  if (vision === false) {
    return (
      <span
        title="Not vision-capable (probed); text-only benchmarks only"
        style={{
          display: 'inline-block',
          padding: '0.1rem 0.45rem',
          borderRadius: '4px',
          fontSize: '0.65rem',
          fontWeight: 700,
          background: '#f1f5f9',
          color: '#64748b',
          border: '1px solid #cbd5e1',
          flexShrink: 0,
        }}
      >
        text-only
      </span>
    );
  }
  return (
    <span
      title="Vision capability untested"
      style={{
        display: 'inline-block',
        padding: '0.1rem 0.45rem',
        borderRadius: '4px',
        fontSize: '0.65rem',
        fontWeight: 700,
        background: '#fffbeb',
        color: '#b45309',
        border: '1px solid #fcd34d',
        flexShrink: 0,
      }}
    >
      ⚠️ untested
    </span>
  );
}

type SortDir = 'asc' | 'desc';
type SortState = { col: string; dir: SortDir };

function SortIcon({ dir, active }: { dir: SortDir; active: boolean }) {
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

export const RiseLeaderboardTable: React.FC<RiseLeaderboardProps> = ({ data }) => {
  const [selectedProviders, setSelectedProviders] = useState<Set<string> | null>(null);
  const [visionFilter, setVisionFilter] = useState<VisionFilter>('all');
  const [sort, setSort] = useState<SortState>({ col: 'avg', dir: 'desc' });
  const [isDescExpanded, setIsDescExpanded] = useState(false);

  const isAllMode = selectedProviders === null;

  const handleColSort = (col: string) => {
    setSort(prev => {
      if (prev.col === col) {
        return { col, dir: prev.dir === 'desc' ? 'asc' : 'desc' };
      }
      return { col, dir: 'desc' };
    });
  };

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

  const filteredRows = useMemo(() => {
    let rows =
      isAllMode
        ? data.rows
        : data.rows.filter(row => selectedProviders!.has(row.service));
    if (visionFilter === 'vision') {
      rows = rows.filter(row => row.vision === true);
    } else if (visionFilter === 'text') {
      rows = rows.filter(row => row.vision === false);
    }
    return rows;
  }, [data.rows, selectedProviders, isAllMode, visionFilter]);

  const sortedRows = useMemo(() => {
    const scoreOf = (row: (typeof filteredRows)[number], col: string): number | null => {
      if (col === 'avg') {
        return row.avg;
      }
      const v = row.benchmarks[col];
      return v === undefined ? null : v;
    };
    return [...filteredRows].sort((a, b) => {
      const aVal = scoreOf(a, sort.col);
      const bVal = scoreOf(b, sort.col);
      // Nulls always sort last regardless of direction.
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      return sort.dir === 'desc' ? bVal - aVal : aVal - bVal;
    });
  }, [filteredRows, sort.col, sort.dir]);

  const navLinkStyle: React.CSSProperties = {
    padding: '0.3rem 0.9rem',
    borderRadius: '999px',
    fontSize: '0.75rem',
    fontWeight: 700,
    border: '1.5px solid #475569',
    color: '#cbd5e1',
    textDecoration: 'none',
  };

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
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
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
              RISE Leaderboard
            </h1>
            <p
              style={{
                marginTop: '0.5rem',
                color: '#94a3b8',
                fontSize: '0.83rem',
                lineHeight: 1.5,
                maxWidth: '55rem',
              }}
            >
              Humanities data-extraction benchmarks (RISE, University of Basel) run against
              UCSB inference services. Every cell is normalized to a 0-100 scale, so columns
              are directly comparable.{' '}
              {isDescExpanded ? (
                <>
                  <br />
                  <br />
                  <strong>Scoring:</strong> each benchmark's ranking metric is normalized to
                  0-100 (fuzzy match scores of 0-100 are used as-is; 0-1 metrics like F1 are
                  multiplied by 100; error metrics like CER are inverted to 100 - CER x 100).
                  <strong> Avg</strong> is the mean over completed benchmarks, so a text-only
                  model is averaged over fewer columns — compare models on the benchmarks they
                  ran. <strong>Vision gating:</strong> image benchmarks only run for models
                  probed as vision-capable; text-only models never appear in image columns.
                  <br />
                  <button
                    onClick={() => setIsDescExpanded(false)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#93c5fd',
                      cursor: 'pointer',
                      padding: 0,
                      font: 'inherit',
                      textDecoration: 'underline',
                    }}
                  >
                    [see less]
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setIsDescExpanded(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#93c5fd',
                    cursor: 'pointer',
                    padding: 0,
                    font: 'inherit',
                    textDecoration: 'underline',
                  }}
                >
                  [see more]
                </button>
              )}
            </p>
          </div>
          <nav
            style={{
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <a href="/leaderboard" style={navLinkStyle}>
              Performance
            </a>
            <a href="/scicode" style={navLinkStyle}>
              SciCode
            </a>
            <span
              style={{
                padding: '0.3rem 0.9rem',
                borderRadius: '999px',
                fontSize: '0.75rem',
                fontWeight: 700,
                background: ACCENT,
                color: '#fff',
              }}
            >
              RISE
            </span>
          </nav>
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
          <StatCard label="Benchmarks" value={data.stats.benchmarks.length} accent="#10b981" />
          <StatCard label="Models" value={data.stats.totalModels} accent="#8b5cf6" />
          <StatCard label="Providers" value={data.stats.providers.length} accent="#f59e0b" />
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

        {/* Vision filter chips */}
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
            Vision
          </div>
          <div style={{ display: 'flex', gap: '0.375rem' }}>
            {(
              [
                ['all', 'All'],
                ['vision', 'Vision 👁️'],
                ['text', 'Text-only'],
              ] as [VisionFilter, string][]
            ).map(([value, label]) => {
              const active = visionFilter === value;
              return (
                <button
                  key={value}
                  onClick={() => setVisionFilter(value)}
                  style={{
                    padding: '0.3rem 0.75rem',
                    borderRadius: '999px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    border: active ? `1.5px solid ${ACCENT}` : '1.5px solid #cbd5e1',
                    background: active ? ACCENT : '#fff',
                    color: active ? '#fff' : '#475569',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
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
        <strong style={{ color: '#475569' }}>{data.rows.length}</strong> models &mdash; sorted
        by{' '}
        <strong style={{ color: ACCENT }}>
          {sort.col === 'avg' ? 'Avg' : benchmarkTitle(sort.col)}
        </strong>{' '}
        ({sort.dir === 'desc' ? 'high → low' : 'low → high'}, missing runs last)
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
                  minWidth: '240px',
                  borderRight: '1px solid #e2e8f0',
                }}
              >
                Model
              </th>
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
              {/* Avg — primary sort column */}
              <th
                onClick={() => handleColSort('avg')}
                title={AVG_TOOLTIP}
                style={{
                  padding: '0.7rem 1rem',
                  textAlign: 'left',
                  fontWeight: 700,
                  fontSize: '0.65rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: sort.col === 'avg' ? ACCENT : '#1d4ed8',
                  minWidth: '110px',
                  borderRight: '2px solid #cbd5e1',
                  background: sort.col === 'avg' ? '#eff6ff' : '#f8fafc',
                  cursor: 'pointer',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                Avg
                <SortIcon dir={sort.dir} active={sort.col === 'avg'} />
                <br />
                <span style={{ color: '#94a3b8', fontWeight: 600 }}>0-100</span>
              </th>
              {/* Benchmark columns */}
              {data.allBenchmarks.map(benchmark => {
                const isActive = sort.col === benchmark;
                return (
                  <th
                    key={benchmark}
                    onClick={() => handleColSort(benchmark)}
                    title={benchmarkTitle(benchmark)}
                    style={{
                      padding: '0.7rem 1rem',
                      textAlign: 'left',
                      fontWeight: 700,
                      fontSize: '0.65rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: isActive ? ACCENT : '#64748b',
                      minWidth: '110px',
                      borderRight: '1px solid #e2e8f0',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                      userSelect: 'none',
                      background: isActive ? '#eff6ff' : '#f1f5f9',
                      transition: 'background 0.1s, color 0.1s',
                    }}
                  >
                    {benchmarkTitle(benchmark)}
                    <SortIcon dir={sort.dir} active={isActive} />
                    <br />
                    <span style={{ color: '#94a3b8', fontWeight: 600 }}>0-100</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, idx) => {
              const rank = idx + 1;
              const provColor = providerColor(data.stats.providers, row.service);
              const isEven = idx % 2 === 0;
              const rowBg =
                rank <= 3 && sort.dir === 'desc' && sort.col === 'avg'
                  ? rank === 1
                    ? '#fffbeb'
                    : rank === 2
                    ? '#f8fafc'
                    : '#fafaf9'
                  : isEven
                  ? '#ffffff'
                  : '#f8fafc';
              return (
                <tr
                  key={`${row.service}|${row.model}`}
                  style={{
                    background: rowBg,
                    borderBottom: '1px solid #e2e8f0',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLTableRowElement).style.background = '#eff6ff';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLTableRowElement).style.background = rowBg;
                  }}
                >
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
                  <td
                    style={{
                      position: 'sticky',
                      left: '2.5rem',
                      zIndex: 10,
                      background: 'inherit',
                      padding: '0.65rem 1rem',
                      borderRight: '1px solid #e2e8f0',
                      minWidth: '240px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        flexWrap: 'wrap',
                      }}
                    >
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
                        {row.service}
                      </span>
                      <span
                        style={{
                          fontWeight: 600,
                          color: '#1e293b',
                          fontSize: '0.8rem',
                          fontFamily: "'JetBrains Mono', 'Fira Mono', monospace",
                        }}
                      >
                        {row.model}
                      </span>
                      <VisionBadge vision={row.vision} />
                    </div>
                  </td>
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
                    {row.runs}
                  </td>
                  <td
                    style={{
                      padding: '0.55rem 1rem',
                      borderRight: '2px solid #cbd5e1',
                      minWidth: '110px',
                      background: rank === 1 && sort.col === 'avg' && sort.dir === 'desc' ? '#fefce8' : 'inherit',
                    }}
                  >
                    {row.avg !== null ? (
                      <ScoreBar value={row.avg} color={ACCENT} />
                    ) : (
                      <span style={{ color: '#cbd5e1', fontSize: '0.75rem' }}>—</span>
                    )}
                  </td>
                  {data.allBenchmarks.map(benchmark => {
                    const value = row.benchmarks[benchmark];
                    const isActive = sort.col === benchmark;
                    return (
                      <td
                        key={benchmark}
                        style={{
                          padding: '0.55rem 1rem',
                          borderRight: '1px solid #e2e8f0',
                          minWidth: '110px',
                          background: isActive ? 'rgba(239,246,255,0.6)' : undefined,
                        }}
                      >
                        {value !== null && value !== undefined ? (
                          <ScoreBar value={value} color={isActive ? ACCENT : provColor} />
                        ) : (
                          <span
                            title="Not run (text-only model or run not completed)"
                            style={{ color: '#cbd5e1', fontSize: '0.75rem' }}
                          >
                            —
                          </span>
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
            No data for the selected filters.
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
        All cells share the 0-100 normalized scale; bars are absolute. &mdash; means the
        benchmark was not run for that model.
      </div>
    </div>
  );
};
