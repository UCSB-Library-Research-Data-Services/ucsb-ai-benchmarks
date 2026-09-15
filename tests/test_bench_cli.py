import json

import pytest

from bench import suites


@pytest.fixture()
def roster():
    return {
        "CIT": {"url": "http://cit", "models": ["gemma-4-31b", "qwen3-32b"]},
        "GRIT": {"url": "http://grit", "models": ["qwen3:latest"]},
        "AICommons": {"url": "http://aic", "models": ["qwen3-32b", "gpt-4o"]},
    }


def test_resolve_service_case_insensitive(roster):
    assert suites.resolve_service("cit", roster) == "CIT"
    assert suites.resolve_service("GRIT", roster) == "GRIT"


def test_resolve_service_unknown(roster):
    with pytest.raises(ValueError):
        suites.resolve_service("nope", roster)


def test_resolve_model_exact_case_insensitive(roster):
    assert suites.resolve_model("GEMMA-4-31B", roster) == "gemma-4-31b"


def test_resolve_model_unique_substring(roster):
    assert suites.resolve_model("gemma-4", roster) == "gemma-4-31b"
    assert suites.resolve_model("gpt-4o", roster, "AICommons") == "gpt-4o"


def test_resolve_model_ambiguous(roster):
    with pytest.raises(ValueError, match="ambiguous"):
        suites.resolve_model("qwen3", roster)


def test_resolve_model_unknown(roster):
    with pytest.raises(ValueError, match="unknown"):
        suites.resolve_model("nope-model", roster)


def test_resolve_model_scoped_to_service(roster):
    assert suites.resolve_model("qwen3-32b", roster, "CIT") == "qwen3-32b"


def test_normalize_suites_default_and_subset():
    assert suites.normalize_suites(None) == ["performance", "rise", "scicode"]
    assert suites.normalize_suites("scicode,performance") == ["performance", "scicode"]


def test_normalize_suites_unknown():
    with pytest.raises(ValueError, match="unknown suite"):
        suites.normalize_suites("performance,nope")


def test_perf_smoke_argv(roster):
    argv = suites.build_run_argv("performance", "CIT", "gemma-4-31b", True, [], roster)
    assert argv[:4] == ["uv", "run", "python", "scripts/perfBench.py"]
    assert "--task" in argv and "3" in argv
    assert "--service" in argv and "CIT" in argv
    assert "--models" in argv and "gemma-4-31b" in argv


def test_perf_unique_owner_inferred(roster):
    argv = suites.build_run_argv("performance", None, "gemma-4-31b", False, [], roster)
    assert "--service" in argv
    assert argv[argv.index("--service") + 1] == "CIT"


def test_perf_shared_model_no_service_inferred(roster):
    argv = suites.build_run_argv("performance", None, "qwen3-32b", False, [], roster)
    assert "--service" not in argv
    assert "--models" in argv


def test_perf_smoke_respects_passthrough(roster):
    argv = suites.build_run_argv("performance", None, None, True, ["--task", "5"], roster)
    assert argv.count("--task") == 1
    assert "5" in argv


def test_rise_smoke_argv():
    argv = suites.build_run_argv("rise", "CIT", "gemma-4-31b", True, [])
    assert "--limit-objects" in argv and "2" in argv
    assert "--text-only" in argv


def test_scicode_smoke_argv():
    argv = suites.build_run_argv("scicode", "CIT", "gemma-4-31b", True, [])
    assert "--split" in argv and "validation" in argv
    assert "--limit" in argv and "2" in argv


def test_scicode_full_argv_has_no_smoke_flags():
    argv = suites.build_run_argv("scicode", "GRIT", "qwen3:latest", False, [])
    assert "--split" not in argv and "--limit" not in argv
    assert argv[0] == "bash"


def test_passthrough_appended_once(roster):
    argv = suites.build_run_argv("performance", "CIT", None, False, ["--workers", "8"], roster)
    assert argv.count("--workers") == 1
    assert "--service" in argv


def test_collect_argv_matrix():
    assert suites.build_collect_argv("performance") == ["uv", "run", "python", "scripts/export_performance_details.py"]
    assert suites.build_collect_argv("rise") == ["uv", "run", "rise_eval/collect_rise_results.py"]
    assert suites.build_collect_argv("scicode") == ["uv", "run", "python", "SciCode/eval/inspect_ai/collect_scicode_results.py"]


