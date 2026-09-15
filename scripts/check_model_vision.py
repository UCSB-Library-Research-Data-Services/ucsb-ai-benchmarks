"""Check which config.py models can actually see images.

Sends tests/vision/CCundinamarca_page_1.png to every model via its
OpenAI-compatible chat/completions endpoint, asks for a transcription, and
compares against the ground-truth .txt. Each model lands in one bucket:

  sees         transcription matches the ground truth -> tools.vision = true
  rejects      API error or "I can't see images" answer -> tools.vision = false
  hallucinates answers but matches almost nothing -> tools.vision = false
  error        request failed before a verdict -> tools.vision = null

Writes data/model_capabilities.json for benchmark scripts to consult when
vision is required. Only 'vision' is probed; the other tools are
placeholders (false) until probed later.

Usage:
    .venv/bin/python scripts/check_model_vision.py
    .venv/bin/python scripts/check_model_vision.py --services GRIT
    .venv/bin/python scripts/check_model_vision.py --services GRIT --models mistral:latest
"""
import argparse
import base64
import concurrent.futures
import importlib.util
import io
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import requests
from PIL import Image

WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_IMAGE = WORKSPACE_ROOT / "tests" / "vision" / "CCundinamarca_page_1.png"
FIXTURE_TRUTH = WORKSPACE_ROOT / "tests" / "vision" / "CCundinamarca_page_1.txt"
DEFAULT_OUTPUT = WORKSPACE_ROOT / "data" / "model_capabilities.json"

PROMPT = "Transcribe all printed text in this image. Respond with the transcription only, no commentary."
MAX_SIDE = 1568  # downscale fixture so payloads stay small but text stays legible

REFUSAL_MARKERS = (
    "can't see", "cannot see", "can not see", "unable to see", "unable to view",
    "unable to process images", "unable to analyze images", "cannot process",
    "cannot view", "cannot access or view", "cannot transcribe",
    "no image provided", "no image was provided",
    "don't have the ability to see", "do not have the ability to see",
    "does not support image", "not support image", "image input",
)

# Gateway errors that mean the model itself rejects image input.
ERROR_MARKERS = ("image", "vision", "multimodal", "multi-modal", "modal")


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


def list_models(service_config):
    if service_config.get("models"):
        return list(service_config["models"])
    r = requests.get(api_base(service_config) + "/models", headers=auth(service_config), timeout=30)
    r.raise_for_status()
    return [m["id"] for m in r.json().get("data", [])]


def encode_fixture():
    image = Image.open(FIXTURE_IMAGE).convert("RGB")
    image.thumbnail((MAX_SIDE, MAX_SIDE))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode()


def keywords(text):
    normalized = unicodedata.normalize("NFKD", text.upper()).encode("ASCII", "ignore").decode()
    return {w for w in re.findall(r"[A-Z0-9]+", normalized) if len(w) >= 4}


def check_vision(service_config, model, data_uri, expected):
    try:
        r = requests.post(
            api_base(service_config) + "/chat/completions",
            headers={**auth(service_config), "Content-Type": "application/json"},
            json={
                "model": model,
                "max_tokens": 2048,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": PROMPT},
                        {"type": "image_url", "image_url": {"url": data_uri}},
                    ],
                }],
            },
            timeout=240,
        )
    except requests.RequestException as e:
        return {"vision": None, "status": "error", "note": f"request failed: {e}"}

    if r.status_code != 200:
        lowered = r.text.lower()
        if any(marker in lowered for marker in ERROR_MARKERS):
            return {"vision": False, "status": "rejects",
                    "note": f"HTTP {r.status_code}: {r.text.strip()[:160]}"}
        return {"vision": None, "status": "error",
                "note": f"HTTP {r.status_code}: {r.text.strip()[:160]}"}
    body = r.json()
    if body.get("error"):
        err_text = json.dumps(body["error"])
        if any(marker in err_text.lower() for marker in ERROR_MARKERS):
            return {"vision": False, "status": "rejects",
                    "note": f"API error: {err_text[:160]}"}
        return {"vision": None, "status": "error",
                "note": f"API error: {err_text[:160]}"}

    message = (body.get("choices") or [{}])[0].get("message", {})
    text = " ".join(str(v) for v in (message.get("content"), message.get("reasoning_content")) if v)
    if any(marker in text.lower() for marker in REFUSAL_MARKERS):
        return {"vision": False, "status": "rejects",
                "note": f"model says it cannot see images: {text.strip()[:160]}"}

    matched = sorted(expected & keywords(text))
    total = sum(min(len(w), 8) for w in expected)
    got = sum(min(len(w), 8) for w in matched)
    coverage = got / total if total else 0
    if coverage >= 0.7:
        return {"vision": True, "status": "sees",
                "note": f"matched {len(matched)}/{len(expected)} keywords ({coverage:.0%} char coverage)"}
    return {"vision": False, "status": "hallucinates",
            "note": f"matched {len(matched)}/{len(expected)} ({coverage:.0%} char coverage); "
                    f"answer: {text.strip()[:160]}"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--services", nargs="*", default=None)
    parser.add_argument("--models", nargs="*", default=None,
                        help="Limit to these model names (default: all)")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()

    services = load_services()
    if args.services:
        services = {k: v for k, v in services.items() if k in args.services}

    data_uri = encode_fixture()
    expected = keywords(FIXTURE_TRUTH.read_text(encoding="utf-8"))

    targets = []
    for service, service_config in services.items():
        if not service_config.get("key"):
            print(f"[!] {service}: no API key, skipping")
            continue
        try:
            models = list_models(service_config)
        except Exception as e:
            print(f"[!] {service}: could not list models: {e}")
            continue
        if args.models:
            models = [m for m in models if m in args.models]
        targets.extend((service, service_config, m) for m in models)

    print(f"Probing {len(targets)} model(s) with {FIXTURE_IMAGE.name}...")
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(check_vision, cfg, m, data_uri, expected): (s, m)
                   for s, cfg, m in targets}
        for future in concurrent.futures.as_completed(futures):
            service, model = futures[future]
            verdict = future.result()
            print(f"  [{verdict['status']:^12}] {service}/{model}  ({verdict['note']})")
            results.append({
                "service": service,
                "model": model,
                "tools": {
                    "vision": verdict["vision"],
                    "web_search": False,
                    "agent": False,
                    "image_generation": False,
                    "video_generation": False,
                },
                "status": verdict["status"],
                "note": verdict["note"],
            })

    order = {s: i for i, s in enumerate(services)}
    results.sort(key=lambda r: (order[r["service"]], r["model"]))
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fixture": f"tests/vision/{FIXTURE_IMAGE.name}",
        "description": "Model tool capabilities. Only 'vision' is probed (fixture "
                       "transcription test); other tools are placeholders (false). "
                       "Benchmark scripts should skip a model when a required tool "
                       "is not true.",
        "models": results,
    }, indent=2) + "\n")
    print(f"Wrote {output_path} ({len(results)} models)")


if __name__ == "__main__":
    sys.exit(main())
