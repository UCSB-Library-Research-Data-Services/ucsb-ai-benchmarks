#!/usr/bin/env python3
"""Collect RISE pilot results into data/rise_results.jsonl (one row per run).

Walks ``<results-dir>/<YYYY-MM-DD>/<run-id>/`` directories, reads each run's
``scoring.json`` plus all ``request_*.json`` files, normalizes the benchmark's
ranking metric to a 0-100 score (vendored semantics of
``RISE/scripts/ndr_export/meta_utils.py:calculate_normalized_score``), and joins
each row with the model's vision flag from ``data/model_capabilities.json``.

Run identity (service, model, benchmark) resolution:
  1. ``run_meta.json`` written by ``run_rise_ucsb.py`` inside the run dir (U-namespace runs);
  2. fallback: upstream ``RISE/benchmarks/benchmarks_tests.csv`` mapping test-id -> benchmark
     (provider/model), for validating against upstream results (e.g. RISE/results/2026-09-09/T1740).

Stdlib only (no third-party imports). Idempotent: ``--out`` is rewritten wholly each run.

Usage:
  uv run rise_eval/collect_rise_results.py
  uv run rise_eval/collect_rise_results.py --results-dir RISE/results --date 2026-09-09 --test-id T1740
"""
import argparse
import csv
import json
import sys
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RESULTS_DIR = REPO_ROOT / "rise_eval" / "results"
DEFAULT_OUT = REPO_ROOT / "data" / "rise_results.jsonl"
DEFAULT_CAPABILITIES = REPO_ROOT / "data" / "model_capabilities.json"
DEFAULT_RISE_ROOT = REPO_ROOT / "RISE"

NOTE_TRUNCATE = 200


