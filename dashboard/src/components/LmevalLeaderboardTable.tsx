import React, { useState, useMemo } from 'react';
import type { LmevalRow, LmevalLeaderboardData } from '../lib/lmeval';
import { modelAnchor, providerAnchor } from '../lib/catalog';
import { withBase } from '../lib/paths';

interface LmevalProps {
  data: LmevalLeaderboardData;
  deprecatedModels?: string[];
}

type Metric =
  | 'composite_score'
  | 'mmlu'
  | 'gsm8k'
  | 'arc_challenge'
  | 'hellaswag'
  | 'winogrande'
  | 'truthfulqa_mc2';

type SortDir = 'asc' | 'desc';

const metricLabels: Record<Metric, string> = {
  composite_score: 'Composite',
  mmlu: 'MMLU',
  gsm8k: 'GSM8K',
  arc_challenge: 'ARC-C',
  hellaswag: 'HellaSwag',
  winogrande: 'WinoGrande',
  truthfulqa_mc2: 'TruthfulQA',
};

const metricFewShot: Record<string, string> = {
  mmlu: '5-shot',
  gsm8k: '5-shot',
  arc_challenge: '25-shot',
  hellaswag: '10-shot',
  winogrande: '5-shot',
  truthfulqa_mc2: '6-shot',
};

const ACCENT = '#2563eb';
const PROVIDER_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#84cc16',
];

function providerColor(providers: string[], name: string): string {
  const idx = providers.indexOf(name);
  return PROVIDER_PALETTE[idx % PROVIDER_PALETTE.length];
}

function fmtScore(val: number | null): string {
  if (val === null || val === undefined) return '\u2014';
  return (val * 100).toFixed(1) + '%';
}

