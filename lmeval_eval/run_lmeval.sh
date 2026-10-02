#!/usr/bin/env bash
#
# run_lmeval.sh — run lm-evaluation-harness against the services listed in
# config.py (every service with a `models` roster).
#
# Tasks: MMLU (5-shot), GSM8K (5-shot), ARC-Challenge (25-shot),
#        HellaSwag (10-shot), WinoGrande (5-shot), TruthfulQA MC2 (6-shot)
# Model type: local-completions (remote OpenAI-compatible `/v1/completions`).
#   5 of the 6 tasks are `multiple_choice` and require `loglikelihood`, which
#   `local-completions` supports but `*chat-completions` does not. See
#   lmeval_eval/README.md for the Phase 0 gateway probe results.
#
# Output goes to logs/lmeval/<YYYY-MM-DD>/<SVC>/<model>/ as JSON files.
# Smoke outputs go to logs/lmeval/_smoke/.
#
# The model roster and base URLs are read from config.py — edit models there,
# not here. --service validates against the same roster (case-insensitive).
# The auth token is exported as OPENAI_API_KEY per (service, model) and is
# never placed in argv or --model_args.
#
# Tokenizers: none of the gateways expose /tokenizer_info, so a Hugging Face
# tokenizer must be supplied via --tokenizer or --tokenizer-map. For smoke runs
# (--limit) an unmapped model falls back to a generic tokenizer whose scores
# are non-comparable; full runs refuse to guess.
#
# Smoke test (cheap, ~10 samples per task):
#   ./lmeval_eval/run_lmeval.sh --service NRP --model gemma-small --limit 10 \
#       --tokenizer google/gemma-2-2b
#
# Full batch:
#   ./lmeval_eval/run_lmeval.sh
#
# Dry run (print commands only):
#   ./lmeval_eval/run_lmeval.sh --dry-run
#
# Flags:
#   --service NAME       run only one service (must be in config.py)
#   --model NAME         run only one model (exact config.py name)
#   --tasks TASKS        override lm-eval task list (comma-separated)
#   --limit N            cap samples per task (smoke tests)
#   --log-dir DIR        override output directory
#   --model-type TYPE    lm-eval model type (only local-completions is enabled)
#   --tokenizer ID       HF tokenizer id for every model in this run
#   --tokenizer-map FILE JSON map of "SVC/model" or "model" -> HF tokenizer id
#   --num-concurrent N   concurrent API requests (default 4)
#   --timeout SECONDS    per-request timeout (lm-eval default 300)
#   --dry-run            print commands without running anything
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
DEFAULT_GENERIC_TOKENIZER="${LMEVAL_GENERIC_TOKENIZER:-gpt2}"

SERVICE_FILTER=""
MODEL_FILTER=""
TASKS="mmlu,gsm8k,arc_challenge,hellaswag,winogrande,truthfulqa_mc2"
LIMIT=""
LOG_DIR_OVERRIDE=""
MODEL_TYPE="local-completions"
TOKENIZER=""
TOKENIZER_MAP=""
TIMEOUT=""
NUM_CONCURRENT="4"
DRY_RUN=0

usage() {
  sed -n '2,/^set /p' "$0" | sed 's/^# \{0,1\}//'
}

to_upper() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]'; }
to_lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# Idempotently build the OpenAI-compatible completions URL. config.py stores
# the `/v1` (or `/api/v1`) prefix, but `TemplateAPI.model_call` POSTs to
# `base_url` verbatim, so the endpoint must include `/completions`.
join_completions() {
  local url="${1%/}"
  if [[ "$url" == */completions ]]; then
    printf '%s' "$url"
  else
    printf '%s/completions' "$url"
  fi
}

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
    --model-type) MODEL_TYPE="${2:?--model-type needs a value}"; shift 2 ;;
    --model-type=*) MODEL_TYPE="${1#--model-type=}"; shift ;;
    --tokenizer) TOKENIZER="${2:?--tokenizer needs a value}"; shift 2 ;;
    --tokenizer=*) TOKENIZER="${1#--tokenizer=}"; shift ;;
    --tokenizer-map) TOKENIZER_MAP="${2:?--tokenizer-map needs a value}"; shift 2 ;;
    --tokenizer-map=*) TOKENIZER_MAP="${1#--tokenizer-map=}"; shift ;;
    --num-concurrent) NUM_CONCURRENT="${2:?--num-concurrent needs a value}"; shift 2 ;;
    --num-concurrent=*) NUM_CONCURRENT="${1#--num-concurrent=}"; shift ;;
    --timeout) TIMEOUT="${2:?--timeout needs a value}"; shift 2 ;;
    --timeout=*) TIMEOUT="${1#--timeout=}"; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown arg '$1'" >&2; usage >&2; exit 2 ;;
  esac
done

# Only the completions model type supports the `loglikelihood` tasks in this
# suite. Phase 0 (see lmeval_eval/README.md) confirmed GRIT and AICommons
# expose chat-only routes, so they are expected to fail here until a separate
# generative-task decision is made.
if [[ "$MODEL_TYPE" != "local-completions" ]]; then
  echo "error: --model-type '$MODEL_TYPE' is not enabled; only 'local-completions' is supported." >&2
  echo "       Phase 0: GRIT/AICommons expose chat-only routes; openai-* do not support loglikelihood." >&2
  exit 2
fi
if [[ -n "$TIMEOUT" ]] && ! [[ "$TIMEOUT" =~ ^[0-9]+$ ]]; then
  echo "error: --timeout must be an integer (seconds)" >&2; exit 2
