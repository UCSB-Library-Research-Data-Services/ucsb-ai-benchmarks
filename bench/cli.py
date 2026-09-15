"""bench: run, collect, probe, and build all UCSB AI benchmark suites.

Benchmark logic lives in the existing suite scripts; bench only resolves
filters (against config.py), shells out, and summarizes. All subprocesses
run from the repo root, so relative paths in the suite scripts keep working.

Cron (full batch, dashboard build included):

  0 3 * * * REPO/.venv/bin/bench pipeline >> REPO/logs/cron.log 2>&1
"""

import argparse
import sys

from bench import suites
from bench.pipeline import all_ok, print_summary, probe_missing, run_pipeline, run_suites
from bench.runner import REPO_ROOT, run, setup_log


def _build_parser():
    parser = argparse.ArgumentParser(prog="bench", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_run = sub.add_parser("run", help="run one suite (auto-collects) or all suites")
    p_run.add_argument("suite", choices=list(suites.SUITES) + ["all"])
    p_run.add_argument("--service", default=None, help="limit to one service in config.py (case-insensitive)")
    p_run.add_argument("--model", default=None, help="exact config.py name or unique substring (case-insensitive)")
    p_run.add_argument("--no-collect", action="store_true", help="skip auto-collect after the run")
    p_run.add_argument("--smoke", action="store_true", help="cheap check: perf --task 3, rise --limit-objects 2 --text-only, scicode --split validation --limit 2")
    p_run.add_argument("--dry-run", action="store_true", help="print resolved argv without executing")

    p_collect = sub.add_parser("collect", help="collect results into data/*.jsonl (idempotent rewrites)")
    p_collect.add_argument("suite", choices=list(suites.SUITES) + ["all"])

    p_pipe = sub.add_parser("pipeline", help="probe missing models, run suites in order, collect, build dashboard")
    p_pipe.add_argument("--suites", default=None, help="comma-separated subset, e.g. performance,rise (default: all three)")
    p_pipe.add_argument("--service", default=None, help="limit to one service in config.py (case-insensitive)")
    p_pipe.add_argument("--model", default=None, help="exact config.py name or unique substring (case-insensitive)")
    p_pipe.add_argument("--no-collect", action="store_true")
    p_pipe.add_argument("--skip-build", action="store_true", help="skip dashboard build at the end")
    p_pipe.add_argument("--dry-run", action="store_true", help="print resolved argv without executing")

    p_cap = sub.add_parser("capabilities", help="probe vision capability into data/model_capabilities.json")
    p_cap.add_argument("--services", nargs="*", default=None, help="limit services (default: all with a models roster)")
    p_cap.add_argument("--models", nargs="*", default=None, help="limit models by exact name within those services")
    p_cap.add_argument("--force", action="store_true", help="re-probe models that already have an entry (default: missing only)")

    sub.add_parser("build", help="npm run build in dashboard/")

    p_list = sub.add_parser("list", help="roster table: service, model, vision flag, collected row counts")
    p_list.add_argument("--service", default=None)
    return parser


def _resolve_selection(service_name, model_name, roster):
    service = suites.resolve_service(service_name, roster) if service_name else None
    model = suites.resolve_model(model_name, roster, service) if model_name else None
    return service, model


def _cmd_run(args, passthrough, roster, log_path):
    try:
        service, model = _resolve_selection(args.service, args.model, roster)
    except ValueError as e:
        print("error: %s" % e, file=sys.stderr)
        return 2
    targets = list(suites.SUITES) if args.suite == "all" else [args.suite]
    status = run_suites(targets, service, model, args.smoke, args.no_collect, passthrough, roster, log_path, args.dry_run)
    print_summary(status)
    return 0 if all_ok(status) else 1


def _cmd_collect(args, log_path):
    targets = list(suites.SUITES) if args.suite == "all" else [args.suite]
    status = {}
    for suite in targets:
        cargvs = suites.build_collect_argvs(suite)
        if not cargvs:
            print("performance: no-op (appends to data/performance_results.jsonl directly)")
            status["collect performance"] = "no-op (self-collecting)"
            continue
        for step, argv in enumerate(cargvs):
            key = "collect " + suite if len(cargvs) == 1 else "collect %s [%d]" % (suite, step + 1)
            status[key] = "ok" if run(argv, cwd=REPO_ROOT, log_path=log_path) == 0 else "failed"
            if status[key] != "ok":
                break
    print_summary(status)
    return 0 if all_ok(status) else 1


def _cmd_pipeline(args, roster, log_path):
    try:
        service, model = _resolve_selection(args.service, args.model, roster)
        targets = suites.normalize_suites(args.suites)
    except ValueError as e:
        print("error: %s" % e, file=sys.stderr)
        return 2
    status = run_pipeline(targets, service, model, args.skip_build, args.no_collect, roster, log_path, args.dry_run)
    print_summary(status)
    return 0 if all_ok(status) else 1


def _cmd_capabilities(args, log_path):
    try:
        roster = suites.load_roster()
    except Exception as e:
        print("error loading config.py: %s" % e, file=sys.stderr)
        return 2
    if args.services:
        known = {s.lower(): s for s in roster}
        for s in args.services:
            if s.lower() not in known:
                print("error: unknown --services %r (available: %s)" % (s, ", ".join(roster)), file=sys.stderr)
                return 2
        wanted_services = [known[s.lower()] for s in args.services]
    else:
        wanted_services = [s for s in roster if roster[s].get("models")]
    selected = {}
    for svc in wanted_services:
        models = list(roster[svc].get("models") or [])
        if args.models:
            wanted = {m.lower() for m in args.models}
            models = [m for m in models if m.lower() in wanted]
        if models:
            selected[svc] = models
    if not selected:
        print("error: no models selected (check --services/--models against config.py)", file=sys.stderr)
        return 2
    if not args.force:
        cap_table, _ = suites.load_capabilities()
        selected = {s: [m for m in ms if (s.lower(), m) not in cap_table] for s, ms in selected.items()}
        selected = {s: ms for s, ms in selected.items() if ms}
        if not selected:
            print("all selected models already probed (use --force to re-probe)")
            return 0
    missing = [(s, m) for s, ms in selected.items() for m in ms]
    probed, ok = probe_missing(missing, log_path, dry_run=False)
    if ok:
        print("probed %d model(s)" % probed)
        return 0
    print("probe failed", file=sys.stderr)
    return 1


def _cmd_build(log_path):
    rc = run(suites.BUILD_ARGV, cwd=suites.DASHBOARD_DIR, log_path=log_path)
    print_summary({"build": "ok" if rc == 0 else "failed (exit %d)" % rc})
    return rc


def _cmd_list(args):
    try:
        roster = suites.load_roster()
    except Exception as e:
        print("error loading config.py: %s" % e, file=sys.stderr)
        return 2
    service = None
    if args.service:
        try:
            service = suites.resolve_service(args.service, roster)
        except ValueError as e:
            print("error: %s" % e, file=sys.stderr)
            return 2
    cap_table, _ = suites.load_capabilities()
    counts = {}
    for path in (suites.PERF_RESULTS, suites.RISE_RESULTS, suites.SCICODE_RESULTS):
        for key, n in suites.count_jsonl(path).items():
            counts[key] = counts.get(key, 0) + n
    print("%-10s %-28s %-8s %5s" % ("SERVICE", "MODEL", "VISION", "ROWS"))
    for svc, info in roster.items():
        if service and svc != service:
            continue
        for model in info.get("models") or []:
            entry = cap_table.get((svc.lower(), model))
            vision = entry.get("tools", {}).get("vision") if entry else None
            rows = counts.get((svc.upper(), model), 0)
            print("%-10s %-28s %-8s %5d" % (svc, model, str(vision), rows))
    return 0


def main(argv=None):
    parser = _build_parser()
    args, passthrough = parser.parse_known_args(sys.argv[1:] if argv is None else argv)
    if passthrough and args.command != "run":
        print("error: unrecognized arguments: %s" % " ".join(passthrough), file=sys.stderr)
        return 2
    if args.command in ("run", "pipeline"):
        try:
            roster = suites.load_roster()
        except Exception as e:
            print("error loading config.py: %s" % e, file=sys.stderr)
            return 2
        log_path = setup_log()
        print("log: %s" % log_path)
        if args.command == "run":
            return _cmd_run(args, passthrough, roster, log_path)
        return _cmd_pipeline(args, roster, log_path)
    if args.command == "collect":
        return _cmd_collect(args, setup_log())
    if args.command == "capabilities":
        return _cmd_capabilities(args, setup_log())
    if args.command == "build":
        return _cmd_build(setup_log())
    if args.command == "list":
        return _cmd_list(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
