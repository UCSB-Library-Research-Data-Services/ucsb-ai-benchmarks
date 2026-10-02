#!/usr/bin/env python3
"""Collect lm-evaluation-harness JSON outputs into a JSONL results file.

One row per (service, model) run.  Idempotent: the output file is rewritten
wholly on each invocation.

    uv run python lmeval_eval/collect_lmeval_results.py
    uv run python lmeval_eval/collect_lmeval_results.py \
        --log-dir logs/lmeval/_smoke --out /tmp/lmeval_check.jsonl
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
DEFAULT_LOG_DIR = REPO_ROOT / "logs" / "lmeval"
DEFAULT_OUT = REPO_ROOT / "data" / "lmeval_results.jsonl"

# Canonical task list and their primary metric names
TASK_METRICS: dict[str, str] = {
    "mmlu": "acc",
    "gsm8k": "exact_match",
    "arc_challenge": "acc_norm",
    "hellaswag": "acc_norm",
    "winogrande": "acc",
    "truthfulqa_mc2": "acc",  # lm-eval reports mc2 under "acc" for truthfulqa_mc2
}

# Few-shot counts per task (for documentation/output)
TASK_FEWSHOT: dict[str, int] = {
    "mmlu": 5,
    "gsm8k": 5,
    "arc_challenge": 25,
    "hellaswag": 10,
    "winogrande": 5,
    "truthfulqa_mc2": 6,
}


def find_results_files(log_dir: Path, exclude_smoke: bool = True) -> list[Path]:
    """Walk log_dir for lm-eval results JSON files."""
    results_files = []
    for p in log_dir.rglob("results*.json"):
        if not p.is_file():
            continue
        if exclude_smoke and "_smoke" in p.parts:
            continue
        results_files.append(p)
    return sorted(results_files)


def derive_service_model(result_path: Path, log_dir: Path) -> tuple[str, str]:
    """Derive (service, model) from directory structure.

    Expected: logs/lmeval/<date>/<SVC>/<model>/results*.json
    """
    try:
        rel = result_path.relative_to(log_dir)
    except ValueError:
        rel = result_path
    parts = rel.parts
    # Walk backwards to find SVC/model from the directory above the JSON
    # Structure: <date>/<SVC>/<model>/results.json  OR  <SVC>/<model>/results.json
    parent_parts = parts[:-1]  # remove filename
    if len(parent_parts) >= 2:
        # Last two dirs are SVC/model
        service = parent_parts[-2].upper()
        model = parent_parts[-1]
        return service, model
    if len(parent_parts) == 1:
        return "UNKNOWN", parent_parts[0]
    return "UNKNOWN", "UNKNOWN"


def parse_results_file(path: Path) -> dict | None:
    """Parse one lm-eval results JSON file."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        print(f"warning: cannot read {path}: {e}", file=sys.stderr)
        return None

    results = data.get("results", {})
    if not results:
        return None
    return data


def extract_task_scores(data: dict) -> dict[str, dict]:
    """Extract per-task metrics from lm-eval results JSON."""
    results = data.get("results", {})
    n_samples = data.get("n-samples", {})
    configs = data.get("configs", {})
    task_scores: dict[str, dict] = {}

    for task_name, primary_metric in TASK_METRICS.items():
        # lm-eval may nest tasks: check direct key or iterate
        task_data = None
        for key in results:
            if key == task_name or key.startswith(task_name):
                task_data = results[key]
                break

        if task_data is None:
            continue

        # Extract the primary metric; lm-eval uses keys like "acc,none" or "exact_match,none"
        score = None
        stderr = None
        for metric_key, value in task_data.items():
            base_metric = metric_key.split(",")[0]
            if base_metric == primary_metric:
                if "stderr" in metric_key:
                    stderr = value
                else:
                    score = value

        if score is None:
            continue

        # Get sample count
        samples = None
        for key in n_samples:
            if key == task_name or key.startswith(task_name):
                task_n = n_samples[key]
                if isinstance(task_n, dict):
                    samples = task_n.get("effective", task_n.get("original"))
                elif isinstance(task_n, (int, float)):
                    samples = int(task_n)
                break

        # Get num_fewshot from configs or use default
        num_fewshot = TASK_FEWSHOT.get(task_name)
        for key in configs or {}:
            if key == task_name or key.startswith(task_name):
                cfg = configs[key]
                if isinstance(cfg, dict) and "num_fewshot" in cfg:
                    num_fewshot = cfg["num_fewshot"]
                break

        entry: dict = {primary_metric: round(score, 6)}
        if stderr is not None:
            entry[f"{primary_metric}_stderr"] = round(stderr, 6)
        if num_fewshot is not None:
            entry["num_fewshot"] = num_fewshot
        if samples is not None:
            entry["samples"] = samples

        task_scores[task_name] = entry

    return task_scores


