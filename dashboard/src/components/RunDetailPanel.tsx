import React, { useEffect, useState } from 'react';

export type DetailKind = 'rise' | 'scicode';

interface RunDetailPanelProps {
  kind: DetailKind;
  url: string;
  title: string;
  onClose: () => void;
}

interface RiseRequest {
  line: number;
  text: string | null;
  parsed: unknown;
  score: unknown;
  usage: { input_tokens?: number; output_tokens?: number; total_tokens?: number } | null;
  duration: number | null;
  finish_reason: string | null;
  timestamp: string | null;
}

interface RiseShard {
  test_id: string;
  date: string;
  service: string;
  model: string;
  benchmark: string;
  normalized_score: number | null;
  vision_status: string | null;
  vision_note: string | null;
  num_inputs: number;
  num_scored: number;
  tokens: { input: number; output: number; total: number };
  cost_usd: number | null;
  timing: {
    mean_response_s: number | null;
    total_response_s: number | null;
    slowest_response_s: number | null;
    span_s: number | null;
  };
  raw_scoring: Record<string, unknown>;
  requests: RiseRequest[];
}

interface ScicodeStep {
  index: number;
  completion: string;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  working_time_sec: number | null;
}

interface ScicodeProblem {
  problem_id: string;
  problem_correct: number;
  total_correct: number;
  total_steps: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number | null;
  model_time_sec: number;
  steps: ScicodeStep[];
}

interface ScicodeShard {
  log_file: string;
  service: string;
  model: string;
  split: string;
  with_background: boolean;
  mode: string;
  timestamp: string;
  started_at: string | null;
  completed_at: string | null;
  problems: ScicodeProblem[];
}

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; data: RiseShard | ScicodeShard }
  | { status: 'missing' };

const detailCache = new Map<string, RiseShard | ScicodeShard | null>();

const ACCENT = '#2563eb';
const MONO = "'JetBrains Mono', 'Fira Mono', 'Courier New', monospace";
const CLIENT_TRUNCATE = 1500;

