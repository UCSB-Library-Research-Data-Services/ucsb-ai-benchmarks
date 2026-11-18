import React from 'react';
import { BAND_PALETTE, NO_BASELINE_COLOR } from '../lib/baseline';

export function BaselineLegend({ higherIsBetter }: { higherIsBetter?: boolean }) {
  const labels = higherIsBetter === false
    ? ['slowest', '', '', 'fastest']
    : ['weakest', '', '', 'strongest'];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.6rem',
        fontSize: '0.75rem',
        color: '#475569',
        margin: '0 0 0.6rem',
      }}
    >
      <span style={{ fontWeight: 600 }}>Bar colour vs DREAMLAB baselines:</span>
      {BAND_PALETTE.map((c, i) => (
        <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{ width: 14, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />
          {labels[i]}
        </span>
      ))}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
        <span style={{ width: 14, height: 10, borderRadius: 2, background: NO_BASELINE_COLOR, display: 'inline-block' }} />
        no baseline
      </span>
      <span>
        Band edges are the gemini-4-hydrogen, gemini-3.7-flash and gemini-3.5-flash-lite values; hover a bar for the edges.
      </span>
    </div>
  );
}
