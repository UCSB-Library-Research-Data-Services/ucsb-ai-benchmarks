import React, { useState, useMemo } from 'react';
import { computeParetoFrontier } from '../lib/chart';
import type { ScatterPoint } from '../lib/chart';

interface ScoreVsTimeChartProps {
  title: string;
  points: ScatterPoint[];
  baselinePoints: ScatterPoint[];
  providers: string[];
  xLabel: string;
  xTooltip: string;
  yLabel: string;
  xUnit: string;
  yUnit: string;
  allowLogX?: boolean;
  paretoLabel: string;
  caption?: string;
}

const PROVIDER_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#84cc16',
];

function providerColor(providers: string[], name: string): string {
  const idx = providers.indexOf(name);
  if (idx >= 0) return PROVIDER_PALETTE[idx % PROVIDER_PALETTE.length];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PROVIDER_PALETTE[hash % PROVIDER_PALETTE.length];
}

function fmtTokens(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

function Star({ cx, cy, r, fill }: { cx: number; cy: number; r: number; fill: string }) {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r * 0.45;
    points.push(`${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`);
  }
  return (
    <polygon
      points={points.join(' ')}
      fill={fill}
      stroke="#1e293b"
      strokeWidth="1"
      strokeLinejoin="round"
    />
  );
}

const VW = 920;
const VH = 460;
const PAD = { top: 20, right: 30, bottom: 55, left: 70 };
const PLOT_W = VW - PAD.left - PAD.right;
const PLOT_H = VH - PAD.top - PAD.bottom;