function fmtSec(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${v.toFixed(1)}s`;
}

function fmtCost(v: number | null): string {
  if (v === null || v === undefined) return '—';
  return `$${v.toFixed(4)}`;
}

function fmtScore(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return v.toFixed(1);
  if (typeof v === 'object') {
    const rec = v as Record<string, unknown>;
    for (const k of ['fuzzy', 'f1_macro', 'accuracy', 'score']) {
      if (typeof rec[k] === 'number') return `${k} ${(rec[k] as number).toFixed(1)}`;
    }
    return JSON.stringify(v).slice(0, 80);
  }
  return String(v);
}

function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return '(none)';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function prettyMaybeJson(text: string): string {
  const trimmed = text.trim();
  const looksJson =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'));
  if (!looksJson) return text;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return text;
  }
}

const SECTION_LABEL: React.CSSProperties = {
  fontSize: '0.68rem',
  fontWeight: 700,
  color: '#475569',
  marginBottom: '0.25rem',
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={e => {
        e.stopPropagation();
        const done = () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        };
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(done);
        } else {
          done();
        }
      }}
      style={{
        padding: '0.15rem 0.5rem',
        borderRadius: '4px',
        fontSize: '0.65rem',
        fontWeight: 700,
        border: '1px solid #cbd5e1',
        background: '#fff',
        color: '#475569',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

const CODE_BG = '#020617';
const CODE_FG = '#f8fafc';
const CODE_PUNCT = '#cbd5e1';
const CODE_KEY = '#93c5fd';
const CODE_STR = '#86efac';
const CODE_NUM = '#fbbf24';
const CODE_BOOL = '#f0abfc';
const CODE_NULL = '#94a3b8';

function highlightJsonTokens(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(
        <span key={key++} style={{ color: CODE_PUNCT }}>
          {text.slice(last, m.index)}
        </span>
      );
    }
    const tok = m[0];
    const str = m[1];
    const colon = m[2];
    const bool = m[3];
    const nul = m[4];
    const num = m[5];
    if (str !== undefined) {
      if (colon !== undefined) {
        nodes.push(
          <span key={key++} style={{ color: CODE_KEY }}>
            {str}
          </span>
        );
        nodes.push(
          <span key={key++} style={{ color: CODE_PUNCT }}>
            {colon}
          </span>
        );
      } else {
        nodes.push(
          <span key={key++} style={{ color: CODE_STR }}>
            {str}
          </span>
        );
      }
    } else if (bool !== undefined) {
      nodes.push(
        <span key={key++} style={{ color: CODE_BOOL }}>
          {bool}
        </span>
      );
    } else if (nul !== undefined) {
      nodes.push(
        <span key={key++} style={{ color: CODE_NULL }}>
          {nul}
        </span>
      );
    } else if (num !== undefined) {
      nodes.push(
        <span key={key++} style={{ color: CODE_NUM }}>
          {num}
        </span>
      );
    } else {
      nodes.push(
        <span key={key++} style={{ color: CODE_PUNCT }}>
          {tok}
        </span>
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) {
    nodes.push(
      <span key={key++} style={{ color: CODE_PUNCT }}>
        {text.slice(last)}
      </span>
    );
  }
  return nodes;
}

function TruncatedPre({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncate = text.length > CLIENT_TRUNCATE;
  const shown = expanded || !needsTruncate ? text : text.slice(0, CLIENT_TRUNCATE) + '…';
  const trimmed = shown.trimStart();
  const isJson = trimmed.startsWith('{') || trimmed.startsWith('[');
  return (
    <div>
      <pre
        style={{
          fontFamily: MONO,
          fontSize: '0.8rem',
          lineHeight: 1.65,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          tabSize: 2,
          background: CODE_BG,
          color: CODE_FG,
          border: '1px solid #334155',
          borderRadius: '8px',
          padding: '0.85rem 1rem',
          margin: 0,
          maxHeight: expanded ? '32rem' : '12rem',
          overflow: 'auto',
        }}
      >
        {isJson ? highlightJsonTokens(shown) : shown}
      </pre>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem', alignItems: 'center' }}>
        {needsTruncate && (
          <button
            onClick={() => setExpanded(v => !v)}
            style={{
              background: 'none',
              border: 'none',
              color: ACCENT,
              cursor: 'pointer',
              padding: 0,
              fontSize: '0.72rem',
              fontWeight: 600,
            }}
          >
            {expanded ? '[show less]' : `[show full output (${text.length.toLocaleString()} chars)]`}
          </button>
        )}
        <CopyButton text={text} />
      </div>
    </div>
  );
}

function AccordionItem({
  header,
  children,
  id,
}: {
  header: string;
  children: React.ReactNode;
  id: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        background: '#fff',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={id}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.55rem 0.85rem',
          background: open ? '#eff6ff' : '#fff',
          border: 'none',
          cursor: 'pointer',
          fontFamily: MONO,
          fontSize: '0.72rem',
          fontWeight: 600,
          color: '#334155',
          textAlign: 'left',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {header}
        </span>
        <span style={{ color: ACCENT, flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div id={id} style={{ padding: '0.75rem 0.85rem', borderTop: '1px solid #e2e8f0' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function MetaCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        padding: '0.5rem 0.7rem',
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: '0.62rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: '#64748b',
          marginBottom: '0.2rem',
        }}
      >
        {label}
      </div>
      <div
        title={value}
        style={{
          fontFamily: mono === false ? undefined : MONO,
          fontSize: '0.76rem',
          fontWeight: 600,
          color: '#1e293b',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function RiseDetail({ shard }: { shard: RiseShard }) {
  const toks = shard.tokens ?? { input: 0, output: 0, total: 0 };
  const t = shard.timing ?? {};
  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '0.5rem',
          marginBottom: '1rem',
        }}
      >
        <MetaCell label="Service" value={shard.service} />
        <MetaCell label="Model" value={shard.model} />
        <MetaCell label="Benchmark" value={shard.benchmark} mono={false} />
        <MetaCell label="Run" value={`${shard.date} / ${shard.test_id}`} />
        <MetaCell
          label="Score"
          value={shard.normalized_score !== null ? shard.normalized_score.toFixed(1) : '—'}
        />
        <MetaCell label="Scored" value={`${shard.num_scored}/${shard.num_inputs}`} />
        <MetaCell
          label="Tokens"
          value={`${toks.total.toLocaleString()} (in ${toks.input.toLocaleString()} / out ${toks.output.toLocaleString()})`}
        />
        <MetaCell label="Cost" value={fmtCost(shard.cost_usd)} />
        <MetaCell
          label="Timing mean / slow / total"
          value={`${fmtSec(t.mean_response_s)} / ${fmtSec(t.slowest_response_s)} / ${fmtSec(t.total_response_s)}`}
        />
        <MetaCell label="Vision" value={shard.vision_status ?? '—'} mono={false} />
      </div>
      {shard.vision_note && (
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={SECTION_LABEL}>Vision note</div>
          <TruncatedPre text={shard.vision_note} />
        </div>
      )}
      <div style={{ marginBottom: '0.75rem' }}>
        <div style={SECTION_LABEL}>Raw scoring</div>
        <TruncatedPre text={prettyJson(shard.raw_scoring)} />
      </div>
      <div
        style={{
          fontSize: '0.68rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: '#475569',
          marginBottom: '0.5rem',
        }}
      >
        Model outputs · {shard.requests.length} requests
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {shard.requests.map(req => {
          const tok = req.usage?.total_tokens ?? (req.usage?.input_tokens ?? 0) + (req.usage?.output_tokens ?? 0);
          const header = `#${req.line} · ${fmtScore(req.score)} · ${Number(tok).toLocaleString()} tok · ${req.duration !== null && req.duration !== undefined ? req.duration.toFixed(1) + 's' : '—'} · ${req.finish_reason ?? '—'}`;
          const body =
            req.text != null
              ? prettyMaybeJson(req.text)
              : req.parsed !== null && req.parsed !== undefined
                ? prettyJson(req.parsed)
                : '(empty output)';
          return (
            <AccordionItem key={req.line} header={header} id={`rise-${shard.test_id}-${req.line}`}>
              <div style={{ marginBottom: '0.6rem' }}>
                <div style={SECTION_LABEL}>Score</div>
                <TruncatedPre text={prettyJson(req.score)} />
              </div>
              <div style={SECTION_LABEL}>Model output</div>
              <TruncatedPre text={body} />
            </AccordionItem>
          );
        })}
      </div>
    </div>
  );
}

