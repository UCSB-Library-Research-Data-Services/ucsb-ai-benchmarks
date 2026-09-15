import React, { useState, useMemo } from 'react';
import type { ScicodeRow, ScicodeLeaderboardData } from '../lib/scicode';
import { scicodeDetailPath } from '../lib/scicode';
import { modelAnchor, providerAnchor } from '../lib/catalog';
import { withBase } from '../lib/paths';
import { RunDetailPanel } from './RunDetailPanel';

interface ScicodeProps {
  data: ScicodeLeaderboardData;
}

type Measurement =
  | 'mainResolveRate'
  | 'subStepAccuracy'
  | 'tokensPerTask'
  | 'outputTokens'
  | 'timePerTask'
  | 'stepsPassed';

type SortDir = 'asc' | 'desc';

const higherIsBetter: Record<Measurement, boolean> = {
  mainResolveRate: true,
  subStepAccuracy: true,
  tokensPerTask: false,
  outputTokens: false,
  timePerTask: false,
  stepsPassed: true,
};

const measurementLabels: Record<Measurement, string> = {
  mainResolveRate: 'Main Resolve Rate (%)',
  subStepAccuracy: 'Sub-step Accuracy (%)',
  tokensPerTask: 'Tokens / Task',
  outputTokens: 'Output Tokens',
  timePerTask: 'Time / Task (min)',
  stepsPassed: 'Steps Passed',
};

const measurementShort: Record<Measurement, string> = {
  mainResolveRate: 'Resolve %',
  subStepAccuracy: 'Sub-step %',
  tokensPerTask: 'Tokens',
  outputTokens: 'Out Tokens',
  timePerTask: 'Minutes',
  stepsPassed: 'Steps',
};

const ACCENT = '#2563eb';
const REASONING_COLOR = '#8b5cf6';
const NEUTRAL_BAR = '#94a3b8';