export const ScoreVsTimeChart: React.FC<ScoreVsTimeChartProps> = ({
  title,
  points,
  baselinePoints,
  providers,
  xLabel,
  xTooltip,
  yLabel,
  xUnit,
  yUnit,
  allowLogX = false,
  paretoLabel,
  caption = 'Frontier = best score attainable at ≤ time; baseline = reference Gemini models, not ranked (executed via the DreamLab Gateway on Google Cloud infrastructure).',
}) => {
  const [showBaseline, setShowBaseline] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [logX, setLogX] = useState(false);
  const [hover, setHover] = useState<{ p: ScatterPoint; lx: number; ly: number } | null>(null);
  const [legendHover, setLegendHover] = useState<string | null>(null);

  const frontier = useMemo(() => computeParetoFrontier(points), [points]);
  const frontierKeys = useMemo(() => new Set(frontier.map(p => `${p.provider}|${p.model}`)), [frontier]);

  const bounds = useMemo(() => {
    const all = showBaseline ? [...points, ...baselinePoints] : points;
    if (all.length === 0) return { xMin: 0, xMax: 1, yMin: 0, yMax: 100 };
    const xs = all.map(p => p.time).filter(v => v > 0);
    const ys = all.map(p => p.score);
    let xMin = Math.min(...xs);
    let xMax = Math.max(...xs);
    if (xMin === xMax) {
      xMin = xMin * 0.8 || 0;
      xMax = xMax * 1.2 || 1;
    }
    const xPad = (xMax - xMin) * 0.05;
    xMin = Math.max(0, xMin - xPad);
    xMax = xMax + xPad;
    let yMin = Math.min(...ys);
    let yMax = Math.max(...ys);
    if (yMin === yMax) {
      yMin -= 2;
      yMax += 2;
    }
    const yPad = (yMax - yMin) * 0.15;
    yMin = Math.max(0, yMin - yPad);
    yMax = yMax + yPad;
    return { xMin, xMax, yMin, yMax };
  }, [points, baselinePoints, showBaseline]);

  const useLog = allowLogX && logX;

  const xScale = (v: number) => {
    if (useLog) {
      const lo = Math.log10(Math.max(bounds.xMin, 0.1));
      const hi = Math.log10(bounds.xMax);
      const t = (Math.log10(Math.max(v, 0.1)) - lo) / (hi - lo || 1);
      return PAD.left + t * PLOT_W;
    }
    const t = (v - bounds.xMin) / (bounds.xMax - bounds.xMin || 1);
    return PAD.left + t * PLOT_W;
  };

  const yScale = (v: number) => {
    const t = (v - bounds.yMin) / (bounds.yMax - bounds.yMin || 1);
    return PAD.top + PLOT_H - t * PLOT_H;
  };

  const xTicks = useMemo(() => {
    if (useLog) {
      const cand = [1, 2, 5, 10, 20, 40, 80, 160, 320];
      return cand.filter(v => v >= bounds.xMin * 0.8 && v <= bounds.xMax * 1.2);
    }
    const n = 5;
    return Array.from({ length: n + 1 }, (_, i) => bounds.xMin + ((bounds.xMax - bounds.xMin) * i) / n);
  }, [bounds, useLog]);

  const yTicks = useMemo(() => {
    const n = 5;
    return Array.from({ length: n + 1 }, (_, i) => bounds.yMin + ((bounds.yMax - bounds.yMin) * i) / n);
  }, [bounds]);

  const visibleProviders = useMemo(
    () => providers.filter(p => points.some(pt => pt.provider === p)),
    [providers, points]
  );

  const rankSeverity = (p: ScatterPoint) => {
    if (legendHover === null) return 1;
    if (p.isBaseline) return 1;
    return p.provider === legendHover ? 1 : 0.3;
  };

  const baselineSorted = useMemo(
    () => [...baselinePoints].sort((a, b) => a.time - b.time),
    [baselinePoints]
  );

  const paretoPath = frontier.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.time)},${yScale(p.score)}`).join(' ');
  const baselinePath = baselineSorted.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.time)},${yScale(p.score)}`).join(' ');

  const handleHover = (e: React.MouseEvent | React.FocusEvent, p: ScatterPoint) => {
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    setHover({ p, lx: rect.left + rect.width / 2, ly: rect.top });
  };

  const tooltipFor = (p: ScatterPoint) => {
    const isFrontier = frontierKeys.has(`${p.provider}|${p.model}`) && !p.isBaseline;
    return (
      <div style={{ pointerEvents: 'none', fontSize: '0.75rem', lineHeight: 1.45, minWidth: '210px' }}>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
          {p.isBaseline ? (
            <span style={{ background: '#dc2626', color: '#fff', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase' }}>
              Gemini Baseline
            </span>
          ) : (
            <span style={{ background: providerColor(providers, p.provider) + '18', color: providerColor(providers, p.provider), border: `1px solid ${providerColor(providers, p.provider)}40`, padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase' }}>
              {p.provider}
            </span>
          )}
          <span style={{ fontFamily: "'JetBrains Mono', 'Fira Mono', monospace", fontWeight: 700 }}>{p.model}</span>
        </div>
        <div>Score: <strong>{p.score.toFixed(1)}{yUnit}</strong></div>
        <div>Time: <strong>{p.time.toFixed(1)}{xUnit === 'm' ? ' min' : 's'}</strong></div>
        <div>Tokens: <strong>{fmtTokens(p.tokens)} tok</strong></div>
        {isFrontier && <div style={{ color: '#0f172a', fontWeight: 700 }}>★ Pareto frontier</div>}
        {p.isBaseline && <div style={{ color: '#991b1b', fontWeight: 700 }}>Reference baseline (not ranked)</div>}
      </div>
    );
  };

  return (
    <div
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        background: '#fff',
        overflow: 'hidden',
        fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif",
        position: 'relative',
      }}
    >
      <div
        style={{
          background: '#f8fafc',
          borderBottom: '1px solid #e2e8f0',
          padding: '0.85rem 1.25rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div style={{ fontWeight: 800, fontSize: '0.95rem', color: '#0f172a' }}>{title}</div>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.78rem', color: '#475569' }}>
          <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={showBaseline} onChange={e => setShowBaseline(e.target.checked)} style={{ accentColor: '#2563eb' }} />
            Show Gemini baseline
          </label>
          <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} style={{ accentColor: '#2563eb' }} />
            Show labels
          </label>
          {allowLogX && (
            <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={logX} onChange={e => setLogX(e.target.checked)} style={{ accentColor: '#2563eb' }} />
              Log X scale
            </label>
          )}
        </div>
      </div>

      <div style={{ overflowX: 'auto', position: 'relative' }}>
        <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', minWidth: '640px', display: 'block', background: '#fff' }} role="img" aria-label={title}>
          {yTicks.map(t => (
            <g key={`y-${t}`}>
              <line x1={PAD.left} y1={yScale(t)} x2={PAD.left + PLOT_W} y2={yScale(t)} stroke="#e2e8f0" strokeWidth="1" />
              <text x={PAD.left - 8} y={yScale(t) + 4} textAnchor="end" fontSize="10" fill="#64748b" fontFamily="'JetBrains Mono', monospace">
                {t.toFixed(1)}{yUnit}
              </text>
            </g>
          ))}
          {xTicks.map(t => (
            <g key={`x-${t}`}>
              <line x1={xScale(t)} y1={PAD.top} x2={xScale(t)} y2={PAD.top + PLOT_H} stroke="#f1f5f9" strokeWidth="1" />
              <text x={xScale(t)} y={PAD.top + PLOT_H + 18} textAnchor="middle" fontSize="10" fill="#64748b" fontFamily="'JetBrains Mono', monospace">
                {t >= 100 ? t.toFixed(0) : t.toFixed(1)}
              </text>
            </g>
          ))}
          <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + PLOT_H} stroke="#cbd5e1" strokeWidth="1.5" />
          <line x1={PAD.left} y1={PAD.top + PLOT_H} x2={PAD.left + PLOT_W} y2={PAD.top + PLOT_H} stroke="#cbd5e1" strokeWidth="1.5" />

          {frontier.length >= 2 && <path d={paretoPath} fill="none" stroke="#0f172a" strokeWidth="1.5" strokeDasharray="2 4" />}

          {showBaseline && baselineSorted.length >= 2 && (
            <path d={baselinePath} fill="none" stroke="#dc2626" strokeWidth="1.8" strokeDasharray="6 4" />
          )}

          {points.map(p => {
            const r = p.tokens !== null ? Math.min(11, Math.max(5, Math.sqrt(p.tokens) * 0.15)) : 6.5;
            const cx = xScale(p.time);
            const cy = yScale(p.score);
            const isHover = hover?.p.provider === p.provider && hover?.p.model === p.model;
            return (
              <g key={`${p.provider}|${p.model}`} opacity={rankSeverity(p)}>
                {isHover && <circle cx={cx} cy={cy} r={r + 5} fill="none" stroke="#2563eb" strokeWidth="2" />}
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill={providerColor(providers, p.provider)}
                  stroke="#1e293b"
                  strokeWidth="1"
                  tabIndex={0}
                  style={{ cursor: 'pointer', outline: 'none' }}
                  onMouseEnter={e => handleHover(e, p)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={e => handleHover(e, p)}
                  onBlur={() => setHover(null)}
                >
                  <title>{`${p.provider} ${p.model} — ${p.score.toFixed(1)}${yUnit} / ${p.time.toFixed(1)}${xUnit}`}</title>
                </circle>
                {showLabels && (
                  <text
                    x={cx}
                    y={cy - r - 4}
                    textAnchor="middle"
                    fontSize="10"
                    fontFamily="'JetBrains Mono', 'Fira Mono', monospace"
                    fill="#1e293b"
                    style={{ paintOrder: 'stroke', stroke: '#ffffff', strokeWidth: '3px' }}
                  >
                    {p.model}
                  </text>
                )}
              </g>
            );
          })}

          {showBaseline &&
            baselineSorted.map(p => {
              const cx = xScale(p.time);
              const cy = yScale(p.score);
              const isHover = hover?.p.model === p.model && hover?.p.isBaseline;
              return (
                <g key={`baseline-${p.model}`} opacity={rankSeverity(p)}>
                  {isHover && <circle cx={cx} cy={cy} r={13} fill="none" stroke="#2563eb" strokeWidth="2" />}
                  <g
                    tabIndex={0}
                    style={{ cursor: 'pointer', outline: 'none' }}
                    onMouseEnter={e => handleHover(e, p)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={e => handleHover(e, p)}
                    onBlur={() => setHover(null)}
                  >
                    <Star cx={cx} cy={cy} r={7} fill="#dc2626" />
                    <title>{`${p.model} — ${p.score.toFixed(1)}${yUnit} / ${p.time.toFixed(1)}${xUnit}`}</title>
                  </g>
                  {showLabels && (
                    <text
                      x={cx}
                      y={cy - 12}
                      textAnchor="middle"
                      fontSize="10"
                      fontWeight={700}
                      fontFamily="'JetBrains Mono', 'Fira Mono', monospace"
                      fill="#991b1b"
                      style={{ paintOrder: 'stroke', stroke: '#ffffff', strokeWidth: '3px' }}
                    >
                      {p.model}
                    </text>
                  )}
                </g>
              );
            })}

          <text x={PAD.left + PLOT_W / 2} y={VH - 8} textAnchor="middle" fontSize="11" fill="#475569" fontWeight={600}>
            {xLabel}
            <tspan title={xTooltip} fill="#2563eb"> ⓘ</tspan>
          </text>
          <text x={16} y={PAD.top + PLOT_H / 2} textAnchor="middle" fontSize="11" fill="#475569" fontWeight={600} transform={`rotate(-90 16 ${PAD.top + PLOT_H / 2})`}>
            {yLabel}
          </text>
        </svg>

        {hover && (
          <div
            style={{
              position: 'absolute',
              left: Math.min(Math.max(hover.lx, 120), 10000),
              top: Math.max(hover.ly - 140, 8),
              transform: 'translateX(-50%)',
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '0.6rem 0.8rem',
              boxShadow: '0 4px 12px rgba(15,23,42,0.12)',
              zIndex: 10,
              maxWidth: '280px',
            }}
          >
            {tooltipFor(hover.p)}
          </div>
        )}
      </div>

      <div style={{ padding: '0.85rem 1.25rem', borderTop: '1px solid #f1f5f9', background: '#fff' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          {visibleProviders.map(prov => (
            <span
              key={prov}
              onMouseEnter={() => setLegendHover(prov)}
              onMouseLeave={() => setLegendHover(null)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.72rem',
                fontWeight: 600,
                color: '#475569',
                padding: '0.2rem 0.5rem',
                borderRadius: '6px',
                border: legendHover === prov ? `1px solid ${providerColor(providers, prov)}` : '1px solid transparent',
                cursor: 'pointer',
                background: legendHover === prov ? '#f8fafc' : 'transparent',
              }}
            >
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: providerColor(providers, prov), border: '1px solid #1e293b', display: 'inline-block' }} />
              {prov}
            </span>
          ))}
          {showBaseline && baselinePoints.length > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', fontWeight: 600, color: '#991b1b', padding: '0.2rem 0.5rem' }}>
              <svg width="14" height="14" viewBox="-8 -8 16 16"><Star cx={0} cy={0} r={7} fill="#dc2626" /></svg>
              Baseline (Gemini) — dashed
            </span>
          )}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', fontWeight: 600, color: '#475569', padding: '0.2rem 0.5rem' }}>
            <svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="#0f172a" strokeWidth="1.5" strokeDasharray="2 4" /></svg>
            {paretoLabel}
          </span>
        </div>
        <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: '#94a3b8', lineHeight: 1.5 }}>
          {caption} Axis: {xTooltip}
        </div>
      </div>
    </div>
  );
};
