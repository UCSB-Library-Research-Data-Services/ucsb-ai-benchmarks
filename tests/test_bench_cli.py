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


def test_redact_secrets_removes_bearer_and_sk():
    from bench.runner import redact_secrets
    line = "Authorization: Bearer sk-abc123def456 host=NRP"
    out = redact_secrets(line)
    assert "sk-abc123def456" not in out
    assert "Bearer ***" in out
    assert "host=NRP" in out


def test_collect_argv_matrix():
    assert suites.build_collect_argv("performance") == ["uv", "run", "python", "scripts/export_performance_details.py"]
    assert suites.build_collect_argv("rise") == ["uv", "run", "rise_eval/collect_rise_results.py"]
    assert suites.build_collect_argv("scicode") == ["uv", "run", "python", "scicode_eval/collect_scicode_results.py"]


def test_collect_argvs_matrix():
    assert suites.build_collect_argvs("performance") == [
        ["uv", "run", "python", "scripts/export_performance_details.py"]
    ]
    assert suites.build_collect_argvs("rise") == [["uv", "run", "rise_eval/collect_rise_results.py"]]
    assert suites.build_collect_argvs("scicode") == [
        ["uv", "run", "python", "scicode_eval/collect_scicode_results.py"],
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


def test_rise_six_benchmark_suite_configs():
    from rise_eval import run_rise_ucsb

    names = [b["name"] for b in run_rise_ucsb.PILOT_BENCHMARKS]
    assert names == [
        "book_advert_xml",
        "bibliographic_data",
        "fraktur_adverts",
        "medieval_manuscripts",
        "general_meeting_minutes",
        "magazine_pages",
    ]
    for b in run_rise_ucsb.PILOT_BENCHMARKS:
        bench_dir = run_rise_ucsb.RISE_ROOT / "benchmarks" / b["name"]
        assert (bench_dir / "prompts" / b["prompt_file"]).is_file()
        assert (bench_dir / "dataclass.py").is_file()


def test_rise_build_combos_skips_completed_and_allocates_monotonic_ids(tmp_path):
    from rise_eval import run_rise_ucsb

    services = {
        "CIT": {"url": "http://cit", "models": ["gemma-4-31b"]},
        "AICommons": {"url": "http://aic", "models": ["amazon-nova-lite", "qwen3-32b"]},
    }
    gates = {
        ("cit", "gemma-4-31b"): True,
        ("aicommons", "amazon-nova-lite"): True,
        ("aicommons", "qwen3-32b"): False,
    }
    jsonl = tmp_path / "rise_results.jsonl"
    rows = [
        {"service": "CIT", "model": "gemma-4-31b", "benchmark": "book_advert_xml", "test_id": "U0001", "date": "2026-09-14", "normalized_score": 98.7},
        {"service": "CIT", "model": "gemma-4-31b", "benchmark": "bibliographic_data", "test_id": "U0002", "date": "2026-09-14", "normalized_score": 66.1},
        {"service": "CIT", "model": "gemma-4-31b", "benchmark": "fraktur_adverts", "test_id": "U0003", "date": "2026-09-14", "normalized_score": 57.5},
        {"service": "AICommons", "model": "amazon-nova-lite", "benchmark": "book_advert_xml", "test_id": "U0064", "date": "2026-09-14", "normalized_score": 0.0},
        {"service": "AICommons", "model": "qwen3-32b", "benchmark": "book_advert_xml", "test_id": "U0042", "date": "2026-09-14", "normalized_score": 0.0},
    ]
    jsonl.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    results_dir = tmp_path / "results"
    results_dir.mkdir()

    planned, skipped = run_rise_ucsb.build_combos(
        services, gates, force=False, regenerate=False,
        results_dir=results_dir, results_jsonl=jsonl, today="2026-10-29",
    )
    already = [s for s in skipped if s["reason"] == "already-completed"]
    assert len(already) == 3
    assert {(s["service"], s["model"], s["benchmark"]) for s in already} == {
        ("CIT", "gemma-4-31b", "book_advert_xml"),
        ("CIT", "gemma-4-31b", "bibliographic_data"),
        ("CIT", "gemma-4-31b", "fraktur_adverts"),
    }
    cit_planned = [c["benchmark"]["name"] for c in planned if c["service"] == "CIT"]
    assert cit_planned == ["medieval_manuscripts", "general_meeting_minutes", "magazine_pages"]

    # Zero-scored combos from 2026-09-14 are re-planned, not skipped
    aic_planned = [(c["model"], c["benchmark"]["name"]) for c in planned if c["service"] == "AICommons"]
    assert ("amazon-nova-lite", "book_advert_xml") in aic_planned
    assert ("qwen3-32b", "book_advert_xml") in aic_planned

    # All allocated test IDs start after U0064 and are strictly monotonic
    ids = [int(c["test_id"][1:]) for c in planned]
    assert ids[0] == 65
    assert ids == list(range(65, 65 + len(planned)))

    # --regenerate disables already-completed skipping
    planned_regen, skipped_regen = run_rise_ucsb.build_combos(
        services, gates, force=False, regenerate=True,
        results_dir=results_dir, results_jsonl=jsonl, today="2026-10-29",
    )
    assert not [s for s in skipped_regen if s["reason"] == "already-completed"]
    assert len(planned_regen) == len(planned) + 3


def test_rise_collect_multi_machine_preserves_existing_rows_and_shards(tmp_path):
    from rise_eval import collect_rise_results

    out_jsonl = tmp_path / "rise_results.jsonl"
    details_dir = tmp_path / "details" / "rise"
    results_dir = tmp_path / "results"
    cap_path = tmp_path / "capabilities.json"

    # Existing row + detail shard from Machine A (no raw run_dir on Machine B)
    existing_row = {
        "service": "CIT",
        "model": "gemma-4-31b",
        "benchmark": "book_advert_xml",
        "test_id": "U0001",
        "date": "2026-09-14",
        "normalized_score": 98.7,
        "vision": True,
        "vision_status": "old_status",
        "vision_note": "old_note",
        "raw_scoring": {"fuzzy": 0.987},
        "num_inputs": 1,
        "num_scored": 1,
        "tokens": {"input": 10, "output": 5, "total": 15},
        "cost_usd": 0.001,
        "timing": {"mean_response_s": 1.0, "total_response_s": 1.0, "slowest_response_s": 1.0, "span_s": None},
    }
    out_jsonl.write_text(json.dumps(existing_row) + "\n")

    shard_u0001 = details_dir / "2026-09-14" / "U0001.json"
    shard_u0001.parent.mkdir(parents=True)
    shard_u0001.write_text(json.dumps({
        **existing_row,
        "requests": [{"line": 1, "text": "preserved request", "score": 0.987}],
    }))
    # Stale orphan shard that is not in rise_results.jsonl or results_dir
    orphan_shard = details_dir / "2026-09-14" / "U9999.json"
    orphan_shard.write_text(json.dumps({"test_id": "U9999", "requests": []}))

    cap_path.write_text(json.dumps({
        "models": [
            {"service": "CIT", "model": "gemma-4-31b", "status": "sees", "note": "updated note", "tools": {"vision": True}},
            {"service": "NRP", "model": "qwen3-vl", "status": "sees", "note": "nrp note", "tools": {"vision": True}},
        ]
    }))

    # Scenario 1: results_dir does not exist at all on Machine B
    rc = collect_rise_results.main([
        "--results-dir", str(results_dir),
        "--out", str(out_jsonl),
        "--details-dir", str(details_dir),
        "--capabilities", str(cap_path),
    ])
    assert rc == 0
    rows_after_empty = [json.loads(line) for line in out_jsonl.read_text().splitlines() if line.strip()]
    assert len(rows_after_empty) == 1
    assert rows_after_empty[0]["test_id"] == "U0001"
    assert rows_after_empty[0]["vision_status"] == "sees"
    assert rows_after_empty[0]["vision_note"] == "updated note"
    assert shard_u0001.is_file()
    assert json.loads(shard_u0001.read_text())["requests"] == [{"line": 1, "text": "preserved request", "score": 0.987}]
    assert not orphan_shard.exists()

    # Scenario 2: Machine B runs a new benchmark (U0002) locally
    run_u0002 = results_dir / "2026-10-29" / "U0002"
    run_u0002.mkdir(parents=True)
    (run_u0002 / "run_meta.json").write_text(json.dumps({
        "service": "NRP", "model": "qwen3-vl", "benchmark": "bibliographic_data",
    }))
    (run_u0002 / "scoring.json").write_text(json.dumps({"fuzzy": 0.75}))
    (run_u0002 / "request_U0002_line_1.json").write_text(json.dumps({
        "text": "new request", "parsed": {"a": 1}, "score": 0.75,
        "usage": {"input_tokens": 20, "output_tokens": 10, "total_tokens": 30},
        "duration": 2.5, "finish_reason": "stop", "timestamp": "2026-10-29T12:00:00",
    }))

    rc = collect_rise_results.main([
        "--results-dir", str(results_dir),
        "--out", str(out_jsonl),
        "--details-dir", str(details_dir),
        "--capabilities", str(cap_path),
    ])
    assert rc == 0
    merged = [json.loads(line) for line in out_jsonl.read_text().splitlines() if line.strip()]
    assert [r["test_id"] for r in merged] == ["U0001", "U0002"]
    assert shard_u0001.is_file()
    assert json.loads(shard_u0001.read_text())["requests"] == [{"line": 1, "text": "preserved request", "score": 0.987}]
    shard_u0002 = details_dir / "2026-10-29" / "U0002.json"
    assert shard_u0002.is_file()
    assert len(json.loads(shard_u0002.read_text())["requests"]) == 1

    # Scenario 3: --replace drops preserved rows not in results_dir and prunes their shards
    rc = collect_rise_results.main([
        "--results-dir", str(results_dir),
        "--out", str(out_jsonl),
        "--details-dir", str(details_dir),
        "--capabilities", str(cap_path),
        "--replace",
    ])
    assert rc == 0
    replaced = [json.loads(line) for line in out_jsonl.read_text().splitlines() if line.strip()]
    assert [r["test_id"] for r in replaced] == ["U0002"]
    assert not shard_u0001.exists()
    assert shard_u0002.is_file()


