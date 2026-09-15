"""Export the model/provider catalog for the dashboard Models & Providers page.

Live-fetches GET {api_base}/models per service (Bearer key, short timeout),
caches the last-good response, and falls back to the cache then the
config.py roster when unreachable. Unions API list + roster + models seen in
the three benchmark JSONLs so leaderboard cross-links never 404.

API-derived fields (model id, owned_by) are recorded verbatim, plus
capabilities, curated gateway-verified max output tokens from
data/model_limits.json, and benchmark participation -- no fabricated model info.

Usage:
    uv run --directory .. python scripts/export_catalog.py
    uv run --directory .. python scripts/export_catalog.py --offline
    uv run --directory .. python scripts/export_catalog.py --services CIT GRIT
"""
import argparse
import importlib.util
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
PROVIDERS_PATH = WORKSPACE_ROOT / "data" / "providers.json"
CAPABILITIES_PATH = WORKSPACE_ROOT / "data" / "model_capabilities.json"
MODEL_LIMITS_PATH = WORKSPACE_ROOT / "data" / "model_limits.json"
CACHE_PATH = WORKSPACE_ROOT / "data" / "model_catalog_cache.json"
DEFAULT_OUTPUT = WORKSPACE_ROOT / "dashboard" / "src" / "data" / "catalog.json"

PERF_PATH = WORKSPACE_ROOT / "data" / "performance_results.jsonl"
SCICODE_PATH = WORKSPACE_ROOT / "data" / "scicode_results.jsonl"
RISE_PATH = WORKSPACE_ROOT / "data" / "rise_results.jsonl"

FETCH_TIMEOUT = 10


