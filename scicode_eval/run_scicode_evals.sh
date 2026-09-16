#!/usr/bin/env bash
#
# run_scicode_evals.sh — fresh SciCode eval batch over the services listed in
# config.py (every service with a `models` roster; services without
# one, e.g. dreamlab, are skipped).
#
# Default (full batch): test split (65 problems), with_background=True,
# temperature 0, one `inspect eval` per (service, model).
# Logs go to logs/scicode/<today>-fresh (override with --log-dir);
# outputs to tmp/scicode/<SVC>/<model>.
#
# The model roster and base URLs are read from config.py — edit models there,
# not here. --service validates against the same roster (case-insensitive).
#
# Smoke tests (do these BEFORE the full batch):
#   1. Gold sanity, no LLM cost (~100% expected, validates scorer + env):
#        uv run inspect eval scicode_eval/scicode.py --model mockllm/mockllm \
#          -T split=validation -T mode=gold -T with_background=True \
#          -T output_dir=tmp/scicode/_smoke_gold --log-dir logs/scicode/_smoke
#   2. One real model per service (verifies endpoint + auth):
#        ./scicode_eval/run_scicode_evals.sh --service CIT --model gemma-4-31b \
#          --split validation --limit 2
#
#   Use --dry-run to list the full roster (models come from config.py):
#        ./scicode_eval/run_scicode_evals.sh --dry-run
#
# Flags:
#   --service NAME                   run only one service (must be in config.py)
#   --model NAME                     run only one model (exact config.py name)
#   --split test|validation        task split (default: test)
#   --limit N                      pass --limit N to `inspect eval` (smoke tests)
#   --max-tokens N                 override default max tokens (default 32784;
#                                amazon-nova-* auto-capped to 8000 — gateway
#                                rejects >10000)
#   --log-dir DIR                  override full-batch log dir
#                                (default: logs/scicode/<today>-fresh, today's date)
#   --dry-run                      print commands without running anything
#
# Smoke hygiene: any run with --limit or --split != test writes to
# tmp/scicode/_smoke/<SVC>/<model> and logs/scicode/_smoke, and never archives
# tmp/scicode, so partial outputs and validation rows can't contaminate the
# fresh batch (the scorer caches per-step pass/fail under the output dir).
# Full-batch runs archive tmp/scicode/<SVC> to tmp/scicode/_archive_<date>/ first.
#
# Required env (repo-root .env, never echoed): CIT_KEY, GRIT_KEY, AICOMMONS_KEY.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CONFIG_PY="$REPO_ROOT/config.py"
if [[ ! -f "$CONFIG_PY" ]]; then
  echo "error: config.py not found at $CONFIG_PY" >&2; exit 1
fi

LOG_DIR_SMOKE="logs/scicode/_smoke"
OUT_BASE_FULL="tmp/scicode"
OUT_BASE_SMOKE="tmp/scicode/_smoke"

SERVICE_FILTER=""
MODEL_FILTER=""
MAX_TOKENS=""
LOG_DIR_OVERRIDE=""
SPLIT="test"
LIMIT=""
DRY_RUN=0

usage() {
  sed -n '2,/^set /p' "$0" | sed 's/^# \{0,1\}//'
}

to_upper() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]'; }
to_lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service) SERVICE_FILTER="$(to_upper "${2:?--service needs a value}")"; shift 2 ;;
    --service=*) SERVICE_FILTER="$(to_upper "${1#--service=}")"; shift ;;
    --model) MODEL_FILTER="${2:?--model needs a value}"; shift 2 ;;
    --model=*) MODEL_FILTER="${1#--model=}"; shift ;;
    --split) SPLIT="${2:?--split needs a value}"; shift 2 ;;
    --split=*) SPLIT="${1#--split=}"; shift ;;
    --limit) LIMIT="${2:?--limit needs a value}"; shift 2 ;;
    --limit=*) LIMIT="${1#--limit=}"; shift ;;
    --max-tokens) MAX_TOKENS="${2:?--max-tokens needs a value}"; shift 2 ;;
    --max-tokens=*) MAX_TOKENS="${1#--max-tokens=}"; shift ;;
    --log-dir) LOG_DIR_OVERRIDE="${2:?--log-dir needs a value}"; shift 2 ;;
    --log-dir=*) LOG_DIR_OVERRIDE="${1#--log-dir=}"; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown arg '$1'" >&2; usage >&2; exit 2 ;;
  esac
done

# Run env: single repo-root uv venv (scorer subprocess calls plain `python`,
# which needs h5py/numpy/scipy/sympy + importable `scicode` from that venv).
# Every python/inspect invocation below goes through `uv run` so PATH puts
# .venv/bin/python first. The roster lookup needs `dotenv` (present in the
# main venv).
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a; source "$REPO_ROOT/.env"; set +a
fi

export _SCICODE_CONFIG_DIR="$REPO_ROOT"
export _SCICODE_SERVICE_FILTER="$SERVICE_FILTER"
export _SCICODE_MODEL_FILTER="$MODEL_FILTER"
ROSTER_TSV="$(uv run python - <<'PY'
import os
import sys

sys.path.insert(0, os.environ["_SCICODE_CONFIG_DIR"])
from config import SERVICES

svc_filter = os.environ.get("_SCICODE_SERVICE_FILTER", "")
model_filter = os.environ.get("_SCICODE_MODEL_FILTER", "")
roster = [(name, info) for name, info in SERVICES.items() if info.get("models")]
if svc_filter:
    want = svc_filter.lower()
    if not any(name.lower() == want for name, _ in roster):
        avail = sorted(name for name, _ in roster)
        print(
            f"error: --service '{svc_filter}' not in config.py "
            f"(available: {', '.join(avail)})",
            file=sys.stderr,
        )
        sys.exit(2)
    roster = [(name, info) for name, info in roster if name.lower() == want]
