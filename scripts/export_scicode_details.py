#!/usr/bin/env python3
"""Export per-run SciCode detail shards for the dashboard drill-down panels.

Walks ``logs/scicode/**.eval`` (excluding ``_smoke``), uses
``inspect_ai.log.read_eval_log`` with the same skip rules as
``collect_scicode_results.py`` (``status=success``, mode not in
``{dummy, gold}``, has model usage), and writes one distilled JSON per run:

    data/details/scicode/<log_file_stem>.json

Each shard holds run metadata plus per-problem entries with per-step model
completions (from ``sample.events`` model events, skipping events with
``error``), truncated to 8000 chars. Idempotent: the tree is rewritten
wholly each run and stale shards are deleted.

Runs under the repo-root venv (needs only ``inspect_ai``)::

    uv run python scripts/export_scicode_details.py
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from inspect_ai.log import read_eval_log

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
DEFAULT_LOG_DIR = REPO_ROOT / "logs" / "scicode"
DEFAULT_OUT_DIR = REPO_ROOT / "data" / "details" / "scicode"

sys.path.insert(0, str(REPO_ROOT / "scicode_eval"))
from collect_scicode_results import (  # noqa: E402
    SKIP_MODES,
    derive_service_model,
)

DETAIL_TRUNCATE = 8000


def truncate(value, limit=DETAIL_TRUNCATE):
    if isinstance(value, str) and len(value) > limit:
        return value[:limit] + "… [truncated]"
    return value


def step_completions(sample):
    """Per-step model completions in event order (skips errored attempts)."""
    steps = []
    for event in sample.events or []:
        if getattr(event, "event", None) != "model":
            continue
        if getattr(event, "error", None) is not None:
            continue
        output = getattr(event, "output", None)
        completion = getattr(output, "completion", None) if output is not None else None
        if completion is None:
            continue
        if not isinstance(completion, str):
            completion = json.dumps(completion, ensure_ascii=False, default=str)
        usage = getattr(output, "usage", None)
        steps.append({
            "index": len(steps),
            "completion": truncate(completion),
            "output_tokens": getattr(usage, "output_tokens", None),
            "reasoning_tokens": getattr(usage, "reasoning_tokens", None),
            "working_time_sec": getattr(event, "working_time", None),
        })
    return steps


def export_log(path):
    """Build the detail shard for one `.eval` file, or (None, skip_reason)."""
    log = read_eval_log(str(path))

    if log.status != "success":
        return None, f"status={log.status}"
    task_args = log.eval.task_args or {}
    mode = task_args.get("mode", "normal")
    if mode in SKIP_MODES:
        return None, f"mode={mode}"
    model_usage_all = log.stats.model_usage if log.stats is not None else None
    if not model_usage_all:
        return None, "no-model-usage"

    service, model = derive_service_model(
        log.eval.model, str(task_args.get("output_dir", "")))

    problems = []
    for sample in log.samples or []:
        score = (sample.scores or {}).get("scicode_scorer")
        if score is None or not isinstance(score.value, dict):
            continue
        value = score.value
        out_tok = 0
        in_tok = 0
        rea_tok = 0
        rea_known = True
        time_sec = 0.0
        for event in sample.events or []:
            if getattr(event, "event", None) != "model":
                continue
            if getattr(event, "error", None) is not None:
                continue
            usage = getattr(getattr(event, "output", None), "usage", None)
            if usage is None:
                continue
            out_tok += usage.output_tokens or 0
            in_tok += usage.input_tokens or 0
            if usage.reasoning_tokens is None:
                rea_known = False
            elif rea_tok is not None:
                rea_tok += usage.reasoning_tokens
            time_sec += getattr(event, "working_time", None) or 0.0
        problems.append({
            "problem_id": str(sample.id),
            "problem_correct": int(value.get("Problem Correctness", 0)),
            "total_correct": int(value.get("Total Correct", 0)),
            "total_steps": int(value.get("Total Steps", 0)),
            "input_tokens": in_tok,
            "output_tokens": out_tok,
            "reasoning_tokens": (rea_tok if rea_known else None),
            "model_time_sec": round(time_sec, 3),
            "steps": step_completions(sample),
        })

    if not problems:
        return None, "no-scored-samples"

    shard = {
        "log_file": path.name,
        "service": service,
        "model": model,
        "split": task_args.get("split"),
        "with_background": task_args.get("with_background"),
        "mode": mode,
        "timestamp": log.eval.created,
        "started_at": log.stats.started_at if log.stats else None,
        "completed_at": log.stats.completed_at if log.stats else None,
        "problems": problems,
    }
    return shard, ""


def find_log_files(log_dir, recursive):
    if recursive:
        files = sorted(
            p for p in log_dir.rglob("*.eval")
            if p.is_file() and "_smoke" not in p.parts
        )
    else:
        files = sorted(log_dir.glob("*.eval"))
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--log-dir", type=Path, default=DEFAULT_LOG_DIR)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--flat", action="store_true",
                        help="collect only --log-dir itself (default: recursive walk)")
    parser.add_argument("--no-prune", action="store_true",
                        help="keep stale shards instead of deleting them")
    args = parser.parse_args()

    log_files = find_log_files(args.log_dir, recursive=not args.flat)
    written = []
    skips: Counter[str] = Counter()
    for path in log_files:
        try:
            shard, reason = export_log(path)
        except Exception as exc:  # keep going; report at the end
            skips[f"read-error: {type(exc).__name__}"] += 1
            continue
        if shard is None:
            skips[reason] += 1
            continue
        shard_path = args.out_dir / (path.stem + ".json")
        shard_path.parent.mkdir(parents=True, exist_ok=True)
        with shard_path.open("w", encoding="utf-8") as f:
            json.dump(shard, f, ensure_ascii=False)
        written.append(shard_path.resolve())

    if not args.no_prune and args.out_dir.is_dir():
        for existing in sorted(args.out_dir.rglob("*.json")):
            if existing.resolve() not in set(written):
                existing.unlink()

    print(f"scanned={len(log_files)} wrote={len(written)} -> {args.out_dir}")
    if skips:
        print("skipped: " + ", ".join(f"{k} x{v}" for k, v in sorted(skips.items())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
