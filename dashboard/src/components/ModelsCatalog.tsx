import React, { useEffect, useMemo, useState } from 'react';
import type { CatalogModel, CatalogProvider } from '../lib/catalog';
import { providerAnchor, providerColor } from '../lib/catalog';
import { withBase } from '../lib/paths';

interface ModelsCatalogProps {
  models: CatalogModel[];
  providers: CatalogProvider[];
}

const ACCENT = '#2563eb';

function fmtTokensShort(n: number): string {
  if (n % 1000 === 0) return `${n / 1000}K`;
  return String(n);
}

function OwnerBadge({ ownedBy }: { ownedBy: string }) {
  return (
    <span
      title="Serving backend (owned_by) as reported by the gateway's /models endpoint"
      style={{
        display: 'inline-block',
        padding: '0.1rem 0.45rem',
        borderRadius: '4px',
        fontSize: '0.65rem',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        background: '#eef2ff',
        color: '#4338ca',
        border: '1px solid #c7d2fe',
        flexShrink: 0,
      }}
    >
      owner: {ownedBy}
    </span>
  );
}

function MaxTokensBadge({ tokens, source }: { tokens: number; source: string | null }) {
  const tooltip = `Max output tokens accepted by this gateway (verified from an observed gateway limit)${
    source ? ` — ${source}` : ''
  }. Benchmark requests are clamped to this value.`;
  return (
    <span
      title={tooltip}
      style={{
        display: 'inline-block',
        padding: '0.1rem 0.45rem',
        borderRadius: '4px',
        fontSize: '0.65rem',
        fontWeight: 700,
        background: '#ecfeff',
        color: '#0e7490',
        border: '1px solid #a5f3fc',
        flexShrink: 0,
      }}
    >
      ≤ {fmtTokensShort(tokens)} out tok
    </span>
  );
}