for name, info in roster:
    print(f"URL\t{name}\t{info['url']}")
    for model in info["models"]:
        if model_filter and model != model_filter:
            continue
        print(f"PAIR\t{name}\t{model}")
PY
)"
declare -A BASE_URL_FOR=()
SERVICES=()
pairs=()
while IFS=$'\t' read -r kind col_a col_b; do
  case "$kind" in
    URL) BASE_URL_FOR["$col_a"]="$col_b"; SERVICES+=("$col_a") ;;
    PAIR) pairs+=("$col_a|$col_b") ;;
  esac
done <<< "$ROSTER_TSV"
if [[ "${#SERVICES[@]}" == "0" ]]; then
  echo "error: no services with a models roster in config.py" >&2; exit 2
fi
if [[ "${#pairs[@]}" == "0" ]]; then
  echo "error: no models selected (check --service/--model against config.py)" >&2; exit 2
fi
case "$SPLIT" in
  test|validation) ;;
  *) echo "error: --split must be test or validation" >&2; exit 2 ;;
esac
if [[ -n "$LIMIT" ]] && ! [[ "$LIMIT" =~ ^[0-9]+$ ]]; then
  echo "error: --limit must be an integer" >&2; exit 2
fi
if [[ -n "$MAX_TOKENS" ]] && ! [[ "$MAX_TOKENS" =~ ^[0-9]+$ ]]; then
  echo "error: --max-tokens must be an integer" >&2; exit 2
fi

SMOKE=0
if [[ -n "$LIMIT" || "$SPLIT" != "test" ]]; then SMOKE=1; fi
if [[ "$SMOKE" == "1" ]]; then
  LOG_DIR="$LOG_DIR_SMOKE"; OUT_BASE="$OUT_BASE_SMOKE"
elif [[ -n "$LOG_DIR_OVERRIDE" ]]; then
  LOG_DIR="$LOG_DIR_OVERRIDE"; OUT_BASE="$OUT_BASE_FULL"
else
  LOG_DIR="logs/scicode/$(date +%Y-%m-%d)-fresh"; OUT_BASE="$OUT_BASE_FULL"
fi

# Export per-service creds for the openai-api provider
# (<SERVICE>_API_KEY / <SERVICE>_BASE_URL from config.py). Never printed.
if [[ "$DRY_RUN" == "0" ]]; then
  for svc in "${SERVICES[@]}"; do
    key_var="$(to_upper "$svc")_KEY"
    if [[ -z "${!key_var:-}" ]]; then
      echo "error: ${key_var} is empty (check repo-root .env)" >&2; exit 1
    fi
    export "$(to_upper "$svc")_API_KEY=${!key_var}"
    export "$(to_upper "$svc")_BASE_URL=${BASE_URL_FOR[$svc]}"
  done
fi

echo "split=$SPLIT with_background=True mode=normal log_dir=$LOG_DIR out_base=$OUT_BASE runs=${#pairs[@]}"
if [[ "$DRY_RUN" == "1" ]]; then echo "(dry run — commands only)"; fi

# Full-run hygiene: archive previous tmp/scicode/<SVC> before a full-service batch.
if [[ "$SMOKE" == "0" && -z "$MODEL_FILTER" && "$DRY_RUN" == "0" ]]; then
  TODAY="$(date +%Y-%m-%d)"
  for svc in "${SERVICES[@]}"; do
    dir="tmp/scicode/$(to_upper "$svc")"
    if [[ -d "$dir" ]]; then
      mkdir -p "tmp/scicode/_archive_$TODAY"
      dest="tmp/scicode/_archive_$TODAY/$(to_upper "$svc")"
      if [[ -e "$dest" ]]; then dest="${dest}_$(date +%H%M%S)"; fi
      mv "$dir" "$dest"
      echo "archived $dir -> $dest"
    fi
  done
fi

failures=()
n=0
for pair in "${pairs[@]}"; do
  svc="${pair%%|*}"
  model="${pair#*|}"
  svc_lower="$(to_lower "$svc")"
  svc_upper="$(to_upper "$svc")"
  n=$((n + 1))
  max_tokens="$MAX_TOKENS"
  if [[ -z "$max_tokens" && "$model" == amazon-nova-* ]]; then max_tokens=8000; fi
  if [[ -z "$max_tokens" ]]; then max_tokens=32784; fi
  cmd=(uv run inspect eval scicode_eval/scicode.py
    --model "openai-api/${svc_lower}/${model}"
    --temperature 0 --max-connections 4 --max-tokens "$max_tokens"
    --log-dir "$LOG_DIR")
  if [[ -n "$LIMIT" ]]; then cmd+=(--limit "$LIMIT"); fi
  cmd+=(-T "split=$SPLIT" -T with_background=True -T mode=normal
    -T "output_dir=$OUT_BASE/$svc_upper/$model")
  echo "[$n/${#pairs[@]}] $svc_upper $model"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '  %q' "${cmd[@]}"; printf '\n'
    continue
  fi
  if "${cmd[@]}"; then
    echo "  OK: $svc_upper $model"
  else
    echo "  FAIL: $svc_upper $model (continuing)" >&2
    failures+=("$svc_upper/$model")
  fi
done

echo "---- summary: $((n - ${#failures[@]}))/$n succeeded ----"
if [[ "${#failures[@]}" -gt 0 ]]; then
  printf 'failed:\n  %s\n' "${failures[@]}" >&2
  exit 1
fi