def load_json(path):
    """Parse a JSON file, returning None on any failure."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None
    except (json.JSONDecodeError, OSError) as e:
        print(f"WARNING: failed to parse {path}: {e}", file=sys.stderr)
        return None


def load_ranking_configs(rise_root):
    """Read each pilot-relevant benchmark's ranking config from RISE/benchmarks/<name>/meta.json.

    Returns {benchmark_name: {"metric": str, "order": str}} (empty dict when meta.json
    is missing, so normalization can still fall back to common metric names).
    """
    configs = {}
    benchmarks_dir = rise_root / "benchmarks"
    if not benchmarks_dir.is_dir():
        print(f"WARNING: benchmarks dir not found: {benchmarks_dir}", file=sys.stderr)
        return configs
    for meta_path in sorted(benchmarks_dir.glob("*/meta.json")):
        meta = load_json(meta_path) or {}
        ranking = meta.get("ranking") or {}
        configs[meta_path.parent.name] = {
            "metric": ranking.get("metric"),
            "order": ranking.get("order", "desc"),
        }
    return configs


def calculate_normalized_score(scoring_data, benchmark_name, ranking_configs):
    """Normalized 0-100 score; vendored from RISE/scripts/ndr_export/meta_utils.py.

    value > 1 -> already 0-100 (desc: as-is; asc: 100-v)
    value <= 1 -> x100 (desc: v*100; asc: 100-v*100); clamped to [0, 100];
    None when missing / "niy" / not parseable.
    """
    if not scoring_data:
        return None
    if scoring_data.get("score") == "niy":
        return None

    ranking = ranking_configs.get(benchmark_name) or {}
    metric = ranking.get("metric")
    order = ranking.get("order", "desc")

    if not metric:
        for fallback in ("fuzzy", "f1_macro", "accuracy", "precision", "recall"):
            if scoring_data.get(fallback) not in (None, "niy"):
                metric = fallback
                order = "desc"
                break
    if not metric or metric not in scoring_data:
        return None

    value = scoring_data.get(metric)
    if value is None or value == "niy":
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None

    if value > 1.0:
        normalized = value if order == "desc" else max(0, 100 - value)
    else:
        normalized = value * 100 if order == "desc" else max(0, 100 - value * 100)
    return min(100, max(0, normalized))


def load_test_csv_mapping(rise_root):
    """Upstream fallback: test-id -> {name, provider, model} from benchmarks_tests.csv."""
    csv_path = rise_root / "benchmarks" / "benchmarks_tests.csv"
    mapping = {}
    if not csv_path.is_file():
        return mapping
    with open(csv_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("id"):
                mapping[row["id"]] = {
                    "benchmark": row.get("name"),
                    "service": row.get("provider"),
                    "model": row.get("model"),
                }
    return mapping


def load_capabilities(path):
    """(service_lower, model) -> {vision, vision_status, vision_note} from the capabilities file."""
    data = load_json(path) or {}
    table = {}
    for entry in data.get("models", []):
        service = (entry.get("service") or "").lower()
        model = entry.get("model")
        if not model:
            continue
        tools = entry.get("tools") or {}
        table[(service, model)] = {
            "vision": tools.get("vision"),
            "vision_status": entry.get("status"),
            "vision_note": entry.get("note"),
        }
    return table


def summarize_requests(run_dir):
    """Aggregate all request_*.json files: counts, token totals, cost, timing."""
    num_inputs = 0
    num_scored = 0
    tokens = {"input": 0, "output": 0, "total": 0}
    costs = []
    durations = []
    timestamps = []
    for req_path in sorted(run_dir.glob("request_*.json")):
        num_inputs += 1
        req = load_json(req_path)
        if req is None:
            continue
        if req.get("score") is not None:
            num_scored += 1
        usage = req.get("usage") or {}
        tokens["input"] += usage.get("input_tokens") or 0
        tokens["output"] += usage.get("output_tokens") or 0
        tokens["total"] += usage.get("total_tokens") or 0
        estimated = usage.get("estimated_cost_usd")
        if estimated is not None:
            costs.append(estimated)
        duration = req.get("duration")
        if duration is not None:
            durations.append(duration)
        ts = req.get("timestamp")
        if ts:
            try:
                timestamps.append(datetime.fromisoformat(ts))
            except ValueError:
                pass
    if costs:
        cost_usd = sum(costs)
    else:
        cost_usd = None
    span_s = (max(timestamps) - min(timestamps)).total_seconds() if len(timestamps) >= 2 else None
    timing = {
        "mean_response_s": (sum(durations) / len(durations)) if durations else None,
        "total_response_s": sum(durations) if durations else None,
        "slowest_response_s": max(durations) if durations else None,
        "span_s": span_s,
    }
    return num_inputs, num_scored, tokens, cost_usd, timing


def resolve_run_identity(run_dir, test_id, csv_mapping):
    """Return {service, model, benchmark} for a run dir, or None with a reason."""
    run_meta = load_json(run_dir / "run_meta.json")
    if run_meta:
        identity = {
            "service": run_meta.get("service"),
            "model": run_meta.get("model"),
            "benchmark": run_meta.get("benchmark"),
        }
        if all(identity.values()):
            return identity
    fallback = csv_mapping.get(test_id)
    if fallback:
        return {
            "service": fallback.get("service"),
            "model": fallback.get("model"),
            "benchmark": fallback.get("benchmark"),
        }
    return None


def collect(results_dir, capabilities, csv_mapping, ranking_configs, date_filter=None, test_id_filter=None):
    """Yield (rows, skipped, warned_combos) over all matching run directories."""
    rows = []
    skipped = []  # (run_dir, reason)
    warned_combos = set()

    if not results_dir.is_dir():
        print(f"ERROR: results dir not found: {results_dir}", file=sys.stderr)
        return rows, skipped, warned_combos

    for date_dir in sorted(p for p in results_dir.iterdir() if p.is_dir()):
        date_str = date_dir.name
        if date_filter and date_str != date_filter:
            continue
        for run_dir in sorted(p for p in date_dir.iterdir() if p.is_dir()):
            test_id = run_dir.name
            if test_id_filter and test_id != test_id_filter:
                continue

            scoring = load_json(run_dir / "scoring.json")
            if scoring is None:
                skipped.append((f"{date_str}/{test_id}", "missing scoring.json"))
                continue
            if scoring.get("score") == "niy":
                skipped.append((f"{date_str}/{test_id}", 'scoring.score == "niy"'))
                continue

            identity = resolve_run_identity(run_dir, test_id, csv_mapping)
            if identity is None:
                skipped.append((f"{date_str}/{test_id}", "unknown run: no run_meta.json and not in benchmarks_tests.csv"))
                continue

            num_inputs, num_scored, tokens, cost_usd, timing = summarize_requests(run_dir)

            cap_key = ((identity["service"] or "").lower(), identity["model"])
            cap = capabilities.get(cap_key)
            if cap is None:
                warned_combos.add((identity["service"], identity["model"]))
                vision, vision_status, vision_note = None, None, None
            else:
                vision = cap["vision"]
                vision_status = cap["vision_status"]
                note = cap["vision_note"]
                vision_note = (note[: NOTE_TRUNCATE - 1] + "…") if note and len(note) > NOTE_TRUNCATE else note

            rows.append({
                "service": identity["service"],
                "model": identity["model"],
                "benchmark": identity["benchmark"],
                "test_id": test_id,
                "date": date_str,
                "normalized_score": calculate_normalized_score(scoring, identity["benchmark"], ranking_configs),
                "vision": vision,
                "vision_status": vision_status,
                "vision_note": vision_note,
                "raw_scoring": scoring,
                "num_inputs": num_inputs,
                "num_scored": num_scored,
                "tokens": tokens,
                "cost_usd": cost_usd,
                "timing": timing,
            })

    rows.sort(key=lambda r: (str(r["service"]), str(r["model"]), str(r["benchmark"]), r["date"], r["test_id"]))
    return rows, skipped, warned_combos


def print_summary(rows, skipped, warned_combos, out_path):
    """Human-readable summary: service x benchmark means + skip/failure counts."""
    print(f"\nWrote {len(rows)} row(s) to {out_path}")

    cells = {}
    for row in rows:
        if row["normalized_score"] is not None:
            cells.setdefault((row["service"], row["benchmark"]), []).append(row["normalized_score"])
    services = sorted({s for s, _ in cells})
    benchmarks = sorted({b for _, b in cells})
    if services:
        header = f"{'service':<12}" + "".join(f"{b[:24]:>26}" for b in benchmarks)
        print("\nMean normalized scores (0-100):")
        print(header)
        for service in services:
            line = f"{service:<12}"
            for benchmark in benchmarks:
                values = cells.get((service, benchmark))
                line += f"{'—' if not values else f'{sum(values) / len(values):.2f} (n={len(values)})':>26}"
            print(line)

    null_scores = [r for r in rows if r["normalized_score"] is None]
    if null_scores:
        print(f"\nRows with null normalized_score ({len(null_scores)}):")
        for r in null_scores:
            print(f"  {r['date']}/{r['test_id']} {r['service']}/{r['model']} {r['benchmark']}")

    if skipped:
        print(f"\nSkipped runs ({len(skipped)}):")
        for path, reason in skipped:
            print(f"  {path}: {reason}")

    if warned_combos:
        print(f"\nMissing capabilities entries ({len(warned_combos)}; vision=null, stale-file signal):")
        for service, model in sorted(warned_combos):
            print(f"  {service}/{model}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--results-dir", type=Path, default=DEFAULT_RESULTS_DIR)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--capabilities", type=Path, default=DEFAULT_CAPABILITIES)
    parser.add_argument("--rise-root", type=Path, default=DEFAULT_RISE_ROOT,
                        help="RISE checkout for meta.json ranking configs + benchmarks_tests.csv fallback")
    parser.add_argument("--date", default=None, help="only collect runs under this YYYY-MM-DD")
    parser.add_argument("--test-id", default=None, help="only collect this run id (e.g. T1740/U0001)")
    args = parser.parse_args()

    ranking_configs = load_ranking_configs(args.rise_root)
    csv_mapping = load_test_csv_mapping(args.rise_root)
    capabilities = load_capabilities(args.capabilities)

    rows, skipped, warned_combos = collect(
        args.results_dir, capabilities, csv_mapping, ranking_configs,
        date_filter=args.date, test_id_filter=args.test_id,
    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    print_summary(rows, skipped, warned_combos, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
