import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

SUITES = ("performance", "rise", "scicode")

PERF_RUNNER = ["uv", "run", "python", "scripts/perfBench.py"]
RISE_RUNNER = ["uv", "run", "rise_eval/run_rise_ucsb.py"]
SCICODE_RUNNER = ["bash", "SciCode/eval/inspect_ai/run_scicode_evals.sh"]
RISE_COLLECT_ARGV = ["uv", "run", "rise_eval/collect_rise_results.py"]
SCICODE_COLLECT_ARGV = ["uv", "run", "python", "SciCode/eval/inspect_ai/collect_scicode_results.py"]
PROBE_ARGV = ["uv", "run", "python", "scripts/check_model_vision.py"]
BUILD_ARGV = ["npm", "run", "build"]

CAPABILITIES_PATH = REPO_ROOT / "data" / "model_capabilities.json"
DASHBOARD_DIR = REPO_ROOT / "dashboard"
PERF_RESULTS = REPO_ROOT / "data" / "performance_results.jsonl"
RISE_RESULTS = REPO_ROOT / "data" / "rise_results.jsonl"
SCICODE_RESULTS = REPO_ROOT / "data" / "scicode_results.jsonl"


def load_roster():
    spec = importlib.util.spec_from_file_location("bench_config", str(REPO_ROOT / "config.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.SERVICES


def resolve_service(name, roster):
    if name is None:
        return None
    for svc in roster:
        if svc.lower() == name.lower():
            return svc
    raise ValueError("unknown --service %r (available: %s)" % (name, ", ".join(roster)))


def _distinct(names):
    seen = []
    for n in names:
        if n not in seen:
            seen.append(n)
    return seen


def _pool_models(roster, services):
    pool = []
    for svc in services:
        pool.extend(roster[svc].get("models") or [])
    return pool


def resolve_model(name, roster, service=None):
    if name is None:
        return None
    services = [service] if service else list(roster)
    pool = _pool_models(roster, services)
    exact = _distinct([m for m in pool if m.lower() == name.lower()])
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        raise ValueError("ambiguous --model %r (matches): %s" % (name, ", ".join(sorted(exact))))
    sub = _distinct([m for m in pool if name.lower() in m.lower()])
    if len(sub) == 1:
        return sub[0]
    if not sub:
        scope = service or "all"
        raise ValueError("unknown --model %r for service %s" % (name, scope))
    raise ValueError("ambiguous --model %r (matches): %s" % (name, ", ".join(sorted(sub))))


def resolve_exact_model(name, roster, services):
    pool = _pool_models(roster, services)
    exact = _distinct([m for m in pool if m.lower() == name.lower()])
    if len(exact) == 1:
        return exact[0]
    if not exact:
        raise ValueError("unknown model %r (not in config.py roster)" % (name,))
    raise ValueError("ambiguous model %r (matches): %s" % (name, ", ".join(sorted(exact))))


def normalize_suites(spec):
    if spec is None:
        return list(SUITES)
    wanted = [s.strip().lower() for s in spec.split(",") if s.strip()]
    unknown = [s for s in wanted if s not in SUITES]
    if unknown:
        raise ValueError("unknown suite(s): %s (choices: %s)" % (", ".join(unknown), ", ".join(SUITES)))
    if not wanted:
        raise ValueError("empty --suites selection")
    return [s for s in SUITES if s in wanted]


def _has_flag(passthrough, *flags):
    for tok in passthrough:
        for flag in flags:
            if tok == flag or tok.startswith(flag + "="):
                return True
    return False


def build_run_argv(suite, service=None, model=None, smoke=False, passthrough=(), roster=None):
    passthrough = list(passthrough)
    if suite == "performance":
        argv = list(PERF_RUNNER)
        if smoke and not _has_flag(passthrough, "--task", "--test"):
            argv += ["--task", "3"]
        argv += passthrough
        if service and not _has_flag(passthrough, "--service"):
            argv += ["--service", service]
        elif model and roster is not None and not service and not _has_flag(passthrough, "--service"):
            owners = [s for s in roster if model in (roster[s].get("models") or [])]
            if len(owners) == 1:
                argv += ["--service", owners[0]]
        if model and not _has_flag(passthrough, "--models"):
            argv += ["--models", model]
        return argv
    if suite == "rise":
        argv = list(RISE_RUNNER)
        if smoke:
            if not _has_flag(passthrough, "--limit-objects"):
                argv += ["--limit-objects", "2"]
            if not _has_flag(passthrough, "--text-only", "--vision-only"):
                argv += ["--text-only"]
        argv += passthrough
        if service and not _has_flag(passthrough, "--service"):
            argv += ["--service", service]
        if model and not _has_flag(passthrough, "--model"):
            argv += ["--model", model]
        return argv
    if suite == "scicode":
        argv = list(SCICODE_RUNNER)
        if smoke:
            if not _has_flag(passthrough, "--split"):
                argv += ["--split", "validation"]
            if not _has_flag(passthrough, "--limit"):
                argv += ["--limit", "2"]
        argv += passthrough
        if service and not _has_flag(passthrough, "--service"):
            argv += ["--service", service]
        if model and not _has_flag(passthrough, "--model"):
            argv += ["--model", model]
        return argv
    raise ValueError("unknown suite %r" % (suite,))


def build_collect_argv(suite):
    if suite == "performance":
        return None
    if suite == "rise":
        return list(RISE_COLLECT_ARGV)
    if suite == "scicode":
        return list(SCICODE_COLLECT_ARGV)
    raise ValueError("unknown suite %r" % (suite,))


def build_probe_argv(service, models, output):
    return list(PROBE_ARGV) + ["--services", service, "--models"] + list(models) + ["--output", str(output)]


def load_capabilities(path=CAPABILITIES_PATH):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}, None
    table = {}
    for entry in data.get("models", []) or []:
        if entry.get("model"):
            table[((entry.get("service") or "").lower(), entry["model"])] = entry
    return table, data


def find_missing(roster, cap_table, service=None, model=None):
    missing = []
    for svc, info in roster.items():
        if service and svc != service:
            continue
        for m in info.get("models") or []:
            if model and m != model:
                continue
            if (svc.lower(), m) not in cap_table:
                missing.append((svc, m))
    return missing


def merge_capabilities(path, new_entries):
    path = Path(path)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    merged = {}
    for entry in data.get("models", []) or []:
        if entry.get("model"):
            merged[((entry.get("service") or ""), entry["model"])] = entry
    for entry in new_entries or []:
        if entry.get("model"):
            merged[((entry.get("service") or ""), entry["model"])] = entry
    models = [merged[k] for k in sorted(merged, key=lambda k: (str(k[0]), str(k[1])))]
    data["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    data["models"] = models
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return len(models)


def count_jsonl(path):
    counts = {}
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                model = row.get("model")
                if not model:
                    continue
                key = ((row.get("service") or "").upper(), model)
                counts[key] = counts.get(key, 0) + 1
    except OSError:
        pass
    return counts
