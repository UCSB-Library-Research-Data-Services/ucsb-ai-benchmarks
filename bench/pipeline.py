import json
import shlex
import tempfile
from pathlib import Path

from bench import suites
from bench.runner import REPO_ROOT
from bench.runner import run as run_subprocess


def _rc_status(rc, dry_run=False):
    if dry_run:
        return "dry-run"
    return "ok" if rc == 0 else "failed (exit %d)" % rc


def all_ok(status):
    for value in status.values():
        if value in ("ok", "no-op", "dry-run", "skipped"):
            continue
        if value.startswith(("ok ", "no-op ")):
            continue
        return False
    return True


def print_summary(status):
    if not status:
        return
    width = max(len(k) for k in status)
    print("\nSummary:")
    for key, value in status.items():
        print("  %-*s  %s" % (width, key, value))


def group_by_service(pairs):
    groups = {}
    for svc, model in pairs:
        groups.setdefault(svc, []).append(model)
    return groups


def probe_missing(missing, log_path=None, dry_run=False):
    groups = group_by_service(missing)
    planned = sum(len(v) for v in groups.values())
    if dry_run:
        for svc in sorted(groups):
            argv = suites.build_probe_argv(svc, sorted(groups[svc]), suites.CAPABILITIES_PATH)
            print("$ " + shlex.join(str(a) for a in argv) + "  [probe before rise]")
        return planned, True
    ok = True
    probed = 0
    for svc in sorted(groups):
        models = sorted(groups[svc])
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".json", prefix="bench-probe-")
        tmp_path = Path(tmp.name)
        tmp.close()
        try:
            argv = suites.build_probe_argv(svc, models, tmp_path)
            rc = run_subprocess(argv, cwd=REPO_ROOT, log_path=log_path)
            if rc != 0:
                print("probe failed for service %s (exit %d)" % (svc, rc))
                ok = False
                continue
            try:
                entries = json.loads(tmp_path.read_text(encoding="utf-8")).get("models", [])
            except (OSError, ValueError) as e:
                print("probe output unreadable for %s: %s" % (svc, e))
                ok = False
                continue
            total = suites.merge_capabilities(suites.CAPABILITIES_PATH, entries)
            probed += len(entries)
            print("probed %d model(s) for %s (capabilities now holds %d)" % (len(entries), svc, total))
        finally:
            try:
                tmp_path.unlink()
            except OSError:
                pass
    return probed, ok


def run_suites(targets, service, model, smoke, no_collect, passthrough, roster, log_path, dry_run):
    status = {}
    for suite in targets:
        if suite == "rise":
            cap_table, _ = suites.load_capabilities()
            missing = suites.find_missing(roster, cap_table, service, model)
            if missing:
                print("probing %d model(s) missing from capabilities..." % len(missing))
                probed, ok = probe_missing(missing, log_path, dry_run)
                if dry_run:
                    status["capabilities"] = "dry-run"
                elif ok:
                    status["capabilities"] = "ok (%d probed)" % probed
                else:
                    status["capabilities"] = "failed"
        argv = suites.build_run_argv(suite, service, model, smoke, passthrough, roster)
        rc = run_subprocess(argv, cwd=REPO_ROOT, log_path=log_path, dry_run=dry_run)
        status["run " + suite] = _rc_status(rc, dry_run)
        if not no_collect:
            cargv = suites.build_collect_argv(suite)
            if cargv is None:
                status["collect " + suite] = "no-op (self-collecting)"
            else:
                rc2 = run_subprocess(cargv, cwd=REPO_ROOT, log_path=log_path, dry_run=dry_run)
                status["collect " + suite] = _rc_status(rc2, dry_run)
    return status


def run_pipeline(targets, service, model, skip_build, no_collect, roster, log_path, dry_run):
    status = run_suites(targets, service, model, False, no_collect, [], roster, log_path, dry_run)
    if skip_build:
        status["build"] = "skipped"
    else:
        rc = run_subprocess(suites.BUILD_ARGV, cwd=suites.DASHBOARD_DIR, log_path=log_path, dry_run=dry_run)
        status["build"] = _rc_status(rc, dry_run)
    return status