const PROVIDER_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#84cc16',
];
function providerColor(providers: string[], name: string): string {
  const idx = providers.indexOf(name);
  return PROVIDER_PALETTE[idx % PROVIDER_PALETTE.length];
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

function fmtDate(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function bestDir(m: Measurement): SortDir {
  return higherIsBetter[m] ? 'desc' : 'asc';
}

function RankBadge({ rank, showMedal }: { rank: number; showMedal: boolean }) {
  if (showMedal && rank <= 3) {
    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉';
    const title = rank === 1 ? '1st place' : rank === 2 ? '2nd place' : '3rd place';
    return (
      <span style={{ fontSize: '1.1rem', lineHeight: 1 }} title={title}>
        {medal}
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

function ScoreBar({ value, min, max, color }: { value: number; min: number; max: number }) {
  const range = max - min || 1;
  const pct = ((value - min) / range) * 100;
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
        {value.toFixed(1)}%
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

function MagnitudeBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const clamped = Math.max(2, Math.min(100, pct));
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
        {fmtTokens(value)}
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

function TokenStackBar({
  total,
  reasoning,
  answer,
  max,
}: {
  total: number;
  reasoning: number | null;
  answer: number;
  max: number;
}) {
  const pct = max > 0 ? Math.min(100, (total / max) * 100) : 0;
  const reasonPct = reasoning !== null && total > 0 ? (reasoning / total) * 100 : 0;
  const answerPct = 100 - reasonPct;
  const tooltip =
    reasoning !== null
      ? `Reasoning: ${fmtTokens(reasoning)} • Answer: ${fmtTokens(answer)} tokens/task`
      : `${fmtTokens(answer)} answer tokens/task (reasoning tokens not reported)`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }} title={tooltip}>
      <span
        style={{
          fontFamily: "'JetBrains Mono', 'Fira Mono', 'Courier New', monospace",
          fontSize: '0.78rem',
          fontWeight: 600,
          color: '#1e293b',
          letterSpacing: '-0.01em',
        }}
      >
        {fmtTokens(total)}
      </span>
      <div
        style={{
          height: '4px',
          borderRadius: '2px',
          background: '#e2e8f0',
          width: '100%',
          overflow: 'hidden',
          display: 'flex',
        }}
      >
        <div style={{ height: '100%', background: NEUTRAL_BAR, width: `${pct * (reasonPct / 100)}%` }} />
        <div style={{ height: '100%', background: ACCENT, width: `${pct * (answerPct / 100)}%` }} />
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

type SplitFilter = 'all' | 'test' | 'validation';

const splitLabels: Record<SplitFilter, string> = {
  all: 'All',
  test: 'Test',
  validation: 'Validation',
};

const splitHints: Record<SplitFilter, string> = {
  all: 'Show all splits',
  test: 'Test split — 65 problems',
  validation: 'Validation split — 15 problems',
};

const TIME_TOOLTIP =
  'Average model API time per task in minutes. Includes time-to-first-token (not separable from gateway logs); excludes solver overhead between calls.';

export const ScicodeLeaderboardTable: React.FC<ScicodeProps> = ({ data }) => {
  const [selectedProviders, setSelectedProviders] = useState<Set<string> | null>(null);
  const [splitFilter, setSplitFilter] = useState<SplitFilter>('all');
  const [sort, setSort] = useState<{ key: Measurement; dir: SortDir }>({
    key: 'mainResolveRate',
    dir: 'desc',
  });
  const [isDescExpanded, setIsDescExpanded] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const isAllMode = selectedProviders === null;

  const toggleDetail = (provider: string, model: string, split: string) => {
    const key = `${provider}|${model}|${split}`;
    setOpenKey(prev => (prev === key ? null : key));
  };

  const handleMeasurementChange = (m: Measurement) => {
    setSort({ key: m, dir: bestDir(m) });
  };

  const handleColSort = (key: Measurement) => {
    setSort(prev => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' };
      }
      return { key, dir: bestDir(key) };
    });
  };

  const visibleRows = useMemo(() => {
    let rows = data.rows;
    if (splitFilter !== 'all') {
      rows = rows.filter(row => row.split === splitFilter);
    } else {
      const byPair = new Map<string, ScicodeRow>();
      const counts = new Map<string, number>();
      for (const row of rows) {
        const pair = `${row.provider}|${row.model}`;
        counts.set(pair, (counts.get(pair) ?? 0) + row.runCount);
        const prev = byPair.get(pair);
        if (!prev || row.latestTimestamp > prev.latestTimestamp) {
          byPair.set(pair, row);
        }
      }
      rows = Array.from(byPair.values()).map(row => ({
        ...row,
        runCount: counts.get(`${row.provider}|${row.model}`) ?? row.runCount,
      }));
    }
    if (!isAllMode) {
      rows = rows.filter(row => selectedProviders!.has(row.provider));
    }
    return rows;
  }, [data.rows, splitFilter, selectedProviders, isAllMode]);

  const totalVisiblePairs = useMemo(() => {
    const source =
      splitFilter === 'all' ? data.rows : data.rows.filter(row => row.split === splitFilter);
    return new Set(source.map(row => `${row.provider}|${row.model}`)).size;
  }, [data.rows, splitFilter]);

  const colStats = useMemo(() => {
    const maxOf = (f: (r: ScicodeRow) => number) =>
      visibleRows.reduce((m, r) => Math.max(m, f(r)), 0);
    const bounds = (f: (r: ScicodeRow) => number) => {
      const vals = visibleRows.map(f);
      return { max: Math.max(...vals, 0), min: Math.min(...vals, 0) };
    };
    return {
      mainResolveRate: bounds(r => r.mainResolveRate),
      subStepAccuracy: bounds(r => r.subStepAccuracy),
      tokensPerTask: maxOf(r => r.avgOutputTokensPerTask),
      outputTokens: maxOf(r => r.totalOutputTokens),
      timePerTask: maxOf(r => r.avgModelTimeMin),
    };
  }, [visibleRows]);

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

  const sortedRows = useMemo(() => {
    const get = (r: ScicodeRow, key: Measurement): number => {
      switch (key) {
        case 'mainResolveRate':
          return r.mainResolveRate;
        case 'subStepAccuracy':
          return r.subStepAccuracy;
        case 'tokensPerTask':
          return r.avgOutputTokensPerTask;
        case 'outputTokens':
          return r.totalOutputTokens;
        case 'timePerTask':
          return r.avgModelTimeMin;
        case 'stepsPassed':
          return r.stepsPassed;
      }
    };
    return [...visibleRows].sort((a, b) =>
      sort.dir === 'desc' ? get(b, sort.key) - get(a, sort.key) : get(a, sort.key) - get(b, sort.key)
    );
  }, [visibleRows, sort]);

  const showMedals =
    (higherIsBetter[sort.key] && sort.dir === 'desc') ||
    (!higherIsBetter[sort.key] && sort.dir === 'asc');

  const headerCell = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    padding: '0.7rem 1rem',
    textAlign: 'left',
    fontWeight: 700,
    fontSize: '0.65rem',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#64748b',
    whiteSpace: 'nowrap',
    ...extra,
  });

  const metricColumns: Measurement[] = [
    'mainResolveRate',
    'subStepAccuracy',
    'tokensPerTask',
    'outputTokens',
    'timePerTask',
  ];

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
              SciCode Leaderboard
            </h1>
            <p
              style={{
                marginTop: '0.5rem',
                color: '#94a3b8',
                fontSize: '0.83rem',
                lineHeight: 1.5,
                maxWidth: '56rem',
              }}
            >
              Scientific coding ability on the SciCode benchmark: models solve research-level
              problems step by step, and each step is executed and checked against gold test
              cases.{' '}
              {isDescExpanded ? (
                <>
                  <br /><br />
                  <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
                    <li><strong>Main Resolve Rate:</strong> percentage of problems whose final result is fully correct.</li>
                    <li><strong>Sub-step Accuracy:</strong> percentage of individual solution steps passing their test cases.</li>
                    <li><strong>Tokens / Task:</strong> average output tokens per problem, split into reasoning and answer when the provider reports reasoning tokens.</li>
                    <li><strong>Output Tokens:</strong> total output tokens generated across the whole eval run.</li>
                    <li><strong>Time / Task:</strong> average model API time per task in minutes. Includes time-to-first-token (not separable from gateway logs); excludes solver overhead between calls.</li>
                    <li><strong>Steps:</strong> steps passed out of steps attempted in the most recent run.</li>
                  </ul>
                  Each row shows the most recent run per model, provider, and split. Use the
                  Split filter to compare within one split only — the test (65 problems) and
                  validation (15 problems) sets differ in difficulty and scores are not
                  directly comparable across them. Runs use
                  with_background=True and temperature 0.{' '}
                  <button
                    onClick={() => setIsDescExpanded(false)}
                    style={{ background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline' }}
                  >
                    [see less]
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setIsDescExpanded(true)}
                  style={{ background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline' }}
                >
                  [see more]
                </button>
              )}
            </p>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '0.75rem',
            marginTop: '1.5rem',
          }}
        >
          <StatCard label="Total Runs" value={data.stats.totalRuns} accent="#3b82f6" />
          <StatCard label="Models" value={data.stats.totalModels} accent="#10b981" />
          <StatCard label="Providers" value={data.stats.totalProviders} accent="#8b5cf6" />
          <StatCard
            label="Last Run"
            value={data.stats.latestRun ? fmtDate(data.stats.latestRun) : '—'}
            accent="#f59e0b"
          />
        </div>
      </div>

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
            Split
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
            {(Object.keys(splitLabels) as SplitFilter[]).map(sf => {
              const active = splitFilter === sf;
              return (
                <button
                  key={sf}
                  onClick={() => setSplitFilter(sf)}
                  title={splitHints[sf]}
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
                  {splitLabels[sf]}
                </button>
              );
            })}
          </div>
        </div>

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
            value={sort.key}
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
      </div>

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
        <strong style={{ color: '#475569' }}>{totalVisiblePairs}</strong> models
        {splitFilter !== 'all' ? ` (${splitLabels[splitFilter]} split)` : ''} &mdash; sorted by{' '}
        <strong style={{ color: ACCENT }}>{measurementLabels[sort.key]}</strong>{' '}
        ({higherIsBetter[sort.key]
          ? sort.dir === 'desc' ? 'higher is better' : 'lower is better'
          : sort.dir === 'asc' ? 'lower is better' : 'higher is better'})
      </div>

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
                  minWidth: '220px',
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
              {metricColumns.map(metric => {
                const isActive = sort.key === metric;
                const style = headerCell({
                  color: isActive ? ACCENT : '#64748b',
                  background: isActive ? '#eff6ff' : '#f1f5f9',
                  cursor: 'pointer',
                  userSelect: 'none',
                  borderRight: metric === 'timePerTask' ? '2px solid #cbd5e1' : '1px solid #e2e8f0',
                  transition: 'background 0.1s, color 0.1s',
                });
                return (
                  <th
                    key={metric}
                    onClick={() => handleColSort(metric)}
                    title={metric === 'timePerTask' ? TIME_TOOLTIP : undefined}
                    style={style}
                  >
                    {measurementLabels[metric]}
                    <SortIcon dir={sort.dir} active={isActive} />
                  </th>
                );
              })}
              <th
                onClick={() => handleColSort('stepsPassed')}
                title="Steps passed / steps attempted in the most recent run"
                style={headerCell({
                  color: sort.key === 'stepsPassed' ? ACCENT : '#64748b',
                  background: sort.key === 'stepsPassed' ? '#eff6ff' : '#f1f5f9',
                  cursor: 'pointer',
                  userSelect: 'none',
                  borderRight: '1px solid #e2e8f0',
                  transition: 'background 0.1s, color 0.1s',
                })}
              >
                Steps
                <SortIcon dir={sort.dir} active={sort.key === 'stepsPassed'} />
              </th>
              <th style={headerCell()}>Last Run</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, idx) => {
              const rank = idx + 1;
              const provColor = providerColor(data.stats.providers, row.provider);
              const isEven = idx % 2 === 0;
              const rowBg =
                showMedals && rank <= 3
                  ? rank === 1
                    ? '#fffbeb'
                    : rank === 2
                    ? '#f8fafc'
                    : '#fafaf9'
                  : isEven
                  ? '#ffffff'
                  : '#f8fafc';
              const isActiveCol = (metric: Measurement) => sort.key === metric;
              const rowKey = `${row.provider}|${row.model}|${row.split}`;
              const isOpen = openKey === rowKey;
              const clickableCell = (
                children: React.ReactNode,
                label: string
              ): React.ReactNode => (
                <button
                  onClick={() => toggleDetail(row.provider, row.model, row.split)}
                  aria-expanded={isOpen}
                  aria-controls={`detail-${row.provider}-${row.model}-${row.split}`}
                  title={label}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    background: 'none',
                    border: isOpen ? `1.5px solid ${ACCENT}` : '1.5px solid transparent',
                    borderRadius: '6px',
                    padding: '0.1rem 0.25rem',
                    margin: '-0.1rem -0.25rem',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = ACCENT;
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = isOpen
                      ? ACCENT
                      : 'transparent';
                  }}
                >
                  {children}
                </button>
              );
              return (
                <React.Fragment key={`${row.provider}-${row.model}-${row.split}`}>
                <tr
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
                    <RankBadge rank={rank} showMedal={showMedals} />
                  </td>
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
                      <a
                        href={`${withBase('models')}#${providerAnchor(row.provider)}`}
                        title={`View ${row.provider} on Models & Providers`}
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
                          textDecoration: 'none',
                        }}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLAnchorElement).style.textDecoration = 'underline';
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLAnchorElement).style.textDecoration = 'none';
                        }}
                      >
                        {row.provider}
                      </a>
                      <a
                        href={`${withBase('models')}#${modelAnchor(row.provider, row.model)}`}
                        title={`View model on Models & Providers`}
                        style={{
                          fontWeight: 600,
                          color: '#1e293b',
                          fontSize: '0.8rem',
                          fontFamily: "'JetBrains Mono', 'Fira Mono', monospace",
                          textDecoration: 'none',
                        }}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLAnchorElement).style.textDecoration = 'underline';
                          (e.currentTarget as HTMLAnchorElement).style.color = '#2563eb';
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLAnchorElement).style.textDecoration = 'none';
                          (e.currentTarget as HTMLAnchorElement).style.color = '#1e293b';
                        }}
                      >
                        {row.model}
                      </a>
                      <span
                        title={`Most recent run: ${row.split} split (${row.numProblems} problems), with_background=${row.withBackground}`}
                        style={{
                          display: 'inline-block',
                          padding: '0.05rem 0.35rem',
                          borderRadius: '4px',
                          fontSize: '0.6rem',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          background: '#f1f5f9',
                          color: '#64748b',
                          border: '1px solid #e2e8f0',
                          flexShrink: 0,
                        }}
                      >
                        {row.split}
                      </span>
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
                    {row.runCount}
                  </td>
                  <td
                    style={{
                      padding: '0.55rem 1rem',
                      borderRight: '1px solid #e2e8f0',
                      minWidth: '110px',
                      background: isOpen
                        ? '#dbeafe'
                        : isActiveCol('mainResolveRate')
                        ? 'rgba(239,246,255,0.6)'
                        : undefined,
                    }}
                  >
                    {clickableCell(
                      <ScoreBar
                        value={row.mainResolveRate}
                        min={colStats.mainResolveRate.min}
                        max={colStats.mainResolveRate.max}
                        color={isActiveCol('mainResolveRate') ? ACCENT : provColor}
                      />,
                      `View run details: ${row.logFile}`
                    )}
                  </td>
                  <td
                    style={{
                      padding: '0.55rem 1rem',
                      borderRight: '1px solid #e2e8f0',
                      minWidth: '110px',
                      background: isOpen
                        ? '#dbeafe'
                        : isActiveCol('subStepAccuracy')
                        ? 'rgba(239,246,255,0.6)'
                        : undefined,
                    }}
                  >
                    {clickableCell(
                      <ScoreBar
                        value={row.subStepAccuracy}
                        min={colStats.subStepAccuracy.min}
                        max={colStats.subStepAccuracy.max}
                        color={isActiveCol('subStepAccuracy') ? ACCENT : provColor}
                      />,
                      `View run details: ${row.logFile}`
                    )}
                  </td>
                  <td
                    style={{
                      padding: '0.55rem 1rem',
                      borderRight: '1px solid #e2e8f0',
                      minWidth: '120px',
                      background: isActiveCol('tokensPerTask') ? 'rgba(239,246,255,0.6)' : undefined,
                    }}
                  >
                    <TokenStackBar
                      total={row.avgOutputTokensPerTask}
                      reasoning={row.avgReasoningTokensPerTask}
                      answer={row.avgAnswerTokensPerTask}
                      max={colStats.tokensPerTask}
                    />
                  </td>
                  <td
                    style={{
                      padding: '0.55rem 1rem',
                      borderRight: '1px solid #e2e8f0',
                      minWidth: '100px',
                      background: isActiveCol('outputTokens') ? 'rgba(239,246,255,0.6)' : undefined,
                    }}
                  >
                    <MagnitudeBar
                      value={row.totalOutputTokens}
                      max={colStats.outputTokens}
                      color={NEUTRAL_BAR}
                    />
                  </td>
                  <td
                    style={{
                      padding: '0.55rem 1rem',
                      borderRight: '2px solid #cbd5e1',
                      minWidth: '100px',
                      background: isActiveCol('timePerTask') ? 'rgba(239,246,255,0.6)' : undefined,
                    }}
                    title={`${row.avgModelTimeMin.toFixed(1)} min avg model API time per task (includes TTFT; excludes solver overhead)`}
                  >
                    <MagnitudeBar
                      value={row.avgModelTimeMin}
                      max={colStats.timePerTask}
                      color={NEUTRAL_BAR}
                    />
                  </td>
                  <td
                    style={{
                      padding: '0.65rem 1rem',
                      borderRight: '1px solid #e2e8f0',
                      whiteSpace: 'nowrap',
                      fontFamily: "'JetBrains Mono', 'Fira Mono', monospace",
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#475569',
                    }}
                  >
                    {row.stepsPassed} / {row.stepsTotal}
                  </td>
                  <td
                    style={{
                      padding: '0.65rem 1rem',
                      whiteSpace: 'nowrap',
                      color: '#64748b',
                      fontSize: '0.75rem',
                    }}
                  >
                    {fmtDate(row.latestTimestamp)}
                  </td>
                </tr>
                {isOpen && (
                  <tr key={`${rowKey}-detail`}>
                    <td colSpan={10} id={`detail-${row.provider}-${row.model}-${row.split}`} style={{ padding: '0.5rem 1rem 1rem', background: '#fff', borderBottom: '2px solid #cbd5e1' }}>
                      <RunDetailPanel
                        kind="scicode"
                        url={scicodeDetailPath(row.logFile)}
                        title={`${row.provider} ${row.model} · ${row.split} · ${row.logFile}`}
                        onClose={() => setOpenKey(null)}
                      />
                    </td>
                  </tr>
                )}
                </React.Fragment>
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
            {data.rows.length === 0
              ? 'No SciCode results collected yet.'
              : 'No data for the selected providers.'}
          </div>
        )}
      </div>

      <div
        style={{
          marginTop: '0.75rem',
          fontSize: '0.7rem',
          color: '#94a3b8',
          textAlign: 'right',
          paddingRight: '0.25rem',
        }}
      >
        Score bars show relative standing within the visible selection; token and time bars show
        magnitude. Each row reflects the most recent run per model, provider, and split.
        Click a score cell to expand run details.
      </div>
    </div>
  );
};