def load_services():
    spec = importlib.util.spec_from_file_location("config", str(WORKSPACE_ROOT / "config.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.SERVICES


def api_base(service_config):
    base = service_config["url"].rstrip("/")
    return base if base.endswith("/v1") else base + "/v1"


def auth(service_config):
    key = service_config.get("key")
    return {"Authorization": f"Bearer {key}"} if key else {}


def slugify(value):
    return re.sub(r"[^a-z0-9._-]+", "_", (value or "").lower())


def model_slug(service, model):
    return f"{service.lower()}--{slugify(model)}"


def read_jsonl_models(path):
    """Return {(service_lower, model): True} pairs seen in a JSONL file."""
    seen = set()
    if not path.exists():
        print(f"[!] {path.name}: not found, skipping")
        return seen
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        service = d.get("service")
        model = d.get("model")
        if service and model:
            seen.add((str(service).lower(), str(model)))
    return seen


def load_model_limits(path):
    """model -> (max_output_tokens, source) from the curated limits file ({} when unreadable)."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"[!] could not parse model limits {path.name}: {e}")
        return {}
    out = {}
    for model, entry in (data.get("models") or {}).items():
        if not isinstance(entry, dict):
            continue
        cap = entry.get("max_output_tokens")
        if isinstance(cap, int) and cap > 0:
            out[model] = (cap, entry.get("source") or "")
    return out


def normalize_api_entries(entries):
    """Cache entries -> [{"id", "owned_by"}]; accepts the legacy id-string format."""
    out = []
    for entry in entries or []:
        if isinstance(entry, str):
            out.append({"id": entry, "owned_by": None})
        elif isinstance(entry, dict) and entry.get("id"):
            out.append({"id": entry["id"], "owned_by": entry.get("owned_by")})
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--services", nargs="*", default=None)
    parser.add_argument("--offline", action="store_true",
                        help="Skip network, use cache/roster only")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--cache", default=str(CACHE_PATH))
    args = parser.parse_args()

    services = load_services()
    if args.services:
        services = {k: v for k, v in services.items() if k in args.services}
    if not services:
        print("[!] no services selected")
        return 1

    providers_meta = json.loads(PROVIDERS_PATH.read_text(encoding="utf-8")) if PROVIDERS_PATH.exists() else {}

    caps_table = {}
    if CAPABILITIES_PATH.exists():
        try:
            caps = json.loads(CAPABILITIES_PATH.read_text(encoding="utf-8"))
            for entry in caps.get("models", []):
                caps_table[(str(entry.get("service", "")).lower(), str(entry.get("model", "")))] = entry
        except (json.JSONDecodeError, AttributeError) as e:
            print(f"[!] could not parse {CAPABILITIES_PATH.name}: {e}")

    cache_path = Path(args.cache)
    cache = {}
    if cache_path.exists():
        try:
            cache = json.loads(cache_path.read_text(encoding="utf-8")).get("services", {})
        except (json.JSONDecodeError, AttributeError):
            cache = {}

    perf_seen = read_jsonl_models(PERF_PATH)
    scicode_seen = read_jsonl_models(SCICODE_PATH)
    rise_seen = read_jsonl_models(RISE_PATH)

    canonical = {name.lower(): name for name in services}

    def bucket(seen):
        out = {}
        for svc_lower, model in seen:
            if svc_lower in canonical:
                out.setdefault(canonical[svc_lower], set()).add(model)
        return out

    perf_by_svc = bucket(perf_seen)
    scicode_by_svc = bucket(scicode_seen)
    rise_by_svc = bucket(rise_seen)
    model_limits = load_model_limits(MODEL_LIMITS_PATH)

    new_cache = dict(cache)
    catalog_models = []
    provider_rows = []

    for name, cfg in services.items():
        roster = list(cfg.get("models") or [])
        roster_set = set(roster)
        api_models = None
        source = "roster"

        if not args.offline:
            try:
                r = requests.get(api_base(cfg) + "/models", headers=auth(cfg), timeout=FETCH_TIMEOUT)
                r.raise_for_status()
                api_models = normalize_api_entries(r.json().get("data", []))
                new_cache[name] = api_models
                source = "api"
            except Exception as e:
                print(f"[!] {name}: live fetch failed ({e}); trying cache")
        if api_models is None:
            if name in cache:
                api_models = normalize_api_entries(cache[name])
                source = "cache"
            else:
                api_models = []
                source = "roster"
        if source != "api":
            print(f"[!] {name}: using {source} fallback ({len(api_models)} cached, {len(roster)} roster)")
        else:
            print(f"    {name}: live API listed {len(api_models)} model(s)")

        api_set = {entry["id"] for entry in api_models}
        owned_by = {entry["id"]: entry.get("owned_by") for entry in api_models if entry.get("owned_by")}
        union = []
        for m in [entry["id"] for entry in api_models] + roster + sorted(perf_by_svc.get(name, set())) \
                + sorted(scicode_by_svc.get(name, set())) + sorted(rise_by_svc.get(name, set())):
            if m not in union:
                union.append(m)

        for model in sorted(union):
            cap = caps_table.get((name.lower(), model))
            vision = (cap.get("tools") or {}).get("vision") if cap else None
            limit = model_limits.get(model)
            catalog_models.append({
                "service": name,
                "model": model,
                "slug": model_slug(name, model),
                "in_api": model in api_set,
                "in_roster": model in roster_set,
                "owned_by": owned_by.get(model),
                "vision": vision,
                "vision_status": cap.get("status") if cap else None,
                "max_output_tokens": limit[0] if limit else None,
                "max_output_tokens_source": limit[1] if limit else None,
                "benchmarked": {
                    "performance": model in perf_by_svc.get(name, set()),
                    "scicode": model in scicode_by_svc.get(name, set()),
                    "rise": model in rise_by_svc.get(name, set()),
                },
            })

        meta = providers_meta.get(name, {})
        bench_count = sum(1 for m in catalog_models if m["service"] == name
                          and any(m["benchmarked"].values()))
        provider_rows.append({
            "id": name,
            "name": meta.get("name", name),
            "description": meta.get("description", ""),
            "website": meta.get("website", ""),
            "api_url": cfg.get("url", ""),
            "model_types": meta.get("model_types", ""),
            "access": meta.get("access", ""),
            "status": meta.get("status", "active"),
            "model_count": sum(1 for m in catalog_models if m["service"] == name),
            "benchmarked_count": bench_count,
        })

    catalog_models.sort(key=lambda m: (m["service"].lower(), m["model"].lower()))
    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "providers": provider_rows,
        "models": catalog_models,
    }
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(output, indent=2) + "\n")
    print(f"Wrote {out_path} ({len(provider_rows)} providers, {len(catalog_models)} models)")

    if new_cache != cache and not args.offline:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps({
            "generated_at": output["generated_at"],
            "description": "Last-good GET /v1/models responses per service (entries: {id, owned_by}). Fallback for export_catalog.py --offline.",
            "services": new_cache,
        }, indent=2) + "\n")
        print(f"Updated cache {cache_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
