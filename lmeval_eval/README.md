# lmeval_eval

Run the [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness)
against the remote gateways in `config.py` and collect scores for the dashboard.

## Model type: `local-completions`

The suite runs the Open LLM Leaderboard task set:

```
mmlu,gsm8k,arc_challenge,hellaswag,winogrande,truthfulqa_mc2
```

Five of the six are `multiple_choice` and require `loglikelihood`. The harness
only implements `loglikelihood` for the **completions** API:

| model type | `loglikelihood` | usable here |
|---|---|---|
| `openai-chat-completions` / `local-chat-completions` | raises `NotImplementedError` | no |
| `openai-completions` | asserts `model in [babbage-002, davinci-002]` | no |
| `local-completions` | supported | **yes** |

`local-completions` does **not** mean local execution: it is the harness name for
"POST to a remote OpenAI-compatible `/v1/completions` endpoint". Requests still
use the same `config.py` URLs and keys (researcher-faithful).

## Gateway probe (Phase 0)

Probed `{url}/completions` with a roster model and the service key:

| Service | `/v1/completions` | prompt shapes | remote tokenizer |
|---|---|---|---|
| CIT | 200, logprobs present | string ok, token arrays rejected | no `/tokenizer_info` |
| NRP (`ellm`) | 200, logprobs present | string only | no `/tokenizer_info` |
| GRIT | 405 | — | no |
| AICommons | 404 | — | no |

Consequences:

- `tokenized_requests=false` is passed so lm-eval sends text, not token ids.
- GRIT and AICommons expose chat-only routes; they are expected to fail here
  until a separate generative-task decision is made (`--model-type` rejects
  anything but `local-completions`).
- No gateway exposes `/tokenizer_info`, so `tokenizer_backend=auto` would fall
  back to a Hugging Face tokenizer and fail on gateway aliases (`gemma-small`,
  `qwen3`, ...). A tokenizer must be supplied.

## Auth

- The service key is exported as `OPENAI_API_KEY` per `(service, model)` and is
  never placed in argv or `--model_args`.
- `bench/runner.py` redacts `Bearer ...` / `sk-...` in streamed output so request
  errors cannot leak the key into `logs/bench-*.log`.
- Dry runs show `OPENAI_API_KEY=env://<KEY_VAR>` instead of the value.

## Tokenizers

Scores depend on the tokenizer matching the served model. Provide one with:

- `--tokenizer ID` — one HF tokenizer id for every model in the run, or
- `--tokenizer-map FILE` — JSON mapping `"SVC/model"` or `"model"` to an HF id:

  ```json
  {"NRP/gemma-small": "google/gemma-2-2b", "qwen3": "Qwen/Qwen3-8B"}
  ```

For smoke runs (`--limit`) an unmapped model falls back to a generic tokenizer
(`gpt2`, override with `LMEVAL_GENERIC_TOKENIZER`) and the scores are **not
comparable**. Full runs without a tokenizer warn and are expected to fail.
Getting canonical HF ids for the gateway aliases is tracked as an open question;
do not guess mappings in code.

## Usage

```bash
# smoke (10 samples/task) with the correct tokenizer
./lmeval_eval/run_lmeval.sh --service NRP --model gemma-small --limit 10 \
    --tokenizer google/gemma-2-2b

# dry run: prints argv, no secrets
./lmeval_eval/run_lmeval.sh --service NRP --model gemma-small --limit 2 --dry-run

# full batch from config.py
./lmeval_eval/run_lmeval.sh

# via the bench wrapper (auto-collects)
bench run lmeval --service NRP --model gemma-small --smoke
bench collect lmeval
```

Other flags: `--tasks`, `--log-dir`, `--num-concurrent` (default 4), `--timeout`
(seconds), `--model-type`.

Output layout (exactly what the collector and dashboard expect):

```
logs/lmeval/<date>/<SVC>/<model>/results_<timestamp>.json
logs/lmeval/_smoke/<SVC>/<model>/results_<timestamp>.json
```

## Collector

`collect_lmeval_results.py` walks `logs/lmeval/` (skipping `_smoke` unless
`--log-dir` points at it), derives `(service, model)` from the last two path
components, and writes `data/lmeval_results.jsonl`. Primary metric keys live in
`TASK_METRICS` and must stay in sync with `dashboard/src/lib/lmeval.ts`
(`TASK_PRIMARY_METRIC`). `truthfulqa_mc2` reports its score under `acc`.
