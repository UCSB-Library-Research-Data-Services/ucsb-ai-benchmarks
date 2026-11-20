import React, { useState, useMemo, useRef } from 'react';
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
  '#2b5c8f', '#0d9488', '#6d59a3', '#d97706',
  '#3d8b6e', '#4a7c9b', '#9a6b4f', '#52658f',
];

const BASELINE_FILL = '#475569';
const BASELINE_STROKE = '#1e293b';
const BASELINE_LINE = '#64748b';
const BASELINE_TEXT = '#334155';

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

function Diamond({ cx, cy, r, fill }: { cx: number; cy: number; r: number; fill: string }) {
  const pts = [
    `${cx},${cy - r}`,
    `${cx + r},${cy}`,
    `${cx},${cy + r}`,
    `${cx - r},${cy}`,
  ].join(' ');
  return (
    <g>
      <polygon
        points={pts}
        fill={fill}
        stroke={BASELINE_STROKE}
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <circle cx={cx} cy={cy} r={r * 0.28} fill="#f8fafc" />
    </g>
  );
}

const VW = 920;
const VH = 460;
const PAD = { top: 24, right: 36, bottom: 55, left: 70 };
const PLOT_W = VW - PAD.left - PAD.right;
const PLOT_H = VH - PAD.top - PAD.bottom;

