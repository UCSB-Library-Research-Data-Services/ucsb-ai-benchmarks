#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = [
#   "generic-llm-api-client~=0.4.6",
#   "pillow~=11.1.0",
#   "rapidfuzz~=3.12.1",
#   "Levenshtein~=0.25.1",
#   "python-dotenv~=1.0.1",
# ]
# ///
"""Run RISE pilot benchmarks for the 37 UCSB models (CIT 8 + GRIT 11 + AICommons 18, excluding
dreamlab), gated by data/model_capabilities.json vision flags, storing raw results under
repo-root rise_eval/results/ (never inside the RISE/ submodule).

All runs use provider="openai" (passes RISE's is_runnable allowlist) with the per-service
gateway URL passed as rules.base_url — the same pattern as upstream's alibaba+base_url CSV
rows. Model names pass through verbatim; per-service API keys come from root config.py
(which loads root .env). Keys are never printed.

Results land in rise_eval/results/<YYYY-MM-DD>/<U####>/ (request_*.json + scoring.json +
run_meta.json). U-namespace IDs never collide with upstream T#### runs. Resume semantics
match upstream: existing request files are skipped unless --regenerate is passed.

max_tokens is clamped per model from data/model_limits.json (gateway-verified limits
observed via HTTP 400) by injecting rules.max_tokens, which benchmark_base honors in
place of its 32768 default. Models without an entry keep the upstream default.

The dependency header pins Python <3.13 (Levenshtein 0.25.1 has no newer wheels) and isolates
generic-llm-api-client's openai<2.27 pin from the project's openai>=2.53 — uv resolves the
script env into its own cache, so the project .venv stays untouched:

  uv run rise_eval/run_rise_ucsb.py --dry-run
  uv run rise_eval/run_rise_ucsb.py --service CIT --model gemma-4-31b --benchmark book_advert_xml --limit-objects 2
  uv run rise_eval/run_rise_ucsb.py                     # full pilot batch (resume-safe)
  uv run rise_eval/collect_rise_results.py              # then collect (separate script, project .venv)
"""
import argparse
import importlib.util
import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
RISE_ROOT = REPO_ROOT / "RISE"
RESULTS_DIR = REPO_ROOT / "rise_eval" / "results"
DEFAULT_CAPABILITIES = REPO_ROOT / "data" / "model_capabilities.json"
DEFAULT_MODEL_LIMITS = REPO_ROOT / "data" / "model_limits.json"

sys.path.insert(0, str(RISE_ROOT))
sys.path.insert(0, str(RISE_ROOT / "scripts"))
sys.path.insert(0, str(REPO_ROOT))

# RISE imports resolve only after sys.path setup above.
from scripts.benchmark_base import Benchmark, DefaultBenchmark, FatalProviderError  # noqa: E402

logger = logging.getLogger("run_rise_ucsb")

# Pilot subset (user decision; verified against non-legacy openai CSV rows T0446/T0007/T0079
# and each benchmark's meta.json ranking config at implementation time).
PILOT_BENCHMARKS = [
    {
        "name": "book_advert_xml",
        "dataclass": "CorrectedAdvert",
        "temperature": "0.0",
        "role_description": "You are a historian with expertise in XML and structured data",
        "prompt_file": "prompt.txt",
        "requires_vision": False,
        "ranking": "fuzzy desc",
    },
    {
        "name": "bibliographic_data",
        "dataclass": "Document",
        "temperature": "0.0",
        "role_description": "You are a Historian",
        "prompt_file": "prompt.txt",
        "requires_vision": True,
        "ranking": "fuzzy desc",
    },
    {
        "name": "fraktur_adverts",
        "dataclass": "Document",
        "temperature": "0.0",
        "role_description": "You are a historian with keyword knowledge",
        "prompt_file": "prompt_optimized.txt",
        "requires_vision": True,
        "ranking": "cer asc",
    },
]


def load_vision_gates(path):
    """(service_lower, model) -> tools.vision from the capabilities file."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    gates = {}
    for entry in data.get("models", []):
        model = entry.get("model")
        if model:
            gates[((entry.get("service") or "").lower(), model)] = (entry.get("tools") or {}).get("vision")
    return gates


def load_model_limits(path):
    """model -> max_output_tokens from the curated limits file ({} when unreadable)."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        logger.warning("Could not load model limits from %s: %s", path, e)
        return {}
    limits = {}
    for model, entry in (data.get("models") or {}).items():
        cap = (entry or {}).get("max_output_tokens") if isinstance(entry, dict) else None
        if isinstance(cap, int) and cap > 0:
            limits[model] = cap
    return limits