function ScicodeDetail({ shard }: { shard: ScicodeShard }) {
  const stepsPassed = shard.problems.reduce((s, p) => s + p.total_correct, 0);
  const stepsTotal = shard.problems.reduce((s, p) => s + p.total_steps, 0);
  const outTok = shard.problems.reduce((s, p) => s + p.output_tokens, 0);
  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '0.5rem',
          marginBottom: '1rem',
        }}
      >
        <MetaCell label="Service" value={shard.service} />
        <MetaCell label="Model" value={shard.model} />
        <MetaCell label="Split" value={String(shard.split)} />
        <MetaCell label="Timestamp" value={shard.timestamp} />
        <MetaCell label="Log file" value={shard.log_file} />
        <MetaCell label="Problems" value={String(shard.problems.length)} />
        <MetaCell label="Steps" value={`${stepsPassed}/${stepsTotal}`} />
        <MetaCell label="Output tokens" value={outTok.toLocaleString()} />
        <MetaCell label="Background" value={String(shard.with_background)} mono={false} />
      </div>
      <div
        style={{
          fontSize: '0.68rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: '#475569',
          marginBottom: '0.5rem',
        }}
      >
        Per-problem outputs · {shard.problems.length} problems
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {shard.problems.map(p => {
          const header = `Problem ${p.problem_id} · ${p.total_correct}/${p.total_steps} steps · ${p.output_tokens.toLocaleString()} tok · ${p.model_time_sec.toFixed(1)}s`;
          return (
            <AccordionItem key={p.problem_id} header={header} id={`scicode-${p.problem_id}`}>
              <div
                style={{
                  fontSize: '0.7rem',
                  color: p.problem_correct ? '#047857' : '#b91c1c',
                  fontWeight: 700,
                  marginBottom: '0.5rem',
                }}
              >
                {p.problem_correct ? '✓ Problem correct' : '✗ Problem incorrect'}
              </div>
              {p.steps.map(s => (
                <div key={s.index} style={{ marginBottom: '0.6rem' }}>
                  <div
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      color: '#475569',
                      marginBottom: '0.25rem',
                      fontFamily: MONO,
                    }}
                  >
                    Step {s.index + 1}
                  </div>
                  <TruncatedPre text={s.completion} />
                </div>
              ))}
            </AccordionItem>
          );
        })}
      </div>
      <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: '0.75rem' }}>
        Note: per-step pass/fail flags are not recorded in eval logs — correctness is shown at
        problem level; per-step model code is shown in order.
      </div>
    </div>
  );
}

export const RunDetailPanel: React.FC<RunDetailPanelProps> = ({ kind, url, title, onClose }) => {
  const [state, setState] = useState<LoadState>(() => {
    if (detailCache.has(url)) {
      const cached = detailCache.get(url);
      return cached ? { status: 'loaded', data: cached } : { status: 'missing' };
    }
    return { status: 'loading' };
  });

  useEffect(() => {
    if (detailCache.has(url)) {
      const cached = detailCache.get(url);
      setState(cached ? { status: 'loaded', data: cached } : { status: 'missing' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        detailCache.set(url, data);
        if (!cancelled) setState({ status: 'loaded', data });
      })
      .catch(() => {
        detailCache.set(url, null);
        if (!cancelled) setState({ status: 'missing' });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div
      style={{
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        padding: '1rem 1.25rem',
        fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          marginBottom: '0.85rem',
        }}
      >
        <div
          style={{
            fontFamily: MONO,
            fontSize: '0.76rem',
            fontWeight: 700,
            color: '#0f172a',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={title}
        >
          {title}
        </div>
        <button
          onClick={onClose}
          aria-label="Close run details"
          style={{
            padding: '0.2rem 0.6rem',
            borderRadius: '999px',
            fontSize: '0.72rem',
            fontWeight: 700,
            border: '1px solid #cbd5e1',
            background: '#fff',
            color: '#475569',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          ✕ Close
        </button>
      </div>
      {state.status === 'loading' && (
        <div style={{ fontSize: '0.78rem', color: '#64748b', padding: '1rem 0' }}>
          Loading run details…
        </div>
      )}
      {state.status === 'missing' && (
        <div style={{ fontSize: '0.78rem', color: '#64748b', padding: '1rem 0' }}>
          Details not available for this run (no detail shard was published for it).
        </div>
      )}
      {state.status === 'loaded' &&
        (kind === 'rise' ? (
          <RiseDetail shard={state.data as RiseShard} />
        ) : (
          <ScicodeDetail shard={state.data as ScicodeShard} />
        ))}
    </div>
  );
};