function VisionBadge({ vision, status }: { vision: boolean | null; status: string | null }) {
  if (vision === true) {
    return (
      <span
        title={`Vision-capable${status ? ` (${status})` : ''}`}
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
        ✓ vision
      </span>
    );
  }
  if (vision === false) {
    return (
      <span
        title={`Not vision-capable${status ? ` (${status})` : ''}`}
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
        ✗ vision
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
      — untested
    </span>
  );
}

export const ModelsCatalog: React.FC<ModelsCatalogProps> = ({ models, providers }) => {
  const [query, setQuery] = useState('');
  const [selectedProviders, setSelectedProviders] = useState<Set<string> | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const canonicalIds = useMemo(() => providers.map(p => p.id).sort(), [providers]);
  const isAllMode = selectedProviders === null;

  useEffect(() => {
    const hash = (window.location.hash || '').replace(/^#/, '');
    if (!hash) return;
    const bySlug = models.find(m => m.slug === hash);
    if (bySlug) {
      setSelectedProviders(new Set([bySlug.service]));
      setHighlighted(bySlug.slug);
    } else {
      const byProvider = providers.find(
        p => providerAnchor(p.id) === hash || `models-${p.id.toLowerCase()}` === hash
      );
      if (byProvider) setSelectedProviders(new Set([byProvider.id]));
      else return;
    }
    const t = window.setTimeout(() => setHighlighted(null), 3000);
    return () => window.clearTimeout(t);
  }, [models, providers]);

  const toggleProvider = (id: string) => {
    if (isAllMode) {
      setSelectedProviders(new Set([id]));
    } else {
      const next = new Set(selectedProviders);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelectedProviders(next.size === 0 ? null : next);
    }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter(m => {
      if (!isAllMode && !selectedProviders!.has(m.service)) return false;
      if (q && !m.model.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [models, query, selectedProviders, isAllMode]);

  const grouped = useMemo(() => {
    const order = new Map(providers.map((p, i) => [p.id, i]));
    const groups = new Map<string, CatalogModel[]>();
    for (const m of visible) {
      if (!groups.has(m.service)) groups.set(m.service, []);
      groups.get(m.service)!.push(m);
    }
    return [...groups.entries()].sort(
      (a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99)
    );
  }, [visible, providers]);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          alignItems: 'flex-end',
          marginBottom: '1.5rem',
        }}
      >
        <div style={{ flex: '1 1 16rem', minWidth: '12rem' }}>
          <label
            htmlFor="models-search"
            style={{
              display: 'block',
              fontSize: '0.68rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: '#64748b',
              marginBottom: '0.5rem',
            }}
          >
            Search models
          </label>
          <input
            id="models-search"
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter by model id…"
            style={{
              width: '100%',
              padding: '0.45rem 0.75rem',
              borderRadius: '6px',
              border: '1.5px solid #cbd5e1',
              fontSize: '0.85rem',
              color: '#1e293b',
              outline: 'none',
            }}
          />
        </div>
        <div style={{ flex: '2 1 auto' }}>
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
              }}
            >
              All
            </button>
            {providers.map(p => {
              const active = !isAllMode && selectedProviders!.has(p.id);
              const color = providerColor(canonicalIds, p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => toggleProvider(p.id)}
                  style={{
                    padding: '0.3rem 0.75rem',
                    borderRadius: '999px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    border: active ? `1.5px solid ${color}` : '1.5px solid #cbd5e1',
                    background: active ? color : '#fff',
                    color: active ? '#fff' : '#475569',
                    cursor: 'pointer',
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
                  {p.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '1.5rem' }}>
        Showing <strong style={{ color: '#475569' }}>{visible.length}</strong> of{' '}
        <strong style={{ color: '#475569' }}>{models.length}</strong> models
      </p>

      {grouped.map(([service, items]) => {
        const color = providerColor(canonicalIds, service);
        const total = models.filter(m => m.service === service).length;
        return (
          <section key={service} id={`models-${service.toLowerCase()}`} style={{ scrollMarginTop: '5rem', marginBottom: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
              <span
                style={{
                  display: 'inline-block',
                  padding: '0.15rem 0.6rem',
                  borderRadius: '4px',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  background: color + '18',
                  color,
                  border: `1px solid ${color}40`,
                }}
              >
                {service}
              </span>
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                {items.length} of {total} model{total === 1 ? '' : 's'}
              </span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(17rem, 1fr))',
                gap: '0.9rem',
              }}
            >
              {items.map(m => {
                const isHi = highlighted === m.slug;
                return (
                  <article
                    key={m.slug}
                    id={m.slug}
                    style={{
                      scrollMarginTop: '5.5rem',
                      background: '#fff',
                      border: isHi ? `2px solid ${ACCENT}` : '1px solid #e2e8f0',
                      borderRadius: '0.6rem',
                      padding: '1rem 1.1rem',
                      boxShadow: isHi ? '0 0 0 4px rgba(37,99,235,0.15)' : '0 1px 3px rgba(0,0,0,0.06)',
                      transition: 'box-shadow 0.3s, border-color 0.3s',
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "'JetBrains Mono', 'Fira Mono', monospace",
                        fontWeight: 600,
                        fontSize: '0.85rem',
                        color: '#1e293b',
                        overflowWrap: 'anywhere',
                        marginBottom: '0.5rem',
                      }}
                    >
                      {m.model}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.6rem' }}>
                      <VisionBadge vision={m.vision} status={m.vision_status} />
                      {m.owned_by && <OwnerBadge ownedBy={m.owned_by} />}
                      {m.max_output_tokens !== null && m.max_output_tokens !== undefined && (
                        <MaxTokensBadge tokens={m.max_output_tokens} source={m.max_output_tokens_source} />
                      )}
                      {m.in_roster && !m.in_api && (
                        <span
                          title="In the config roster but not listed by the provider API"
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
                          not listed by API
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                      {m.benchmarked.performance && (
                        <a href={withBase('leaderboard')} style={{ fontSize: '0.75rem', fontWeight: 600, color: ACCENT, textDecoration: 'none' }}>
                          Performance →
                        </a>
                      )}
                      {m.benchmarked.scicode && (
                        <a href={withBase('scicode')} style={{ fontSize: '0.75rem', fontWeight: 600, color: ACCENT, textDecoration: 'none' }}>
                          SciCode →
                        </a>
                      )}
                      {m.benchmarked.rise && (
                        <a href={withBase('rise')} style={{ fontSize: '0.75rem', fontWeight: 600, color: ACCENT, textDecoration: 'none' }}>
                          RISE →
                        </a>
                      )}
                      {!m.benchmarked.performance && !m.benchmarked.scicode && !m.benchmarked.rise && (
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Not yet benchmarked</span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      {visible.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8', fontSize: '0.85rem' }}>
          No models match the current search and filters.
        </div>
      )}
    </div>
  );
};