def build_combos(services, gates, force):
    """Planned and skipped combos over the full (unfiltered) model manifest.

    Gate rules (fail closed):
      - capabilities entry missing or vision is null  -> skip ALL benchmarks (unknown-model);
        a model added to config.py without a capabilities entry never runs silently.
      - vision is false                               -> text-only book_advert_xml only (no-vision).
      - vision is true                                -> full pilot.
    --force turns gate failures into planned-with-warning for the combos it is applied to.
    U-namespace IDs are assigned over this unfiltered surviving set so filtered runs reuse
    the same stable run directories (and resume correctly).
    """
    planned = []
    skipped = []
    counter = 0
    for service_name, service in services.items():
        for model in service["models"]:
            vision = gates.get((service_name.lower(), model))
            if vision is None and not force:
                for bench in PILOT_BENCHMARKS:
                    skipped.append({
                        "service": service_name, "model": model, "benchmark": bench["name"],
                        "reason": "unknown-model",
                        "detail": f"no capabilities entry or vision=null; blocks ALL runs until re-probed",
                    })
                continue
            if vision is not True and not force:
                planned.append({
                    "service": service_name, "model": model, "benchmark": PILOT_BENCHMARKS[0],
                    "vision": vision,
                })
                counter += 1
                planned[-1]["test_id"] = f"U{counter:04d}"
                for bench in PILOT_BENCHMARKS[1:]:
                    skipped.append({
                        "service": service_name, "model": model, "benchmark": bench["name"],
                        "reason": "no-vision",
                        "detail": f"tools.vision is {vision}; vision benchmarks skipped",
                    })
                continue
            if vision is not True and force:
                logger.warning("VISION GATE FORCED for %s/%s (vision=%s) — re-testing after gateway upgrade?",
                               service_name, model, vision)
            for bench in PILOT_BENCHMARKS:
                planned.append({
                    "service": service_name, "model": model, "benchmark": bench,
                    "vision": vision,
                })
                counter += 1
                planned[-1]["test_id"] = f"U{counter:04d}"
    return planned, skipped


def filter_combos(planned, skipped, args):
    """Apply --service/--model/--benchmark/--text-only/--vision-only to planned+skipped sets."""
    def keep_bench(name):
        if args.text_only:
            return name == "book_advert_xml"
        if args.vision_only:
            return name != "book_advert_xml"
        if args.benchmark:
            return name == args.benchmark
        return True

    planned = [c for c in planned
               if (not args.service or c["service"] == args.service)
               and (not args.model or args.model.lower() in c["model"].lower())
               and keep_bench(c["benchmark"]["name"])]
    skipped = [s for s in skipped
               if (not args.service or s["service"] == args.service)
               and (not args.model or args.model.lower() in s["model"].lower())
               and keep_bench(s["benchmark"])]
    return planned, skipped


def load_benchmark(test_config, api_key, benchmark_dir):
    """Same class-discovery logic as RISE/scripts/run_benchmarks.load_benchmark, but with an
    explicit api_key (never OPENAI_API_KEY env) and an absolute benchmark_path."""
    benchmark_file = benchmark_dir / "benchmark.py"
    if benchmark_file.is_file():
        spec = importlib.util.spec_from_file_location("benchmark_module", benchmark_file)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        class_name = "".join(part.capitalize() for part in test_config["name"].split("_"))
        benchmark_class = getattr(module, class_name)
    else:
        benchmark_class = DefaultBenchmark
    return benchmark_class(test_config, api_key, str(benchmark_dir))


def patch_output_paths(benchmark, out_dir, limit_objects):
    """Redirect results to rise_eval/results/<date>/<UID>/ (ad-hoc-test precedent from
    RISE/scripts/run_single_test.py:497-536) and optionally cap the input set for smoke runs."""
    from data_loader import write_file  # noqa: PLC0415 — mirrors the upstream precedent

    benchmark.get_request_answer_path = lambda: str(out_dir)

    def custom_save_benchmark_score(score):
        save_path = out_dir / "scoring.json"
        save_path.parent.mkdir(parents=True, exist_ok=True)
        write_file(str(save_path), score)

    benchmark.save_benchmark_score = custom_save_benchmark_score

    if limit_objects:
        original_get_all_basenames = benchmark.get_all_basenames

        def limited_get_all_basenames(directories, page_pattern=None):
            basenames = original_get_all_basenames(directories, page_pattern=page_pattern)
            return basenames[:limit_objects]

        benchmark.get_all_basenames = limited_get_all_basenames

    return benchmark