interface HoverState {
  p: ScatterPoint;
  lx: number;
  ly: number;
  cw: number;
  ch: number;
}

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
  const [hover, setHover] = useState<HoverState | null>(null);
  const [legendHover, setLegendHover] = useState<string | null>(null);
  const plotContainerRef = useRef<HTMLDivElement | null>(null);

  const frontier = useMemo(() => computeParetoFrontier(points), [points]);
  const frontierKeys = useMemo(() => new Set(frontier.map(p => `${p.provider}|${p.model}`)), [frontier]);

  const bounds = useMemo(() => {
    const all = showBaseline ? [...points, ...baselinePoints] : points;
    if (all.length === 0) return { xMin: 0, xMax: 1, yMin: 0, yMax: 100 };
    const xs = all.map(p => p.time).filter(v => v > 0);
    if (xs.length === 0) return { xMin: 0, xMax: 1, yMin: 0, yMax: 100 };
    let xMin = Math.min(...xs);
    let xMax = Math.max(...xs);
    if (xMin === xMax) {
      xMin = xMin * 0.8 || 0;
      xMax = xMax * 1.2 || 1;
    }
    const xPad = (xMax - xMin) * 0.06;
    xMin = Math.max(0, xMin - xPad);
    xMax = xMax + xPad;
    return { xMin, xMax, yMin: 0, yMax: 100 };
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

  const yTicks = useMemo(() => [0, 20, 40, 60, 80, 100], []);

  const visibleProviders = useMemo(
    () => providers.filter(p => points.some(pt => pt.provider === p)),
    [providers, points]
  );

  const rankSeverity = (p: ScatterPoint) => {
    if (legendHover === null) return 1;
    if (p.isBaseline) return 0.55;
    return p.provider === legendHover ? 1 : 0.25;
  };

  const baselineSorted = useMemo(
    () => [...baselinePoints].sort((a, b) => a.time - b.time),
    [baselinePoints]
  );

  const paretoPath = frontier.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.time)},${yScale(p.score)}`).join(' ');
  const baselinePath = baselineSorted.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.time)},${yScale(p.score)}`).join(' ');

  const labelOffsets = useMemo(() => {
    const allPts = [
      ...points.map(p => ({ key: `${p.provider}|${p.model}`, cx: xScale(p.time), cy: yScale(p.score), r: p.tokens !== null ? Math.min(11, Math.max(5, Math.sqrt(p.tokens) * 0.15)) : 6.5 })),
      ...(showBaseline ? baselineSorted.map(p => ({ key: `baseline-${p.model}`, cx: xScale(p.time), cy: yScale(p.score), r: 8 })) : []),
    ].sort((a, b) => a.cx - b.cx || a.cy - b.cy);

    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const map = new Map<string, { dx: number; dy: number; anchor: 'middle' | 'start' | 'end' }>();

    for (const pt of allPts) {
      const labelLen = pt.key.split('|').pop()?.length ?? 12;
      const w = labelLen * 5.6;
      const h = 12;
      const candidates: { dx: number; dy: number; anchor: 'middle' | 'start' | 'end' }[] = [
        { dx: 0, dy: -(pt.r + 5), anchor: 'middle' },
        { dx: 0, dy: pt.r + 12, anchor: 'middle' },
        { dx: pt.r + 6, dy: 3, anchor: 'start' },
        { dx: -(pt.r + 6), dy: 3, anchor: 'end' },
        { dx: 0, dy: -(pt.r + 16), anchor: 'middle' },
        { dx: 0, dy: pt.r + 23, anchor: 'middle' },
      ];
      let chosen = candidates[0];
      for (const c of candidates) {
        const boxX = c.anchor === 'middle' ? pt.cx + c.dx - w / 2 : c.anchor === 'start' ? pt.cx + c.dx : pt.cx + c.dx - w;
        const boxY = pt.cy + c.dy - h;
        const collides = placed.some(
          b => Math.abs(boxX + w / 2 - (b.x + b.w / 2)) < (w + b.w) / 2 && Math.abs(boxY + h / 2 - (b.y + b.h / 2)) < (h + b.h) / 2
        );
        if (!collides) {
          chosen = c;
          break;
        }
      }
      const finalX = chosen.anchor === 'middle' ? pt.cx + chosen.dx - w / 2 : chosen.anchor === 'start' ? pt.cx + chosen.dx : pt.cx + chosen.dx - w;
      const finalY = pt.cy + chosen.dy - h;
      placed.push({ x: finalX, y: finalY, w, h });
      map.set(pt.key, chosen);
    }
    return map;
  }, [points, baselineSorted, showBaseline, bounds, useLog]);

  const setHoverForPoint = (p: ScatterPoint, svgEl: SVGSVGElement | null) => {
    const container = plotContainerRef.current;
    const cx = xScale(p.time);
    const cy = yScale(p.score);
    if (container && svgEl) {
      const cRect = container.getBoundingClientRect();
      const sRect = svgEl.getBoundingClientRect();
      setHover({
        p,
        lx: (cx / VW) * sRect.width + (sRect.left - cRect.left) + container.scrollLeft,
        ly: (cy / VH) * sRect.height + (sRect.top - cRect.top) + container.scrollTop,
        cw: cRect.width,
        ch: cRect.height,
      });
    } else {
      setHover({ p, lx: cx, ly: cy, cw: VW, ch: VH });
    }
  };

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svgEl = e.currentTarget;
    const sRect = svgEl.getBoundingClientRect();
    if (sRect.width === 0 || sRect.height === 0) return;
    const svgX = ((e.clientX - sRect.left) / sRect.width) * VW;
    const svgY = ((e.clientY - sRect.top) / sRect.height) * VH;

    const candidates = showBaseline ? [...points, ...baselineSorted] : points;
    let best: ScatterPoint | null = null;
    let bestDist = 18;
    for (const p of candidates) {
      const d = Math.hypot(xScale(p.time) - svgX, yScale(p.score) - svgY);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    if (best) {
      setHoverForPoint(best, svgEl);
    } else if (hover !== null) {
      setHover(null);
    }
  };

  const handleFocus = (e: React.FocusEvent, p: ScatterPoint) => {
    const svgEl = (e.currentTarget as Element).closest('svg');
    setHoverForPoint(p, svgEl);
  };

  const tooltipFor = (p: ScatterPoint) => {
    const isFrontier = frontierKeys.has(`${p.provider}|${p.model}`) && !p.isBaseline;
    const provCol = providerColor(providers, p.provider);
    return (
      <div style={{ pointerEvents: 'none', fontSize: '0.75rem', lineHeight: 1.5, minWidth: '215px', color: '#1e293b' }}>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
          {p.isBaseline ? (
            <span style={{ background: BASELINE_FILL, color: '#fff', padding: '0.1rem 0.45rem', borderRadius: '4px', fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Gemini Baseline
            </span>
          ) : (
            <span style={{ background: provCol + '1a', color: provCol, border: `1px solid ${provCol}45`, padding: '0.1rem 0.45rem', borderRadius: '4px', fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {p.provider}
            </span>
          )}
          <span style={{ fontFamily: "'JetBrains Mono', 'Fira Mono', monospace", fontWeight: 700, color: '#0f172a' }}>{p.model}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: '0.6rem', rowGap: '0.1rem', color: '#475569' }}>
          <span>Score:</span>
          <strong style={{ color: '#0f172a', fontFamily: "'JetBrains Mono', monospace" }}>{p.score.toFixed(1)}{yUnit}</strong>
          <span>Time:</span>
          <strong style={{ color: '#0f172a', fontFamily: "'JetBrains Mono', monospace" }}>{p.time.toFixed(2).replace(/\.00$/, '.0')}{xUnit === 'm' ? ' min' : 's'}</strong>
          <span>Tokens:</span>
          <strong style={{ color: '#0f172a', fontFamily: "'JetBrains Mono', monospace" }}>{fmtTokens(p.tokens)} tok</strong>
        </div>
        {isFrontier && (
          <div style={{ marginTop: '0.3rem', paddingTop: '0.25rem', borderTop: '1px solid #f1f5f9', color: '#0f172a', fontWeight: 700, fontSize: '0.7rem' }}>
            ◆ Pareto frontier
          </div>
        )}
        {p.isBaseline && (
          <div style={{ marginTop: '0.3rem', paddingTop: '0.25rem', borderTop: '1px solid #f1f5f9', color: BASELINE_TEXT, fontWeight: 600, fontSize: '0.7rem' }}>
            Reference baseline (not ranked)
          </div>
        )}
      </div>
    );
  };

  const getTooltipPosition = (h: HoverState): React.CSSProperties => {
    const placeBelow = h.ly < 145;
    const nearLeft = h.lx < 150;
    const nearRight = h.lx > h.cw - 150;

    const tx = nearLeft ? '0%' : nearRight ? '-100%' : '-50%';
    const ty = placeBelow ? '0%' : '-100%';
    const left = nearLeft ? Math.max(10, h.lx - 12) : nearRight ? Math.min(h.cw - 10, h.lx + 12) : h.lx;
    const top = placeBelow ? h.ly + 16 : h.ly - 14;

    return {
      position: 'absolute',
      left,
      top,
      transform: `translate(${tx}, ${ty})`,
      background: 'rgba(255, 255, 255, 0.98)',
      border: '1px solid #cbd5e1',
      borderRadius: '8px',
      padding: '0.6rem 0.8rem',
      boxShadow: '0 8px 20px rgba(15, 23, 42, 0.14)',
      zIndex: 30,
      maxWidth: '290px',
      pointerEvents: 'none',
    };
  };

  return (
    <div
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        background: '#fff',
        fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif",
        position: 'relative',
      }}
    >
      <div
        style={{
          background: '#f8fafc',
          borderBottom: '1px solid #e2e8f0',
          borderRadius: '12px 12px 0 0',
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
            <input type="checkbox" checked={showBaseline} onChange={e => setShowBaseline(e.target.checked)} style={{ accentColor: '#2b5c8f' }} />
            Show Gemini baseline
          </label>
          <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} style={{ accentColor: '#2b5c8f' }} />
            Show labels
          </label>
          {allowLogX && (
            <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={logX} onChange={e => setLogX(e.target.checked)} style={{ accentColor: '#2b5c8f' }} />
              Log X scale
            </label>
          )}
        </div>
      </div>

      <div ref={plotContainerRef} style={{ overflowX: 'auto', position: 'relative' }}>
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          style={{ width: '100%', minWidth: '640px', display: 'block', background: '#fff', cursor: hover ? 'pointer' : 'default' }}
          role="img"
          aria-label={title}
          onMouseMove={handleSvgMouseMove}
          onMouseLeave={() => setHover(null)}
        >
          {yTicks.map(t => (
            <g key={`y-${t}`}>
              <line x1={PAD.left} y1={yScale(t)} x2={PAD.left + PLOT_W} y2={yScale(t)} stroke="#e2e8f0" strokeWidth="1" />
              <text x={PAD.left - 8} y={yScale(t) + 4} textAnchor="end" fontSize="10" fill="#64748b" fontFamily="'JetBrains Mono', monospace">
                {t.toFixed(0)}{yUnit}
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

          {frontier.length >= 2 && <path d={paretoPath} fill="none" stroke="#0f172a" strokeWidth="1.5" strokeDasharray="2 4" style={{ pointerEvents: 'none' }} />}

          {showBaseline && baselineSorted.length >= 2 && (
            <path d={baselinePath} fill="none" stroke={BASELINE_LINE} strokeWidth="1.75" strokeDasharray="6 4" style={{ pointerEvents: 'none' }} />
          )}

          {points.map(p => {
            const r = p.tokens !== null ? Math.min(11, Math.max(5, Math.sqrt(p.tokens) * 0.15)) : 6.5;
            const cx = xScale(p.time);
            const cy = yScale(p.score);
            const isHover = hover?.p.provider === p.provider && hover?.p.model === p.model && !hover?.p.isBaseline;
            const offset = labelOffsets.get(`${p.provider}|${p.model}`) ?? { dx: 0, dy: -(r + 5), anchor: 'middle' as const };
            const color = providerColor(providers, p.provider);
            return (
              <g key={`${p.provider}|${p.model}`} opacity={rankSeverity(p)}>
                {showLabels && (
                  <text
                    x={cx + offset.dx}
                    y={cy + offset.dy}
                    textAnchor={offset.anchor}
                    fontSize="9.5"
                    fontWeight={isHover ? 700 : 500}
                    fontFamily="'JetBrains Mono', 'Fira Mono', monospace"
                    fill="#1e293b"
                    style={{ paintOrder: 'stroke', stroke: '#ffffff', strokeWidth: '3px', pointerEvents: 'none' }}
                  >
                    {p.model}
                  </text>
                )}
                {isHover && (
                  <circle cx={cx} cy={cy} r={r + 5} fill="none" stroke={color} strokeWidth="2.2" style={{ pointerEvents: 'none' }} />
                )}
                <g
                  tabIndex={0}
                  style={{ cursor: 'pointer', outline: 'none' }}
                  onFocus={e => handleFocus(e, p)}
                  onBlur={() => setHover(null)}
                >
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={color}
                    fillOpacity={0.9}
                    stroke="#0f172a"
                    strokeWidth={isHover ? '1.6' : '1'}
                  />
                </g>
              </g>
            );
          })}

          {showBaseline &&
            baselineSorted.map(p => {
              const cx = xScale(p.time);
              const cy = yScale(p.score);
              const isHover = hover?.p.model === p.model && Boolean(hover?.p.isBaseline);
              const offset = labelOffsets.get(`baseline-${p.model}`) ?? { dx: 0, dy: -12, anchor: 'middle' as const };
              return (
                <g key={`baseline-${p.model}`} opacity={rankSeverity(p)}>
                  {showLabels && (
                    <text
                      x={cx + offset.dx}
                      y={cy + offset.dy}
                      textAnchor={offset.anchor}
                      fontSize="9.5"
                      fontWeight={700}
                      fontFamily="'JetBrains Mono', 'Fira Mono', monospace"
                      fill={BASELINE_TEXT}
                      style={{ paintOrder: 'stroke', stroke: '#ffffff', strokeWidth: '3px', pointerEvents: 'none' }}
                    >
                      {p.model}
                    </text>
                  )}
                  {isHover && (
                    <circle cx={cx} cy={cy} r={13} fill="none" stroke={BASELINE_FILL} strokeWidth="2" style={{ pointerEvents: 'none' }} />
                  )}
                  <g
                    tabIndex={0}
                    style={{ cursor: 'pointer', outline: 'none' }}
                    onFocus={e => handleFocus(e, p)}
                    onBlur={() => setHover(null)}
                  >
                    <Diamond cx={cx} cy={cy} r={7.5} fill={BASELINE_FILL} />
                  </g>
                </g>
              );
            })}

          <text x={PAD.left + PLOT_W / 2} y={VH - 8} textAnchor="middle" fontSize="11" fill="#475569" fontWeight={600}>
            {xLabel}
            <tspan fill="#2b5c8f" style={{ cursor: 'help' }}>
              {' '}ⓘ
              <title>{xTooltip}</title>
            </tspan>
          </text>
          <text x={16} y={PAD.top + PLOT_H / 2} textAnchor="middle" fontSize="11" fill="#475569" fontWeight={600} transform={`rotate(-90 16 ${PAD.top + PLOT_H / 2})`}>
            {yLabel}
          </text>
        </svg>

        {hover && <div style={getTooltipPosition(hover)}>{tooltipFor(hover.p)}</div>}
      </div>

      <div style={{ padding: '0.85rem 1.25rem', borderTop: '1px solid #f1f5f9', borderRadius: '0 0 12px 12px', background: '#fff' }}>
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
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: providerColor(providers, prov), border: '1px solid #0f172a', display: 'inline-block' }} />
              {prov}
            </span>
          ))}
          {showBaseline && baselinePoints.length > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', fontWeight: 600, color: BASELINE_TEXT, padding: '0.2rem 0.5rem' }}>
              <svg width="14" height="14" viewBox="-9 -9 18 18"><Diamond cx={0} cy={0} r={7} fill={BASELINE_FILL} /></svg>
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