def test_collect_argvs_matrix():
    assert suites.build_collect_argvs("performance") == [
        ["uv", "run", "python", "scripts/export_performance_details.py"]
    ]
    assert suites.build_collect_argvs("rise") == [["uv", "run", "rise_eval/collect_rise_results.py"]]
    assert suites.build_collect_argvs("scicode") == [
        ["uv", "run", "python", "SciCode/eval/inspect_ai/collect_scicode_results.py"],
        ["uv", "run", "python", "scripts/export_scicode_details.py"],
    ]


def test_find_missing(roster):
    cap = {("cit", "gemma-4-31b"): {"tools": {"vision": True}}}
    missing = suites.find_missing(roster, cap)
    assert ("CIT", "gemma-4-31b") not in missing
    assert ("CIT", "qwen3-32b") in missing


def test_find_missing_scoped(roster):
    missing = suites.find_missing(roster, {}, service="GRIT", model="qwen3:latest")
    assert missing == [("GRIT", "qwen3:latest")]


def test_build_probe_argv(tmp_path):
    out = tmp_path / "cap.json"
    argv = suites.build_probe_argv("CIT", ["b", "a"], out)
    assert argv == ["uv", "run", "python", "scripts/check_model_vision.py",
                    "--services", "CIT", "--models", "b", "a", "--output", str(out)]


def test_probe_grouping_sorted():
    from bench.pipeline import group_by_service
    assert group_by_service([("B", "m2"), ("A", "m1"), ("B", "m0")]) == {"B": ["m2", "m0"], "A": ["m1"]}


def test_all_ok():
    from bench.pipeline import all_ok
    assert all_ok({"a": "ok", "b": "no-op (self-collecting)", "c": "dry-run", "d": "skipped"})
    assert not all_ok({"a": "ok", "b": "failed (exit 1)"})


def test_pipeline_dry_run_records_no_calls(monkeypatch):
    from bench import pipeline
    calls = []
    def fake(argv, cwd=None, log_path=None, dry_run=False):
        calls.append((list(argv), dry_run))
        return 0
    monkeypatch.setattr(pipeline, "run_subprocess", fake)
    status = pipeline.run_pipeline(["performance"], "CIT", "gemma-4-31b", True, True, {}, None, True)
    assert calls and all(dry for _, dry in calls)
    assert status["build"] == "skipped"
    assert status["run performance"] == "dry-run"


def test_run_suites_auto_probe_and_collect(monkeypatch):
    from bench import pipeline
    calls = []
    monkeypatch.setattr(pipeline.suites, "load_capabilities", lambda path=None: ({}, None))
    monkeypatch.setattr(pipeline, "probe_missing", lambda missing, log_path=None, dry_run=False: (len(missing), True))
    monkeypatch.setattr(pipeline, "run_subprocess", lambda argv, cwd=None, log_path=None, dry_run=False: calls.append(argv[0]) or 0)
    roster = {"CIT": {"models": ["gemma-4-31b"]}}
    status = pipeline.run_suites(["rise"], "CIT", "gemma-4-31b", False, False, [], roster, None, False)
    assert status["capabilities"] == "ok (1 probed)"
    assert status["run rise"] == "ok"
    assert status["collect rise"] == "ok"


def test_merge_capabilities_roundtrip(tmp_path):
    path = tmp_path / "cap.json"
    path.write_text(json.dumps({"models": [{"service": "CIT", "model": "a", "tools": {"vision": True}}]}))
    total = suites.merge_capabilities(path, [{"service": "CIT", "model": "b", "tools": {"vision": False}}])
    data = json.loads(path.read_text())
    assert total == 2
    assert [m["model"] for m in data["models"]] == ["a", "b"]


def test_count_jsonl(tmp_path):
    path = tmp_path / "r.jsonl"
    path.write_text('{"service": "CIT", "model": "m"}\nnot json\n{"service": "cit", "model": "m"}\n')
    assert suites.count_jsonl(path) == {("CIT", "m"): 2}
    assert suites.count_jsonl(tmp_path / "missing.jsonl") == {}