fi
if ! [[ "$NUM_CONCURRENT" =~ ^[0-9]+$ ]] || [[ "$NUM_CONCURRENT" -lt 1 ]]; then
  echo "error: --num-concurrent must be a positive integer" >&2; exit 2
fi
if [[ -n "$TOKENIZER_MAP" && ! -f "$TOKENIZER_MAP" ]]; then
  echo "error: --tokenizer-map file not found: $TOKENIZER_MAP" >&2; exit 2
fi

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

# Optional per-(service, model) tokenizer map. Accepts either
#   {"NRP/gemma-small": "google/gemma-2-2b", "qwen3": "Qwen/Qwen3-8B"}
# or {"tokenizers": { ... }}. Keys are matched case-insensitively; a
# "service/model" key wins over a bare "model" key.
declare -A TOKENIZER_MAP_ENTRIES=()
if [[ -n "$TOKENIZER_MAP" ]]; then
  while IFS=$'\t' read -r map_key map_val; do
    [[ -n "$map_key" ]] && TOKENIZER_MAP_ENTRIES["$map_key"]="$map_val"
  done < <(uv run python - "$TOKENIZER_MAP" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
if isinstance(data, dict) and isinstance(data.get("tokenizers"), dict):
    data = data["tokenizers"]
if not isinstance(data, dict):
    sys.exit(f"error: tokenizer map must be a JSON object: {sys.argv[1]}")
for key, value in data.items():
    key = str(key).strip().lower()
    if not key:
        continue
    prefix = "svc:" if "/" in key else "model:"
    print(f"{prefix}{key}\t{value}")
PY
)
fi

resolve_tokenizer() {
  local svc="$1" model="$2"
  if [[ -n "$TOKENIZER" ]]; then
    printf '%s' "$TOKENIZER"; return
  fi
  local svc_key="svc:$(to_lower "$svc")/$(to_lower "$model")"
  local model_key="model:$(to_lower "$model")"
  if [[ -n "${TOKENIZER_MAP_ENTRIES[$svc_key]:-}" ]]; then
    printf '%s' "${TOKENIZER_MAP_ENTRIES[$svc_key]}"; return
  fi
  if [[ -n "${TOKENIZER_MAP_ENTRIES[$model_key]:-}" ]]; then
    printf '%s' "${TOKENIZER_MAP_ENTRIES[$model_key]}"; return
  fi
  printf ''
}

# Build --model_args. Auth is deliberately absent: LocalCompletionsAPI reads
# OPENAI_API_KEY from the environment. `tokenized_requests=false` makes lm-eval
# send text prompts (the ellm/vLLM gateways reject token-id arrays). When a
# tokenizer is known we pin the huggingface backend to skip the remote-tokenizer
# probe (none of the Phase 0 gateways expose /tokenizer_info).
build_model_args() {
  local model="$1" joined_url="$2" tok="$3"
  local args="model=$model,base_url=$joined_url"
  args+=",num_concurrent=$NUM_CONCURRENT,tokenized_requests=false"
  if [[ -n "$tok" ]]; then
    args+=",tokenizer_backend=huggingface,tokenizer=$tok"
  else
    args+=",tokenizer_backend=auto"
  fi
  if [[ -n "$TIMEOUT" ]]; then
    args+=",timeout=$TIMEOUT"
  fi
  printf '%s' "$args"
}

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
  base_url="$(join_completions "${BASE_URL_FOR[$svc]}")"
  # A `.json` output path makes lm-eval write `results_<date>.json` /
  # `samples_<task>_<date>.jsonl` directly into <SVC>/<model>/ instead of
  # appending a sanitized model dir. Keep the stem `results`.
  output_path="$LOG_DIR/$svc_upper/$model/results.json"

  tokenizer="$(resolve_tokenizer "$svc" "$model")"
  if [[ -z "$tokenizer" ]]; then
    if [[ "$SMOKE" == "1" ]]; then
      tokenizer="$DEFAULT_GENERIC_TOKENIZER"
      echo "  note: no tokenizer configured for $svc/$model; using generic '$tokenizer' for smoke (scores non-comparable)" >&2
    else
      echo "  warning: no tokenizer for $svc/$model; gateway tokenizers are unavailable, so this run will likely fail. Pass --tokenizer or --tokenizer-map." >&2
    fi
  fi

  model_args="$(build_model_args "$model" "$base_url" "$tokenizer")"

  cmd=(uv run lm_eval
    --model "$MODEL_TYPE"
    --model_args "$model_args"
    --tasks "$TASKS"
    --output_path "$output_path"
    --log_samples)

  if [[ -n "$LIMIT" ]]; then
    cmd+=(--limit "$LIMIT")
  fi

  echo "[$n/${#pairs[@]}] $svc_upper $model"
  if [[ "$DRY_RUN" == "1" ]]; then
    # model_args never contains the secret; show the env-var source explicitly.
    printf '  OPENAI_API_KEY=env://%s' "$key_var"
    printf ' %q' "${cmd[@]}"; printf '\n'
    continue
  fi
  # Export per (service, model) so each gateway overrides the previous key;
  # the secret never appears in argv or --model_args. lm-eval logs request
  # headers on failure, so redact credentials from the stream as well.
  export OPENAI_API_KEY="$api_key"
  set +e
  "${cmd[@]}" 2>&1 | sed -E \
    -e 's/([Bb]earer[[:space:]]+)[A-Za-z0-9._-]+/\1***/g' \
    -e 's/sk-[A-Za-z0-9._-]{16,}/sk-***/g'
  rc="${PIPESTATUS[0]}"
  set -e
  if [[ "$rc" -eq 0 ]]; then
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