def run_combo(combo, services, args, model_limits):
    """Instantiate, patch, and run one (service, model, benchmark) combo. Returns status string."""
    service_name = combo["service"]
    service = services[service_name]
    bench = combo["benchmark"]
    benchmark_dir = RISE_ROOT / "benchmarks" / bench["name"]
    out_dir = RESULTS_DIR / datetime.now().strftime("%Y-%m-%d") / combo["test_id"]

    rules = {"base_url": service["url"]}
    cap = model_limits.get(combo["model"])
    if cap:
        rules["max_tokens"] = cap

    test_config = {
        "id": combo["test_id"],
        "name": bench["name"],
        "provider": "openai",
        "model": combo["model"],
        "dataclass": bench["dataclass"],
        "temperature": bench["temperature"],
        "role_description": bench["role_description"],
        "prompt_file": bench["prompt_file"],
        "rules": json.dumps(rules),
    }

    api_key = service.get("key")
    if not api_key:
        return "no-api-key"

    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_dir / "run_meta.json", "w", encoding="utf-8") as f:
        json.dump({
            "test_id": combo["test_id"],
            "service": service_name,
            "model": combo["model"],
            "benchmark": bench["name"],
            "vision": combo["vision"],
            "provider": "openai",
            "base_url": service["url"],
            "requires_vision": bench["requires_vision"],
            "generated_at": datetime.now().isoformat(),
        }, f, indent=2)

    benchmark = load_benchmark(test_config, api_key, benchmark_dir)
    patch_output_paths(benchmark, out_dir, args.limit_objects)

    if not benchmark.is_runnable():
        return "not-runnable"

    benchmark.run(regenerate_existing_results=args.regenerate, workers=args.workers)
    return "ok"


def print_plan_header(planned, skipped):
    print(f"Planned combos: {len(planned)} | Skipped combos: {len(skipped)}")
    by_reason = {}
    for s in skipped:
        by_reason[s["reason"]] = by_reason.get(s["reason"], 0) + 1
    for reason, count in sorted(by_reason.items()):
        print(f"  {reason}: {count}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--service", choices=["CIT", "GRIT", "AICommons"], help="limit to one service")
    parser.add_argument("--model", help="substring filter on model name (case-insensitive)")
    parser.add_argument("--benchmark", help="limit to one benchmark name")
    parser.add_argument("--text-only", action="store_true", help="only book_advert_xml")
    parser.add_argument("--vision-only", action="store_true", help="only the vision-gated benchmarks")
    parser.add_argument("--capabilities", type=Path, default=DEFAULT_CAPABILITIES)
    parser.add_argument("--model-limits", type=Path, default=DEFAULT_MODEL_LIMITS,
                        help="curated per-model max_output_tokens caps (rules.max_tokens)")
    parser.add_argument("--force", action="store_true",
                        help="ignore the vision gate for the selected combos (with warning)")
    parser.add_argument("--workers", type=int, default=4, help="parallel request threads per benchmark run")
    parser.add_argument("--regenerate", action="store_true",
                        help="re-run requests that already have saved results (default: resume)")
    parser.add_argument("--limit-objects", type=int, default=None,
                        help="smoke: cap inputs per benchmark run")
    parser.add_argument("--dry-run", action="store_true", help="print planned combos and skip decisions; no API calls")
    args = parser.parse_args()

    if args.text_only and args.vision_only:
        parser.error("--text-only and --vision-only are mutually exclusive")

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s:%(name)s:%(message)s")

    import config  # root config.py loads root .env; keys are never printed
    services = config.SERVICES

    gates = load_vision_gates(args.capabilities)
    model_limits = load_model_limits(args.model_limits)
    planned, skipped = build_combos(services, gates, args.force)
    planned, skipped = filter_combos(planned, skipped, args)

    print_plan_header(planned, skipped)
    if model_limits:
        print("Model max_tokens caps: " + ", ".join(
            f"{m}={c}" for m, c in sorted(model_limits.items())))

    for s in skipped:
        print(f"SKIP {s['service']}/{s['model']} × {s['benchmark']}: [{s['reason']}] {s['detail']}")

    if args.dry_run:
        print("\nPlanned:")
        for c in planned:
            b = c["benchmark"]
            print(f"  {c['test_id']} {c['service']}/{c['model']} × {b['name']}"
                  f" (dataclass={b['dataclass']}, T={b['temperature']}, vision={'req' if b['requires_vision'] else 'no'})")
        return 0

    failures = []
    for i, combo in enumerate(planned, 1):
        b = combo["benchmark"]
        label = f"{combo['test_id']} {combo['service']}/{combo['model']} × {b['name']}"
        print(f"\n=== [{i}/{len(planned)}] {label} ===")
        try:
            status = run_combo(combo, services, args, model_limits)
        except FatalProviderError as e:
            logger.critical("Fatal provider error in %s: %s", label, e)
            status = "fatal-provider-error"
        except Exception as e:  # noqa: BLE001 — keep the batch going, one combo failing must not kill the rest
            logger.exception("Combo %s failed", label)
            status = f"error: {type(e).__name__}: {e}"
        print(f"--- {label}: {status} ---")
        if status != "ok":
            failures.append((label, status))

    print(f"\nBatch finished: {len(planned) - len(failures)} ok, {len(failures)} failed")
    if failures:
        print("Failures:")
        for label, status in failures:
            print(f"  {label}: {status}")
    print("\nCollect results with: uv run rise_eval/collect_rise_results.py")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
