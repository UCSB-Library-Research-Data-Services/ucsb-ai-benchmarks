# UCSB AI Benchmarks

Tools and benchmark suites for evaluating AI models available through UCSB services. The repository runs performance, RISE, SciCode, and lm-evaluation-harness workloads, collects results under `data/`, and includes an [Astro](https://astro.build/) dashboard.

## Requirements

- Python 3.14 or newer and [uv](https://docs.astral.sh/uv/)
- Node.js 22.12 or newer and npm (for the dashboard)
- Credentials for the model services you plan to use

## Setup

```sh
uv sync
```

Create a `.env` file in the repository root and set the credentials needed by your service. The currently configured environment variable names are `CIT_KEY`, `GRIT_KEY`, `AICOMMONS_KEY`, and `NRP_KEY`. The available services and model roster are defined in `config.py`.

## Run benchmarks

```sh
uv run bench list
uv run bench run performance --service GRIT --model llava:7b
```

Available suites are `performance`, `rise`, `scicode`, and `lmeval`. Use `--smoke` for a smaller test run, `--dry-run` to print the command without running it, or `uv run bench --help` for CLI options. Runs are logged under `logs/`; collected results are written under `data/`.

## Dashboard

```sh
cd dashboard
npm install
npm run dev
```

To build the dashboard, run `npm run build` from `dashboard/` or `uv run bench build` from the repository root.
