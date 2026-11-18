import importlib.util
from pathlib import Path

import pytest

from bench import pipeline, suites

_SPEC = importlib.util.spec_from_file_location(
    "export_baselines", Path(__file__).resolve().parent.parent / "scripts" / "export_baselines.py")
eb = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(eb)


@pytest.fixture()
def roster():
    return {
        "CIT": {"url": "http://cit", "models": ["gemma-4-31b"]},
        "GRIT": {"url": "http://grit", "models": ["phi4:latest"]},
        "DREAMLAB": {"url": "http://dl", "role": "baseline",
                     "models": ["gemini-4-hydrogen", "gemini-3.5-flash-lite"]},
    }


def test_plan_services_excludes_baseline_by_default(roster):
    assert suites.plan_services(roster) == ["CIT", "GRIT"]


def test_plan_services_include_baseline(roster):
    assert suites.plan_services(roster, include_baseline=True) == ["CIT", "GRIT", "DREAMLAB"]


def test_plan_services_explicit_service_wins(roster):
    assert suites.plan_services(roster, service="DREAMLAB") == ["DREAMLAB"]


def test_plan_services_baseline_model_needs_flag(roster):
    with pytest.raises(ValueError, match="baseline"):
        suites.plan_services(roster, model="gemini-4-hydrogen")
    assert suites.plan_services(roster, model="gemini-4-hydrogen", include_baseline=True) == ["DREAMLAB"]


def test_run_suites_expands_per_service_and_excludes_baseline(monkeypatch, roster):
    calls = []
    monkeypatch.setattr(pipeline.suites, "load_capabilities", lambda path=None: ({}, None))
    monkeypatch.setattr(pipeline, "probe_missing", lambda missing, log_path=None, dry_run=False: (0, True))
    monkeypatch.setattr(pipeline, "run_subprocess", lambda argv, cwd=None, log_path=None, dry_run=False: calls.append(list(argv)) or 0)
    status = pipeline.run_suites(["performance"], None, None, False, True, [], roster, None, False)
    runs = [c for c in calls if "scripts/perfBench.py" in c]
    assert [c[c.index("--service") + 1] for c in runs] == ["CIT", "GRIT"]
    assert not any("DREAMLAB" in c for c in calls)
    assert status["run performance (CIT)"] == "ok"


def test_run_suites_collects_baselines_once(monkeypatch, roster):
    calls = []
    monkeypatch.setattr(pipeline, "run_subprocess", lambda argv, cwd=None, log_path=None, dry_run=False: calls.append(list(argv)) or 0)
    status = pipeline.run_suites(["rise"], None, None, False, False, [], roster, None, False)
    assert suites.BASELINES_ARGV in calls
    assert status["collect baselines"] == "ok"


def test_baseline_tiers_only_roster_entries(roster):
    tiers = eb.baseline_tiers(roster)
    assert tiers == {
        ("dreamlab", "gemini-4-hydrogen"): ("DREAMLAB", "gemini-4-hydrogen"),
        ("dreamlab", "gemini-3.5-flash-lite"): ("DREAMLAB", "gemini-3.5-flash-lite"),
    }


def test_build_baselines_filters_stale_and_aggregates_perf():
    tiers = eb.baseline_tiers({"DREAMLAB": {"role": "baseline", "models": ["m-a"]}})
    perf = [
        {"service": "dreamlab", "model": "m-a", "category": "x", "timestamp": "2026-01-01",
         "ttft_sec": 1.0, "itl_ms_per_token": 10.0, "generation_tps": 50.0, "total_tps": 60.0},
        {"service": "DREAMLAB", "model": "m-a", "category": "x", "timestamp": "2026-02-01",
         "ttft_sec": 3.0, "itl_ms_per_token": 20.0, "generation_tps": 70.0, "total_tps": 80.0},
        {"service": "DREAMLAB", "model": "gemini-3.5-flash", "category": "x", "timestamp": "2026-02-01",
         "ttft_sec": 99.0, "itl_ms_per_token": 99.0, "generation_tps": 1.0, "total_tps": 1.0},
        {"service": "CIT", "model": "m-a", "category": "x", "timestamp": "2026-02-01",
         "ttft_sec": 99.0, "itl_ms_per_token": 99.0, "generation_tps": 1.0, "total_tps": 1.0},
    ]
    out = eb.build_baselines(perf, [], [], tiers)
    entry = out["m-a"]
    assert entry["runs"]["performance"] == 2
    assert entry["latest"]["performance"] == "2026-02-01"
    assert entry["values"]["performance"]["ttft_sec"]["overall"] == 2.0
    assert entry["values"]["performance"]["ttft_sec"]["x"] == 2.0
    assert "gemini-3.5-flash" not in out


def test_build_baselines_rise_latest_per_benchmark_and_avg():
    tiers = eb.baseline_tiers({"DREAMLAB": {"role": "baseline", "models": ["m-a"]}})
    rise = [
        {"service": "DREAMLAB", "model": "m-a", "benchmark": "b1", "date": "2026-01-01", "test_id": "1", "normalized_score": 10.0},
        {"service": "DREAMLAB", "model": "m-a", "benchmark": "b1", "date": "2026-02-01", "test_id": "2", "normalized_score": 30.0},
        {"service": "DREAMLAB", "model": "m-a", "benchmark": "b2", "date": "2026-02-01", "test_id": "3", "normalized_score": 50.0},
    ]
    values = eb.build_baselines([], rise, [], tiers)["m-a"]["values"]["rise"]["score"]
    assert values == {"b1": 30.0, "b2": 50.0, "avg": 40.0}


def test_build_baselines_scicode_latest_per_split_scaled():
    tiers = eb.baseline_tiers({"DREAMLAB": {"role": "baseline", "models": ["m-a"]}})
    sci = [
        {"service": "DREAMLAB", "model": "m-a", "split": "test", "timestamp": "2026-01-01",
         "main_resolve_rate": 0.1, "sub_step_accuracy": 0.2},
        {"service": "DREAMLAB", "model": "m-a", "split": "test", "timestamp": "2026-03-01",
         "main_resolve_rate": 0.5, "sub_step_accuracy": 0.6},
    ]
    values = eb.build_baselines([], [], sci, tiers)["m-a"]["values"]["scicode"]
    assert values == {"resolve": {"test": 50.0}, "substep": {"test": 60.0}}


def test_build_baselines_missing_tier_absent():
    tiers = eb.baseline_tiers({"DREAMLAB": {"role": "baseline", "models": ["m-a", "m-b"]}})
    rise = [{"service": "DREAMLAB", "model": "m-a", "benchmark": "b1", "date": "d", "test_id": "t", "normalized_score": 1.0}]
    out = eb.build_baselines([], rise, [], tiers)
    assert set(out) == {"m-a"}
