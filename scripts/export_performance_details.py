#!/usr/bin/env python3
"""Export per-model performance detail shards for the dashboard drill-down panels.

Reads ``data/performance_results.jsonl`` (the same file the dashboard
aggregates) and writes one distilled JSON per service|model:

    data/details/performance/<service>__<slugified-model>.json

Each shard holds run metadata plus every individual run (metrics +
``model_output`` truncated to 8000 chars). Like the other exporters this is
stdlib-only and idempotent: the tree is rewritten wholly each run and stale
shards are deleted.

The panel filters runs by category client-side, so one shard serves the
Overall cell and every category cell for that model.

Usage:
    uv run python scripts/export_performance_details.py
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
DEFAULT_IN = REPO_ROOT / "data" / "performance_results.jsonl"
DEFAULT_OUT_DIR = REPO_ROOT / "data" / "details" / "performance"

DETAIL_TRUNCATE = 8000
SKIP_SERVICES = {"dreamlab"}  # mirrors the dashboard's dreamlab filter


def slug_model(model):
    slug = re.sub(r"[^A-Za-z0-9._-]+", "_", model or "UNKNOWN")
    return slug or "UNKNOWN"


def detail_key(service, model):
    return f"{service}__{slug_model(model)}"


def truncate(value, limit=DETAIL_TRUNCATE):
    if isinstance(value, str) and len(value) > limit:
        return value[:limit] + "… [truncated]"
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--in", dest="inp", type=Path, default=DEFAULT_IN,
                        help="performance_results.jsonl to distill")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--no-prune", action="store_true",
                        help="keep stale shards instead of deleting them")
    args = parser.parse_args()

    groups: dict[tuple[str, str], list[dict]] = {}
    skipped: Counter[str] = Counter()
    try:
        with args.inp.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    skipped["bad-json"] += 1
                    continue
                service = row.get("service") or "UNKNOWN"
                model = row.get("model") or "UNKNOWN"
                if service.lower() in SKIP_SERVICES:
                    skipped["dreamlab"] += 1
                    continue
                groups.setdefault((service, model), []).append(row)
    except OSError as e:
        print(f"ERROR: cannot read {args.inp}: {e}", file=sys.stderr)
        return 1

    written = []
    for (service, model), runs in sorted(groups.items()):
        runs.sort(key=lambda r: str(r.get("timestamp") or ""))
        shard = {
            "service": service,
            "model": model,
            "detailKey": detail_key(service, model),
            "runCount": len(runs),
            "latestTimestamp": runs[-1].get("timestamp") if runs else None,
            "categories": sorted({r.get("category") for r in runs if r.get("category")}),
            "runs": [
                {
                    "test_id": r.get("test_id"),
                    "category": r.get("category"),
                    "timestamp": r.get("timestamp"),
                    "total_time_sec": r.get("total_time_sec"),
                    "ttft_sec": r.get("ttft_sec"),
                    "itl_ms_per_token": r.get("itl_ms_per_token"),
                    "generation_tps": r.get("generation_tps"),
                    "total_tps": r.get("total_tps"),
                    "prompt_tokens": r.get("prompt_tokens"),
                    "completion_tokens": r.get("completion_tokens"),
                    "total_tokens": r.get("total_tokens"),
                    "output_type": r.get("output_type"),
                    "status": r.get("status"),
                    "model_output": truncate(r.get("model_output")),
                }
                for r in runs
            ],
        }
        shard_path = args.out_dir / (detail_key(service, model) + ".json")
        shard_path.parent.mkdir(parents=True, exist_ok=True)
        with shard_path.open("w", encoding="utf-8") as f:
            json.dump(shard, f, ensure_ascii=False)
        written.append(shard_path.resolve())

    if not args.no_prune and args.out_dir.is_dir():
        keep = set(written)
        for existing in sorted(args.out_dir.rglob("*.json")):
            if existing.resolve() not in keep:
                existing.unlink()

    print(f"models={len(groups)} wrote={len(written)} -> {args.out_dir}")
    if skipped:
        print("skipped: " + ", ".join(f"{k} x{v}" for k, v in sorted(skipped.items())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
