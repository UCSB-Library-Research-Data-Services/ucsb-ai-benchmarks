import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts" / "perfBench.py"

spec = importlib.util.spec_from_file_location("perfbench", SCRIPT_PATH)
perfbench = importlib.util.module_from_spec(spec)
spec.loader.exec_module(perfbench)


def test_select_prompts_limits_to_requested_count():
    prompts = [
        {"id": idx, "category": "general", "prompt": f"prompt {idx}"}
        for idx in range(10)
    ]

    subset = perfbench.select_prompts(prompts, task_limit=3)

    assert len(subset) == 3
    assert [prompt["id"] for prompt in subset] == [0, 1, 2]


def test_get_remaining_prompts_skips_completed_tasks():
    prompts = [
        {"id": idx, "category": "general", "prompt": f"prompt {idx}"}
        for idx in range(5)
    ]

    completed_keys = {("svc", "model", 1), ("svc", "model", 3)}
    remaining = perfbench.get_remaining_prompts(
        prompts,
        service_name="svc",
        model_name="model",
        completed_keys=completed_keys,
    )

    assert [prompt["id"] for prompt in remaining] == [0, 2, 4]


def test_partition_results_by_day():
    existing_results = [
        {"id": "p1", "timestamp": "2026-08-07T04:09:29Z"},
        {"id": "p2", "timestamp": "2026-09-04T12:00:00Z"},
        {"id": "p3", "timestamp": "2026-09-04T17:15:17Z"},
        {"id": "p4"},  # No timestamp
    ]

    other, same = perfbench.partition_results_by_day(existing_results, "2026-09-04")

    assert [r["id"] for r in other] == ["p1", "p4"]
    assert [r["id"] for r in same] == ["p2", "p3"]


def test_partition_results_by_day_empty():
    other, same = perfbench.partition_results_by_day([], "2026-09-04")
    assert other == []
    assert same == []


def test_configure_run_default():
    import argparse
    args = argparse.Namespace(replace=False, replace_same_day=False, resume=False)
    existing = [{"service": "s", "model": "m", "test_id": "p1", "timestamp": "2026-09-04T12:00:00Z"}]
    all_results, completed_keys = perfbench.configure_run(args, existing, "2026-09-04")
    assert all_results == existing
    assert completed_keys == set()


def test_configure_run_resume_default():
    import argparse
    args = argparse.Namespace(replace=False, replace_same_day=False, resume=True)
    existing = [{"service": "s", "model": "m", "test_id": "p1", "timestamp": "2026-09-04T12:00:00Z"}]
    all_results, completed_keys = perfbench.configure_run(args, existing, "2026-09-04")
    assert all_results == existing
    assert completed_keys == {("s", "m", "p1")}


def test_configure_run_replace():
    import argparse
    args = argparse.Namespace(replace=True, replace_same_day=False, resume=False)
    existing = [{"service": "s", "model": "m", "test_id": "p1", "timestamp": "2026-09-04T12:00:00Z"}]
    all_results, completed_keys = perfbench.configure_run(args, existing, "2026-09-04")
    assert all_results == []
    assert completed_keys == set()


def test_configure_run_replace_same_day():
    import argparse
    args = argparse.Namespace(replace=False, replace_same_day=True, resume=False)
    existing = [
        {"service": "s", "model": "m", "test_id": "p1", "timestamp": "2026-09-03T12:00:00Z"},
        {"service": "s", "model": "m", "test_id": "p2", "timestamp": "2026-09-04T12:00:00Z"},
    ]
    all_results, completed_keys = perfbench.configure_run(args, existing, "2026-09-04")
    assert all_results == [existing[0]]
    assert completed_keys == set()


def test_configure_run_replace_same_day_resume():
    import argparse
    args = argparse.Namespace(replace=False, replace_same_day=True, resume=True)
    existing = [
        {"service": "s", "model": "m", "test_id": "p1", "timestamp": "2026-09-03T12:00:00Z"},
        {"service": "s", "model": "m", "test_id": "p2", "timestamp": "2026-09-04T12:00:00Z"},
    ]
    all_results, completed_keys = perfbench.configure_run(args, existing, "2026-09-04")
    assert all_results == existing
    assert completed_keys == {("s", "m", "p2")}
