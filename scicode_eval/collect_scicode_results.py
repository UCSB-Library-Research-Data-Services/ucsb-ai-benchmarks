#!/usr/bin/env python3
"""Collect SciCode inspect_ai `.eval` logs into a JSONL results file.

One row per successful run. Idempotent: the output file is rewritten
wholly on each invocation.

Runs under the repo-root venv (needs only `inspect_ai`):

    uv run python scicode_eval/collect_scicode_results.py \
        --log-dir logs/scicode \
        --out /tmp/scicode_check.jsonl

By default (`--log-dir` omitted) all non-smoke `*.eval` under `logs/scicode` are
collected recursively (per-date subdirs like `logs/scicode/2026-09-14-fresh` plus
legacy flat logs; anything under `_smoke` is excluded). Pass `--log-dir`
to collect one directory instead (e.g. `logs/scicode/_smoke` for smoke checks).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

from inspect_ai.log import read_eval_log

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
DEFAULT_LOG_DIR = REPO_ROOT / "logs" / "scicode"
DEFAULT_OUT = REPO_ROOT / "data" / "scicode_results.jsonl"

sys.path.insert(0, str(REPO_ROOT))
from config import SERVICES  # noqa: E402  (single source of truth for services)

SKIP_MODES = {"dummy", "gold"}
KNOWN_SERVICES = {name.upper() for name in SERVICES}


def derive_service_model(model_str: str, output_dir: str) -> tuple[str, str]:
    """Derive (service, model) from the eval model string.

    New runs use `openai-api/<service>/<model>`; older logs used
    `openai/<model>`, for which we fall back to matching `output_dir`
    tokens against the service names in config.py (`DL` maps to DREAMLAB).
    """
    parts = (model_str or "").split("/")
    model = parts[-1] if parts else (model_str or "UNKNOWN")
    if len(parts) >= 3:
        return parts[1].upper(), model
    for tok in re.split(r"[/_\\]+", output_dir or ""):
        u = tok.upper()
        if u in KNOWN_SERVICES:
            return u, model
        if u == "DL":
            return "DREAMLAB", model
    return "UNKNOWN", model


def _parse_ts(value: object) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value))
    except (ValueError, TypeError):
        return None


def collect_log(path: Path) -> tuple[dict | None, str]:
    """Collect one `.eval` file. Returns (row, skip_reason); row is None if skipped."""
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

    model_str = log.eval.model
    output_dir = str(task_args.get("output_dir", ""))
    service, model = derive_service_model(model_str, output_dir)

    run_usage = model_usage_all.get(model_str)
    if run_usage is None and len(model_usage_all) == 1:
        run_usage = next(iter(model_usage_all.values()))

    problems: list[dict] = []
    steps_passed = 0
    steps_total = 0
    problems_correct = 0
    for sample in log.samples or []:
        score = (sample.scores or {}).get("scicode_scorer")
        if score is None or not isinstance(score.value, dict):
            continue
        value = score.value
        pc = int(value.get("Problem Correctness", 0))
        tc = int(value.get("Total Correct", 0))
        ts = int(value.get("Total Steps", 0))
        problems_correct += pc
        steps_passed += tc
        steps_total += ts

        out_tok = 0
        in_tok = 0
        rea_tok: int | None = 0
        time_sec = 0.0
        for event in sample.events or []:
            if getattr(event, "event", None) != "model":
                continue
            if getattr(event, "error", None) is not None:
                continue  # failed/retried attempt; the retry is logged separately
            usage = getattr(getattr(event, "output", None), "usage", None)
            if usage is None:
                continue
            out_tok += usage.output_tokens or 0
            in_tok += usage.input_tokens or 0
            if usage.reasoning_tokens is None:
                rea_tok = None
            elif rea_tok is not None:
                rea_tok += usage.reasoning_tokens
            wt = getattr(event, "working_time", None)
            time_sec += wt or 0.0

        problems.append(
            {
                "problem_id": str(sample.id),
                "problem_correct": pc,
                "total_correct": tc,
                "total_steps": ts,
                "output_tokens": out_tok,
                "reasoning_tokens": rea_tok,
                "model_time_sec": round(time_sec, 3),
            }
        )

    if not problems:
        return None, "no-scored-samples"

    num_problems = len(problems)
    main_resolve_rate = problems_correct / num_problems
    sub_step_accuracy = (steps_passed / steps_total) if steps_total else 0.0

    per_task_out = [p["output_tokens"] for p in problems]
    per_task_rea = [p["reasoning_tokens"] for p in problems if p["reasoning_tokens"] is not None]
    per_task_ans = [
        p["output_tokens"] - (p["reasoning_tokens"] or 0) for p in problems
    ]
    per_task_min = [p["model_time_sec"] / 60.0 for p in problems]

    started_at = log.stats.started_at if log.stats else None
    completed_at = log.stats.completed_at if log.stats else None
    wall_time_sec: float | None = None
    start_dt, end_dt = _parse_ts(started_at), _parse_ts(completed_at)
    if start_dt is not None and end_dt is not None:
        wall_time_sec = round((end_dt - start_dt).total_seconds(), 1)

    row = {
        "service": service,
        "model": model,
        "log_file": path.name,
        "split": task_args.get("split"),
        "with_background": task_args.get("with_background"),
        "mode": mode,
        "timestamp": log.eval.created,
        "started_at": started_at,
        "completed_at": completed_at,
        "wall_time_sec": wall_time_sec,
        "num_problems": num_problems,
        "main_resolve_rate": round(main_resolve_rate, 6),
        "sub_step_accuracy": round(sub_step_accuracy, 6),
        "steps_passed": steps_passed,
        "steps_total": steps_total,
        "total_input_tokens": run_usage.input_tokens if run_usage else None,
        "total_output_tokens": run_usage.output_tokens if run_usage else None,
        "total_reasoning_tokens": run_usage.reasoning_tokens if run_usage else None,
        "avg_output_tokens_per_task": round(sum(per_task_out) / num_problems, 1),
        "avg_reasoning_tokens_per_task": (
            round(sum(per_task_rea) / len(per_task_rea), 1) if per_task_rea else None
        ),
        "avg_answer_tokens_per_task": round(sum(per_task_ans) / num_problems, 1),
        "avg_model_time_min_per_task": round(sum(per_task_min) / num_problems, 3),
        "problems": problems,
    }
    return row, ""


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect SciCode .eval logs to JSONL.")
    parser.add_argument(
        "--log-dir",
        type=Path,
        default=None,
        help="Collect only this directory (default: whole logs/ tree, recursive).",
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    if args.log_dir is None:
        log_files = sorted(
            p
            for p in DEFAULT_LOG_DIR.rglob("*.eval")
            if p.is_file() and "_smoke" not in p.parts
        )
    else:
        log_files = sorted(args.log_dir.glob("*.eval"))
    rows: list[dict] = []
    skips: Counter[str] = Counter()
    for path in log_files:
        try:
            row, reason = collect_log(path)
        except Exception as exc:  # keep going; report at the end
            skips[f"read-error: {type(exc).__name__}"] += 1
            continue
        if row is None:
            skips[reason] += 1
        else:
            rows.append(row)

    rows.sort(key=lambda r: (r["service"], r["model"], r["timestamp"], r["log_file"]))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")

    print(f"scanned={len(log_files)} kept={len(rows)} -> {args.out}")
    if skips:
        print("skipped: " + ", ".join(f"{k} x{v}" for k, v in sorted(skips.items())))
    print(f"{'SERVICE':<10}{'MODEL':<30}{'SPLIT':<12}{'N':>3} {'RESOLVE':>7} {'SUBSTEP':>7} {'OUT/TASK':>8} {'MIN/TASK':>8}")
    for r in rows:
        rea = r["avg_reasoning_tokens_per_task"]
        print(
            f"{r['service']:<10}{r['model']:<30}{str(r['split']):<12}{r['num_problems']:>3} "
            f"{r['main_resolve_rate']:>7.1%} {r['sub_step_accuracy']:>7.1%} "
            f"{r['avg_output_tokens_per_task']:>8.0f} {r['avg_model_time_min_per_task']:>8.2f}"
            + ("" if rea is None else f" (rea {rea:.0f})")
            + f"  {r['log_file']}"
        )


if __name__ == "__main__":
    main()