function fmtDate(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getMetricValue(row: LmevalRow, metric: Metric): number {
  const v = row[metric];
  return typeof v === 'number' ? v : -1;
}

function ScoreBar({ value, min, max, color }: { value: number | null; min: number; max: number; color: string }) {
  if (value === null) {
    return (
      <span style={{ color: '#94a3b8', fontSize: '0.78rem', fontWeight: 500, fontStyle: 'italic' }}>
        n/a
      </span>
    );
  }
  const pct100 = value * 100;
  const range = max - min || 1;
  const pctBar = ((pct100 - min) / range) * 100;
  const clamped = Math.max(4, Math.min(100, pctBar));
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
        {pct100.toFixed(1)}%
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

function StatCard({ label, value, accent }: { label: string; value: string | number; accent: string }) {
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

function RankBadge({ rank, showMedal }: { rank: number; showMedal: boolean }) {
  if (showMedal && rank <= 3) {
    const medal = rank === 1 ? '\u{1F947}' : rank === 2 ? '\u{1F948}' : '\u{1F949}';
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

const allMetrics: Metric[] = [
  'composite_score',
  'mmlu',
  'gsm8k',
  'arc_challenge',
  'hellaswag',
  'winogrande',
  'truthfulqa_mc2',
];

export const LmevalLeaderboardTable: React.FC<LmevalProps> = ({ data, deprecatedModels }) => {
  const [selectedProviders, setSelectedProviders] = useState<Set<string> | null>(null);
  const [showDeprecated, setShowDeprecated] = useState(false);
  const [sort, setSort] = useState<{ key: Metric; dir: SortDir }>({
    key: 'composite_score',
    dir: 'desc',
  });
  const [isDescExpanded, setIsDescExpanded] = useState(false);

  const isAllMode = selectedProviders === null;

  const deprecatedSet = useMemo(
    () => new Set(deprecatedModels ?? []),
    [deprecatedModels]
  );

  const handleColSort = (key: Metric) => {
    setSort(prev => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' };
      }
      return { key, dir: 'desc' };
    });
  };

  const visibleRows = useMemo(() => {
    let rows = data.rows;
    if (!isAllMode) {
      rows = rows.filter(row => selectedProviders!.has(row.provider));
    }
    if (!showDeprecated && deprecatedSet.size > 0) {
      rows = rows.filter(row => !deprecatedSet.has(`${row.provider}|${row.model}`));
    }
    return rows;
  }, [data.rows, selectedProviders, isAllMode, showDeprecated, deprecatedSet]);

  const colStats = useMemo(() => {
    const bounds = (f: (r: LmevalRow) => number | null) => {
      const vals = visibleRows.map(f).filter((v): v is number => v !== null);
      if (vals.length === 0) return { min: 0, max: 1 };
      return {
        max: Math.max(...vals) * 100,
        min: Math.min(...vals) * 100,
      };
    };
    return {
      composite_score: bounds(r => r.composite_score),
      mmlu: bounds(r => r.mmlu),
      gsm8k: bounds(r => r.gsm8k),
      arc_challenge: bounds(r => r.arc_challenge),
      hellaswag: bounds(r => r.hellaswag),
      winogrande: bounds(r => r.winogrande),
      truthfulqa_mc2: bounds(r => r.truthfulqa_mc2),
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
    return [...visibleRows].sort((a, b) => {
      const va = getMetricValue(a, sort.key);
      const vb = getMetricValue(b, sort.key);
      return sort.dir === 'desc' ? vb - va : va - vb;
    });
  }, [visibleRows, sort]);

  const showMedals = sort.dir === 'desc';

  const headerCell = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    padding: '0.7rem 0.75rem',
    textAlign: 'left',
    fontWeight: 700,
    fontSize: '0.65rem',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#64748b',
    whiteSpace: 'nowrap',
    ...extra,
  });

  return (
    <div
      style={{
        width: '100%',
        fontFamily: "Inter, 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        color: '#1e293b',
        background: '#ffffff',
      }}
    >
      {/* Header */}
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
              General Capability (lm-eval)
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
              Standardized general-capability benchmarks from the lm-evaluation-harness, anchoring
              results against the broader ML community's reference scores.{' '}
              {isDescExpanded ? (
                <>
                  <br /><br />
                  <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
                    <li><strong>MMLU</strong> (5-shot): massive multitask language understanding across 57 subjects.</li>
                    <li><strong>GSM8K</strong> (5-shot): grade-school math word problems requiring multi-step reasoning.</li>
                    <li><strong>ARC-Challenge</strong> (25-shot): science questions requiring reasoning beyond surface co-occurrence.</li>
                    <li><strong>HellaSwag</strong> (10-shot): commonsense natural language inference about physical situations.</li>
                    <li><strong>WinoGrande</strong> (5-shot): commonsense reasoning via pronoun resolution at scale.</li>
                    <li><strong>TruthfulQA MC2</strong> (6-shot): measuring whether models generate truthful answers to adversarial questions.</li>
                  </ul>
                  The composite score is a simple average of the six primary metrics. Each row shows the most recent
                  run per model and provider.{' '}
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
            value={data.stats.latestRun ? fmtDate(data.stats.latestRun) : '\u2014'}
            accent="#f59e0b"
          />
        </div>
      </div>

      {/* Filters */}
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
        {/* Show deprecated toggle */}
        {deprecatedSet.size > 0 && (
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
              History
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
                checked={showDeprecated}
                onChange={e => setShowDeprecated(e.target.checked)}
                style={{ width: '14px', height: '14px', accentColor: ACCENT, cursor: 'pointer' }}
              />
              Show deprecated
            </label>
          </div>
        )}
      </div>

      {/* Status bar */}
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
        <strong style={{ color: ACCENT }}>{metricLabels[sort.key]}</strong>{' '}
        ({sort.dir === 'desc' ? 'higher is better' : 'lower is better'})
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
                  minWidth: '220px',
                  borderRight: '1px solid #e2e8f0',
                }}
              >
                Model
              </th>
              {allMetrics.map(metric => {
                const isActive = sort.key === metric;
                const subtitle = metric !== 'composite_score' ? metricFewShot[metric] : 'avg of 6';
                return (
                  <th
                    key={metric}
                    onClick={() => handleColSort(metric)}
                    style={headerCell({
                      color: isActive ? ACCENT : '#64748b',
                      background: isActive ? '#eff6ff' : '#f1f5f9',
                      cursor: 'pointer',
                      userSelect: 'none',
                      borderRight: metric === 'truthfulqa_mc2' ? '2px solid #cbd5e1' : '1px solid #e2e8f0',
                      transition: 'background 0.1s, color 0.1s',
                      minWidth: metric === 'composite_score' ? '100px' : '90px',
                    })}
                  >
                    <div>
                      {metricLabels[metric]}
                      <SortIcon dir={sort.dir} active={isActive} />
                    </div>
                    {subtitle && (
                      <div style={{ fontSize: '0.55rem', fontWeight: 500, color: '#94a3b8', letterSpacing: '0.02em', textTransform: 'none', marginTop: '1px' }}>
                        {subtitle}
                      </div>
                    )}
                  </th>
                );
              })}
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
                  ? rank === 1 ? '#fffbeb' : rank === 2 ? '#f8fafc' : '#fafaf9'
                  : isEven ? '#ffffff' : '#f8fafc';
              return (
                <tr
                  key={`${row.provider}-${row.model}`}
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
                        title="View model on Models & Providers"
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
                    </div>
                  </td>
                  {allMetrics.map(metric => {
                    const isActive = sort.key === metric;
                    const value = row[metric];
                    const stats = colStats[metric];
                    return (
                      <td
                        key={metric}
                        style={{
                          padding: '0.55rem 0.75rem',
                          borderRight: metric === 'truthfulqa_mc2' ? '2px solid #cbd5e1' : '1px solid #e2e8f0',
                          minWidth: metric === 'composite_score' ? '100px' : '90px',
                          background: isActive ? 'rgba(239,246,255,0.6)' : undefined,
                        }}
                      >
                        <ScoreBar
                          value={value}
                          min={stats.min}
                          max={stats.max}
                          color={isActive ? ACCENT : metric === 'composite_score' ? '#10b981' : provColor}
                        />
                      </td>
                    );
                  })}
                  <td
                    style={{
                      padding: '0.65rem 1rem',
                      whiteSpace: 'nowrap',
                      color: '#64748b',
                      fontSize: '0.75rem',
                    }}
                  >
                    {fmtDate(row.timestamp)}
                  </td>
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
            {data.rows.length === 0
              ? 'No lm-eval results collected yet. Run the lm-eval suite to generate data.'
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
        Score bars show relative standing within the visible selection. Each row reflects
        the most recent run per model and provider. Composite is the simple average of all
        six task scores.
      </div>
    </div>
  );
};
