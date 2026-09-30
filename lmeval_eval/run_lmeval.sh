#!/usr/bin/env bash
#
# run_lmeval.sh — run lm-evaluation-harness against the services listed in
# config.py (every service with a `models` roster).
#
# Tasks: MMLU (5-shot), GSM8K (5-shot), ARC-Challenge (25-shot),
#        HellaSwag (10-shot), WinoGrande (5-shot), TruthfulQA MC2 (6-shot)
# Model type: openai-chat-completions (all providers expose OpenAI-compat chat)
#
# Output goes to logs/lmeval/<YYYY-MM-DD>/<SVC>/<model>/ as JSON files.
# Smoke outputs go to logs/lmeval/_smoke/.
#
# The model roster and base URLs are read from config.py — edit models there,
# not here. --service validates against the same roster (case-insensitive).
#
# Smoke test (cheap, ~10 samples per task):
#   ./lmeval_eval/run_lmeval.sh --service CIT --model gemma-4-31b --limit 10
#
# Full batch:
#   ./lmeval_eval/run_lmeval.sh
#
# Dry run (print commands only):
#   ./lmeval_eval/run_lmeval.sh --dry-run
#
# Flags:
#   --service NAME     run only one service (must be in config.py)
#   --model NAME       run only one model (exact config.py name)
#   --tasks TASKS      override lm-eval task list (comma-separated)
#   --limit N          cap samples per task (smoke tests)
#   --log-dir DIR      override output directory
#   --dry-run          print commands without running anything
#
# Required env (repo-root .env, never echoed): CIT_KEY, GRIT_KEY,
# AICOMMONS_KEY, NRP_KEY.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CONFIG_PY="$REPO_ROOT/config.py"
if [[ ! -f "$CONFIG_PY" ]]; then
  echo "error: config.py not found at $CONFIG_PY" >&2; exit 1
fi

LOG_DIR_SMOKE="logs/lmeval/_smoke"

SERVICE_FILTER=""
MODEL_FILTER=""
TASKS="mmlu,gsm8k,arc_challenge,hellaswag,winogrande,truthfulqa_mc2"
LIMIT=""
LOG_DIR_OVERRIDE=""
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
    --tasks) TASKS="${2:?--tasks needs a value}"; shift 2 ;;
    --tasks=*) TASKS="${1#--tasks=}"; shift ;;
    --limit) LIMIT="${2:?--limit needs a value}"; shift 2 ;;
    --limit=*) LIMIT="${1#--limit=}"; shift ;;
    --log-dir) LOG_DIR_OVERRIDE="${2:?--log-dir needs a value}"; shift 2 ;;
    --log-dir=*) LOG_DIR_OVERRIDE="${1#--log-dir=}"; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown arg '$1'" >&2; usage >&2; exit 2 ;;
  esac
done

# Load env vars (API keys)
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a; source "$REPO_ROOT/.env"; set +a
fi

# Read roster from config.py
export _LMEVAL_CONFIG_DIR="$REPO_ROOT"
export _LMEVAL_SERVICE_FILTER="$SERVICE_FILTER"
export _LMEVAL_MODEL_FILTER="$MODEL_FILTER"
ROSTER_TSV="$(uv run python - <<'PY'
import os
import sys

sys.path.insert(0, os.environ["_LMEVAL_CONFIG_DIR"])
from config import SERVICES

svc_filter = os.environ.get("_LMEVAL_SERVICE_FILTER", "")
model_filter = os.environ.get("_LMEVAL_MODEL_FILTER", "")
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
    key_var = f"{name.upper()}_KEY"
    print(f"KEY\t{name}\t{key_var}")
    for model in info["models"]:
        if model_filter and model != model_filter:
            continue
        print(f"PAIR\t{name}\t{model}")
PY
)"
declare -A BASE_URL_FOR=()
declare -A KEY_VAR_FOR=()
SERVICES=()
pairs=()
while IFS=$'\t' read -r kind col_a col_b; do
  case "$kind" in
    URL) BASE_URL_FOR["$col_a"]="$col_b"; SERVICES+=("$col_a") ;;
    KEY) KEY_VAR_FOR["$col_a"]="$col_b" ;;
    PAIR) pairs+=("$col_a|$col_b") ;;
  esac
done <<< "$ROSTER_TSV"
if [[ "${#SERVICES[@]}" == "0" ]]; then
  echo "error: no services with a models roster in config.py" >&2; exit 2
fi
if [[ "${#pairs[@]}" == "0" ]]; then
  echo "error: no models selected (check --service/--model against config.py)" >&2; exit 2
fi
if [[ -n "$LIMIT" ]] && ! [[ "$LIMIT" =~ ^[0-9]+$ ]]; then
  echo "error: --limit must be an integer" >&2; exit 2
fi

SMOKE=0
if [[ -n "$LIMIT" ]]; then SMOKE=1; fi
if [[ "$SMOKE" == "1" ]]; then
  LOG_DIR="$LOG_DIR_SMOKE"
elif [[ -n "$LOG_DIR_OVERRIDE" ]]; then
  LOG_DIR="$LOG_DIR_OVERRIDE"
else
  LOG_DIR="logs/lmeval/$(date +%Y-%m-%d)"
fi

echo "tasks=$TASKS log_dir=$LOG_DIR runs=${#pairs[@]}"
if [[ "$DRY_RUN" == "1" ]]; then echo "(dry run — commands only)"; fi

# Validate API keys (non-dry-run)
if [[ "$DRY_RUN" == "0" ]]; then
  for svc in "${SERVICES[@]}"; do
    key_var="${KEY_VAR_FOR[$svc]}"
    if [[ -z "${!key_var:-}" ]]; then
      echo "error: ${key_var} is empty (check repo-root .env)" >&2; exit 1
    fi
  done
fi

failures=()
n=0
for pair in "${pairs[@]}"; do
  svc="${pair%%|*}"
  model="${pair#*|}"
  svc_upper="$(to_upper "$svc")"
  n=$((n + 1))

  key_var="${KEY_VAR_FOR[$svc]}"
  api_key="${!key_var:-}"
  base_url="${BASE_URL_FOR[$svc]}"
  output_path="$LOG_DIR/$svc_upper/$model"

  cmd=(uv run lm_eval
    --model openai-chat-completions
    --model_args "model=$model,base_url=$base_url,api_key=$api_key,num_concurrent=4"
    --tasks "$TASKS"
    --output_path "$output_path"
    --log_samples)

  if [[ -n "$LIMIT" ]]; then
    cmd+=(--limit "$LIMIT")
  fi

  echo "[$n/${#pairs[@]}] $svc_upper $model"
  if [[ "$DRY_RUN" == "1" ]]; then
    # Redact the API key in dry-run output
    safe_args="model=$model,base_url=$base_url,api_key=env://${key_var},num_concurrent=4"
    safe_cmd=(uv run lm_eval
      --model openai-chat-completions
      --model_args "$safe_args"
      --tasks "$TASKS"
      --output_path "$output_path"
      --log_samples)
    if [[ -n "$LIMIT" ]]; then
      safe_cmd+=(--limit "$LIMIT")
    fi
    printf '  %q' "${safe_cmd[@]}"; printf '\n'
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
