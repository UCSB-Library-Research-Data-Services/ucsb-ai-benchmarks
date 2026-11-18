#!/usr/bin/env python3
"""Export DREAMLAB baseline reference values to data/baselines.json.

Keeps only services with role == "baseline" in config.py and only the models
listed in their roster. Service names match case-insensitively. Aggregation
mirrors the dashboard leaderboards:

  performance: mean over all runs, per category plus "overall"
  rise:        latest run per benchmark, mean normalized score plus "avg"
  scicode:     latest run per split, resolve and sub-step rates (0-100)

Output shape:

  {"generated_at", "tiers": {model: {"service", "runs", "latest", "values"}}}

values[suite][metric][key] = number; key is a category, benchmark, split, or
"overall"/"avg". Idempotent: the file is rewritten wholesale each run.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(REPO_ROOT))

import config  # noqa: E402

DATA_DIR = REPO_ROOT / "data"
OUT_PATH = DATA_DIR / "baselines.json"

PERF_METRICS = ("ttft_sec", "itl_ms_per_token", "generation_tps", "total_tps")


def baseline_tiers(services=None):
    """{(service_lower, model_lower): (service, model)} for baseline roster entries."""
    services = config.SERVICES if services is None else services
    tiers = {}
    for svc, info in services.items():
        if info.get("role") != config.BASELINE_ROLE:
            continue
        for model in info.get("models") or []:
            tiers[(svc.lower(), model)] = (svc, model)
    return tiers


def read_jsonl(path):
    rows = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    continue
    except OSError:
        pass
    return rows


def _key(row, tiers):
    service = str(row.get("service") or "").lower()
    model = row.get("model")
    return tiers.get((service, model)) if model else None


def _mean(values):
    return sum(values) / len(values) if values else None


def build_baselines(perf_rows, rise_rows, scicode_rows, tiers):
    """Pure aggregation. Returns {model: tier_entry} for tiers present in data."""
    perf = defaultdict(lambda: defaultdict(list))
    perf_runs = defaultdict(int)
    perf_latest = {}
    for row in perf_rows:
        hit = _key(row, tiers)
        if not hit:
            continue
        model = hit[1]
        perf_runs[model] += 1
        ts = str(row.get("timestamp") or "")
        perf_latest[model] = max(perf_latest.get(model, ""), ts)
        for metric in PERF_METRICS:
            value = row.get(metric)
            if isinstance(value, (int, float)):
                perf[model][(metric, "overall")].append(value)
                perf[model][(metric, str(row.get("category")))].append(value)

    rise_best = {}
    for row in rise_rows:
        hit = _key(row, tiers)
        score = row.get("normalized_score")
        if not hit or not isinstance(score, (int, float)):
            continue
        k = (hit[1], row.get("benchmark"))
        stamp = (str(row.get("date") or ""), str(row.get("test_id") or ""))
        if k not in rise_best or stamp > rise_best[k][0]:
            rise_best[k] = (stamp, float(score), hit)

    rise = defaultdict(dict)
    rise_runs = defaultdict(int)
    rise_latest = {}
    for (model, bench), (stamp, score, _hit) in rise_best.items():
        rise[model][bench] = score
        rise_runs[model] += 1
        rise_latest[model] = max(rise_latest.get(model, ""), stamp[0])
    for model, benches in rise.items():
        avg = _mean(list(benches.values()))
        if avg is not None:
            benches["avg"] = avg

    sci_best = {}
    for row in scicode_rows:
        hit = _key(row, tiers)
        if not hit:
            continue
        k = (hit[1], row.get("split"))
        stamp = str(row.get("timestamp") or "")
        if k not in sci_best or stamp > sci_best[k][0]:
            sci_best[k] = (stamp, row, hit)

    sci = defaultdict(lambda: defaultdict(dict))
    sci_runs = defaultdict(int)
    sci_latest = {}
    for (model, split), (stamp, row, _hit) in sci_best.items():
        resolve = row.get("main_resolve_rate")
        substep = row.get("sub_step_accuracy")
        if isinstance(resolve, (int, float)):
            sci[model]["resolve"][str(split)] = resolve * 100
        if isinstance(substep, (int, float)):
            sci[model]["substep"][str(split)] = substep * 100
        sci_runs[model] += 1
        sci_latest[model] = max(sci_latest.get(model, ""), stamp)

    models = {hit[1]: hit[0] for hit in tiers.values()}
    out = {}
    for model, service in models.items():
        values = {}
        if perf.get(model):
            values["performance"] = defaultdict(dict)
            for (metric, key), nums in perf[model].items():
                values["performance"][metric][key] = _mean(nums)
            values["performance"] = {m: dict(v) for m, v in values["performance"].items()}
        if rise.get(model):
            values["rise"] = {"score": dict(rise[model])}
        if sci.get(model):
            values["scicode"] = {m: dict(v) for m, v in sci[model].items()}
        if not values:
            continue
        out[model] = {
            "service": service,
            "runs": {
                "performance": perf_runs.get(model, 0),
                "rise": rise_runs.get(model, 0),
                "scicode": sci_runs.get(model, 0),
            },
            "latest": {
                "performance": perf_latest.get(model) or None,
                "rise": rise_latest.get(model) or None,
                "scicode": sci_latest.get(model) or None,
            },
            "values": values,
        }
    return out


def export(out_path=OUT_PATH, data_dir=DATA_DIR):
    tiers = baseline_tiers()
    if not tiers:
        print("[!] no baseline services in config.py")
    result = build_baselines(
        read_jsonl(data_dir / "performance_results.jsonl"),
        read_jsonl(data_dir / "rise_results.jsonl"),
        read_jsonl(data_dir / "scicode_results.jsonl"),
        tiers,
    )
    for (svc, model) in sorted(baseline_tiers().values()):
        if model not in result:
            print("[!] no baseline data yet for %s/%s" % (svc, model))
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "tiers": {m: result[m] for m in sorted(result)},
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("wrote %d baseline tier(s) -> %s" % (len(result), out_path))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=OUT_PATH)
    args = parser.parse_args()
    return export(args.out)


if __name__ == "__main__":
    sys.exit(main())