def compute_composite(task_scores: dict[str, dict]) -> float | None:
    """Simple average of primary metrics across all tasks."""
    values = []
    for task_name, metrics in task_scores.items():
        primary = TASK_METRICS.get(task_name)
        if primary and primary in metrics:
            values.append(metrics[primary])
    if not values:
        return None
    return round(sum(values) / len(values), 6)


def collect_one(result_path: Path, log_dir: Path) -> tuple[dict | None, str]:
    """Collect one results JSON file. Returns (row, skip_reason)."""
    data = parse_results_file(result_path)
    if data is None:
        return None, "unreadable"

    service, model = derive_service_model(result_path, log_dir)
    task_scores = extract_task_scores(data)

    if not task_scores:
        return None, "no-task-scores"

    composite = compute_composite(task_scores)

    # Extract timing/token info if available
    total_tokens = None
    wall_time_sec = None
    # lm-eval may include runtime info in the top-level data
    # lm-eval reports `total_evaluation_time_seconds` as a string (e.g. "0.03").
    if "total_evaluation_time_seconds" in data:
        try:
            wall_time_sec = round(float(data["total_evaluation_time_seconds"]), 1)
        except (TypeError, ValueError):
            wall_time_sec = None

    # Derive timestamp from file modification time or directory date
    timestamp = datetime.fromtimestamp(
        result_path.stat().st_mtime, tz=timezone.utc
    ).isoformat(timespec="seconds")

    # Try to get timestamp from the date directory
    try:
        rel = result_path.relative_to(log_dir)
        date_part = rel.parts[0] if rel.parts else None
        if date_part and re.match(r"\d{4}-\d{2}-\d{2}", date_part):
            # Use the directory date as a base timestamp
            pass  # keep file mtime which is more accurate
    except ValueError:
        pass

    row = {
        "service": service,
        "model": model,
        "timestamp": timestamp,
        "tasks": task_scores,
        "composite_score": composite,
        "total_tokens": total_tokens,
        "wall_time_sec": wall_time_sec,
        "log_dir": str(result_path.parent.relative_to(REPO_ROOT))
        if result_path.is_relative_to(REPO_ROOT)
        else str(result_path.parent),
    }

    return row, ""


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Collect lm-eval JSON results to JSONL."
    )
    parser.add_argument(
        "--log-dir",
        type=Path,
        default=None,
        help="Collect only this directory (default: whole logs/lmeval/ tree, recursive).",
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    if args.log_dir is None:
        log_dir = DEFAULT_LOG_DIR
        result_files = find_results_files(log_dir, exclude_smoke=True)
    else:
        log_dir = args.log_dir
        result_files = find_results_files(log_dir, exclude_smoke=False)

    rows: list[dict] = []
    skips: Counter[str] = Counter()

    for path in result_files:
        try:
            row, reason = collect_one(path, log_dir)
        except Exception as exc:
            skips[f"read-error: {type(exc).__name__}"] += 1
            continue
        if row is None:
            skips[reason] += 1
        else:
            rows.append(row)

    rows.sort(key=lambda r: (r["service"], r["model"], r["timestamp"]))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")

    print(f"scanned={len(result_files)} kept={len(rows)} -> {args.out}")
    if skips:
        print(
            "skipped: "
            + ", ".join(f"{k} x{v}" for k, v in sorted(skips.items()))
        )

    # Summary table
    print(
        f"{'SERVICE':<12}{'MODEL':<30}{'COMPOSITE':>10}"
        f"{'MMLU':>8}{'GSM8K':>8}{'ARC-C':>8}"
        f"{'HELLA':>8}{'WINO':>8}{'TQAMC2':>8}"
    )
    for r in rows:
        t = r["tasks"]
        mmlu = t.get("mmlu", {}).get("acc", "")
        gsm8k = t.get("gsm8k", {}).get("exact_match", "")
        arc = t.get("arc_challenge", {}).get("acc_norm", "")
        hella = t.get("hellaswag", {}).get("acc_norm", "")
        wino = t.get("winogrande", {}).get("acc", "")
        tqa = t.get("truthfulqa_mc2", {}).get("acc", "")
        comp = r.get("composite_score", "")

        def fmt(v: object) -> str:
            if isinstance(v, (int, float)):
                return f"{v:.3f}"
            return str(v) if v else "—"

        print(
            f"{r['service']:<12}{r['model']:<30}{fmt(comp):>10}"
            f"{fmt(mmlu):>8}{fmt(gsm8k):>8}{fmt(arc):>8}"
            f"{fmt(hella):>8}{fmt(wino):>8}{fmt(tqa):>8}"
        )


if __name__ == "__main__":
    main()
