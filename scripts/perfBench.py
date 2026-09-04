import sys
import time
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path
from openai import OpenAI
import tiktoken
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict

# Load configurations
workspace_root = Path(__file__).resolve().parent.parent
config_file_path = workspace_root / "config.py"

try:
    import importlib.util
    spec = importlib.util.spec_from_file_location("config", str(config_file_path))
    config_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(config_module)
    SERVICES = config_module.SERVICES
except Exception as e:
    print(f"[-] Error: Could not load SERVICES from config.py at {config_file_path}: {e}")
    sys.exit(1)

# Helper for counting tokens using tiktoken
# Note: tiktoken is designed for OpenAI models (GPT-3.5, GPT-4, etc.)
# If benchmarking models from other vendors, consider using their native tokenizers
def count_tokens(text, model_name):
    """
    Count tokens in text using tiktoken.
    Falls back to cl100k_base encoding if specific model encoding is unavailable.
    """
    try:
        # Try to get encoding for the specific model
        encoding = tiktoken.encoding_for_model(model_name)
    except Exception:
        # Fallback to standard OpenAI encoding
        encoding = tiktoken.get_encoding("cl100k_base")
    return len(encoding.encode(text))

def load_prompts(filepath):
    """
    Loads prompts from a JSONL file.
    """
    prompts = []
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"No file exists in {path.absolute()}")

    try:
        with open(path, "r", encoding="utf-8") as f:
            for line_idx, line in enumerate(f, 1):
                if not line.strip():
                    continue
                try:
                    data = json.loads(line)
                    # Extract prompt text
                    prompt_text = ""
                    if "prompt" in data:
                        prompt_text = data["prompt"]
                    elif "messages" in data and isinstance(data["messages"], list) and len(data["messages"]) > 0:
                        prompt_text = data["messages"][0].get("content", "")

                    if not prompt_text:
                        print(f"[-] Warning: No prompt text found at line {line_idx} in {filepath}. Skipping.")
                        continue

                    prompts.append({
                        "id": data.get("id", f"prompt_{line_idx}"),
                        "category": data.get("category", "general"),
                        "prompt": prompt_text
                    })
                except json.JSONDecodeError as je:
                    print(f"[-] Error decoding JSON on line {line_idx} in {filepath}: {je}")
    except Exception as e:
        print(f"[-] Error reading {filepath}: {e}")

    if not prompts:
        raise ValueError("[*] No valid prompts loaded from JSONL.")

    print(f"[+] Successfully loaded {len(prompts)} prompts from {filepath}.")
    return prompts


def select_prompts(prompts, task_limit=None):
    """
    Return a reduced prompt subset when task-limited mode is requested.
    """
    if task_limit is None:
        return prompts

    if task_limit <= 0:
        raise ValueError("task_limit must be a positive integer")

    if task_limit < len(prompts):
        print(f"[*] Limiting benchmark to first {task_limit} prompt(s) for task mode.")
        return prompts[:task_limit]

    return prompts


def get_remaining_prompts(prompts, service_name, model_name, completed_keys=None):
    """
    Filter out prompts already completed for the same service/model pair.
    """
    if not completed_keys:
        return prompts

    remaining = []
    for prompt in prompts:
        prompt_key = (service_name, model_name, prompt.get("id"))
        if prompt_key in completed_keys:
            continue
        remaining.append(prompt)

    return remaining


def load_existing_results(output_path):
    """
    Load completed results from an existing JSONL file and return the parsed entries.
    """
    if not output_path.exists():
        return []

    results = []
    with open(output_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                results.append(json.loads(line))
            except json.JSONDecodeError as exc:
                print(f"[-] Warning: skipping malformed JSON line in {output_path}: {exc}")

    return results


def get_completed_keys(results):
    """
    Build a set of (service, model, test_id) keys from existing results.
    """
    return {
        (result.get("service"), result.get("model"), result.get("test_id"))
        for result in results
        if result.get("service") and result.get("model") and result.get("test_id") is not None
    }


def partition_results_by_day(existing_results, today_str):
    """
    Partition existing results into other_days_results and same_day_results.
    """
    other_days_results = []
    same_day_results = []
    for r in existing_results:
        ts = r.get("timestamp")
        if ts:
            date_str = ts.split("T")[0]
            if date_str != today_str:
                other_days_results.append(r)
            else:
                same_day_results.append(r)
        else:
            other_days_results.append(r)
    return other_days_results, same_day_results


def configure_run(args, existing_results, today_str):
    """
    Given parsed args, existing results, and today's date,
    return (all_results, completed_keys).
    """
    if args.replace:
        all_results = []
        completed_keys = set()
    elif args.replace_same_day:
        other_days_results, same_day_results = partition_results_by_day(existing_results, today_str)

        if args.resume:
            all_results = list(existing_results)
            completed_keys = get_completed_keys(same_day_results)
        else:
            all_results = list(other_days_results)
            completed_keys = set()
    else:
        # Default behavior: append everything
        all_results = list(existing_results)
        if args.resume:
            completed_keys = get_completed_keys(existing_results)
        else:
            completed_keys = set()

    return all_results, completed_keys


def write_results(output_path, results):
    """
    Persist results to disk as JSONL, replacing the file contents each time.
    """
    with open(output_path, "w", encoding="utf-8") as handle:
        for result in results:
            handle.write(json.dumps(result, ensure_ascii=False) + "\n")


def benchmark_single_prompt(service_name, model_name, prompt_info):
    """
    Benchmarks a single prompt on a service-model combination.
    Returns a single result entry or None on failure.
    """
    service_info = SERVICES.get(service_name)
    if not service_info:
        print(f"[-] Service {service_name} not found in config.py")
        return None

    url = service_info["url"]
    key = service_info["key"]

    client = OpenAI(base_url=url, api_key=key)
    
    test_id = prompt_info["id"]
    category = prompt_info["category"]
    prompt_text = prompt_info["prompt"]

    print(f"[*] Benchmarking {service_name} | Model: {model_name} | ID: {test_id} ({category})...")

    # Performance measurements
    start_time = time.perf_counter()
    first_token_time = None
    model_output = ""
    error_msg = None

    # Estimate prompt tokens
    estimated_prompt_tokens = count_tokens(prompt_text, model_name)

    try:
        # Request native token counts if supported (most OpenAI-compatible APIs support this)
        response = client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": prompt_text}],
            temperature=0,
            stream=True,
            stream_options={"include_usage": True}
        )

        native_prompt_tokens = None
        native_completion_tokens = None
        native_total_tokens = None

        for chunk in response:
            # Check for usage object in streaming chunks (typically in the last chunk)
            if hasattr(chunk, "usage") and chunk.usage is not None:
                native_prompt_tokens = chunk.usage.prompt_tokens
                native_completion_tokens = chunk.usage.completion_tokens
                native_total_tokens = chunk.usage.total_tokens

            if chunk.choices and len(chunk.choices) > 0:
                delta = chunk.choices[0].delta
                if delta.content:
                    if first_token_time is None:
                        first_token_time = time.perf_counter()
                    model_output += delta.content

        end_time = time.perf_counter()

        # Latency and throughput calculations
        total_time_sec = end_time - start_time
        ttft_sec = (first_token_time - start_time) if first_token_time else None

        # Use native token counts from API, fall back to tiktoken estimates
        p_tokens = native_prompt_tokens if native_prompt_tokens is not None else estimated_prompt_tokens
        c_tokens = native_completion_tokens if native_completion_tokens is not None else count_tokens(model_output, model_name)
        t_tokens = native_total_tokens if native_total_tokens is not None else (p_tokens + c_tokens)

        # Calculate inter-token latency and generation throughput
        if first_token_time and c_tokens > 0:
            generation_duration = end_time - first_token_time
            itl_ms = (generation_duration * 1000) / c_tokens if generation_duration > 0 else None
            generation_tps = c_tokens / generation_duration if generation_duration > 0 else None
        else:
            itl_ms = None
            generation_tps = None

        total_tps = t_tokens / total_time_sec if total_time_sec > 0 else 0.0

        result_entry = {
            "service": service_name,
            "model": model_name,
            "test_id": test_id,
            "category": category,
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "total_time_sec": round(total_time_sec, 3),
            "ttft_sec": round(ttft_sec, 3) if ttft_sec is not None else None,
            "itl_ms_per_token": round(itl_ms, 2) if itl_ms is not None else None,
            "generation_tps": round(generation_tps, 2) if generation_tps is not None else None,
            "total_tps": round(total_tps, 2),
            "prompt_tokens": p_tokens,
            "completion_tokens": c_tokens,
            "total_tokens": t_tokens,
            "model_output": model_output,
            "output_type": "text",
            "status": "success"
        }
        print(f"    -> Success | TTFT: {ttft_sec:.3f}s | Gen TPS: {generation_tps:.2f} tps | Gen Tokens: {c_tokens}")
        return result_entry

    except Exception as e:
        end_time = time.perf_counter()
        error_msg = str(e)
        print(f"    [-] Failed: {error_msg}")
        result_entry = {
            "service": service_name,
            "model": model_name,
            "test_id": test_id,
            "category": category,
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "total_time_sec": round(end_time - start_time, 3),
            "ttft_sec": None,
            "itl_ms_per_token": None,
            "generation_tps": None,
            "total_tps": 0.0,
            "prompt_tokens": estimated_prompt_tokens,
            "completion_tokens": 0,
            "total_tokens": estimated_prompt_tokens,
            "model_output": f"ERROR: {error_msg}",
            "output_type": "text",
            "status": "error"
        }
        return result_entry


def benchmark_service_model(service_name, model_name, prompts, max_workers=4):
    """
    Benchmarks a single model on a service using the loaded prompts.
    Executes prompts in parallel using ThreadPoolExecutor for faster execution.
    
    Args:
        service_name: Name of the service to benchmark
        model_name: Model ID to use
        prompts: List of prompt dictionaries
        max_workers: Maximum number of concurrent requests
    
    Returns:
        List of result entries
    """
    results = []
    
    # Use ThreadPoolExecutor for parallel benchmark execution
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(benchmark_single_prompt, service_name, model_name, prompt): prompt
            for prompt in prompts
        }
        
        for future in as_completed(futures):
            result = future.result()
            if result is not None:
                results.append(result)
    
    return results

def print_summary_table(results):
    """
    Print a clean terminal summary table of aggregated metrics.
    Uses native Python dict aggregation (no pandas dependency).
    """
    if not results:
        return
    
    success_results = [r for r in results if r["status"] == "success"]
    if not success_results:
        print("\n[*] No successful results to summarize.")
        return
    
    # Aggregate by service-model combination
    aggregated = defaultdict(list)
    for result in success_results:
        key = (result["service"], result["model"])
        aggregated[key].append(result)
    
    # Build summary rows
    print("\n" + "=" * 120)
    print("AGGREGATED PERFORMANCE METRICS")
    print("=" * 120)
    
    # Header
    header = f"{'Service':<15} {'Model':<25} {'Count':<6} {'Avg TTFT (s)':<14} {'Avg ITL (ms)':<14} {'Avg Gen TPS':<14} {'Avg Total TPS':<14}"
    print(header)
    print("-" * 120)
    
    # Data rows
    for (service, model), entries in sorted(aggregated.items()):
        count = len(entries)
        
        # Calculate averages
        avg_ttft = sum(e.get("ttft_sec") or 0 for e in entries if e.get("ttft_sec")) / count if any(e.get("ttft_sec") for e in entries) else 0
        
        avg_itl = sum(e.get("itl_ms_per_token") or 0 for e in entries if e.get("itl_ms_per_token")) / count if any(e.get("itl_ms_per_token") for e in entries) else 0
        
        avg_gen_tps = sum(e.get("generation_tps") or 0 for e in entries if e.get("generation_tps")) / count if any(e.get("generation_tps") for e in entries) else 0
        
        avg_total_tps = sum(e.get("total_tps") or 0 for e in entries) / count if entries else 0
        
        row = f"{service:<15} {model:<25} {count:<6} {avg_ttft:<14.3f} {avg_itl:<14.2f} {avg_gen_tps:<14.2f} {avg_total_tps:<14.2f}"
        print(row)
    
    print("=" * 120)


def main():
    parser = argparse.ArgumentParser(
        description="Comprehensive End-User Performance Benchmark for UCSB Gateway Services",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Benchmark a single model on all services (appends to log by default)
  python perfBench.py --models gpt-4-turbo
  
  # Benchmark multiple models on a specific service
  python perfBench.py --service GRIT --models gpt-4-turbo,gpt-3.5-turbo,llama-2-70b
  
  # Replace/overwrite the entire log instead of appending
  python perfBench.py --models gpt-4-turbo --replace
  
  # Overwrite same-day results, preserving previous days' results
  python perfBench.py --models gpt-4-turbo --replace-same-day
  
  # Use 8 concurrent workers for faster benchmarking
  python perfBench.py --models gpt-4-turbo --workers 8
 
  # Run a quick smoke test with only 3 prompts/tasks
  python perfBench.py --models gpt-4-turbo --task 3
 
  # Resume a previous run from an existing JSONL log
  python perfBench.py --models gpt-4-turbo --resume
        """
    )
    parser.add_argument(
        "--prompts",
        type=str,
        default="data/performance.jsonl",
        help="Path to the JSONL file containing the benchmark prompts. (default: data/performance.jsonl)"
    )
    parser.add_argument(
        "--output",
        type=str,
        default="data/performance_results.jsonl",
        help="Path to save the JSONL logs. (default: data/performance_results.jsonl)"
    )
    parser.add_argument(
        "--service",
        type=str,
        help="Specific service to test (e.g., AICommons, CIT, GRIT). Benchmarks all services if omitted."
    )
    parser.add_argument(
        "--models",
        type=str,
        required=True,
        help="Comma-separated list of model IDs to benchmark (required). E.g., 'gpt-4-turbo,gpt-3.5-turbo'"
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=4,
        help="Maximum number of concurrent requests per service-model pair. (default: 4)"
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Completely replace the existing JSONL log instead of appending (default: append)."
    )
    parser.add_argument(
        "--replace-same-day",
        action="store_true",
        help="Overwrite existing results from the same day (today) in the JSONL log while preserving other days."
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume from an existing output file by skipping prompts already completed for the same service/model pair."
    )
    parser.add_argument(
        "--task",
        type=int,
        help="Limit the benchmark to the first N prompts/tasks for quick validation."
    )
    parser.add_argument(
        "--test",
        action="store_true",
        help="Shortcut for --task 3 to run a quick smoke test."
    )

    args = parser.parse_args()

    # Parse models (comma-separated)
    models_list = [m.strip() for m in args.models.split(",")]
    if not models_list:
        print("[-] Error: No models specified. Use --models with comma-separated list.")
        sys.exit(1)

    # Load prompts
    prompts = load_prompts(args.prompts)

    task_limit = args.task if args.task is not None else (3 if args.test else None)
    if task_limit is not None and task_limit <= 0:
        print("[-] Error: --task must be a positive integer.")
        sys.exit(1)

    prompts = select_prompts(prompts, task_limit=task_limit)

    # Determine services to run
    services_to_run = {}
    if args.service:
        matched = False
        for s_name in SERVICES:
            if s_name.lower() == args.service.lower():
                services_to_run[s_name] = SERVICES[s_name]
                matched = True
                break
        if not matched:
            print(f"[-] Service '{args.service}' not found. Available: {list(SERVICES.keys())}")
            sys.exit(1)
    else:
        services_to_run = SERVICES

    # Build execution queue
    queue = []
    for s_name in services_to_run:
        for model in models_list:
            queue.append((s_name, model))

    print("=" * 100)
    print("UCSB LLM Gateway Performance Benchmark Suite")
    print(f"Services: {len(services_to_run)} | Models: {len(models_list)} | Prompts: {len(prompts)}")
    print(f"Total benchmark runs: {len(queue)} | Workers per run: {args.workers}")
    print(f"Output: {Path(args.output).resolve()}")
    print("=" * 100)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    existing_results = []
    # Load existing results unless we are completely replacing
    if not args.replace:
        existing_results = load_existing_results(output_path)
        if existing_results:
            print(f"[*] Loaded {len(existing_results)} existing result(s) from {output_path}")

    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    all_results, completed_keys = configure_run(args, existing_results, today_str)
    
    # Execute benchmark runs
    for idx, (s_name, model) in enumerate(queue, 1):
        remaining_prompts = get_remaining_prompts(
            prompts,
            service_name=s_name,
            model_name=model,
            completed_keys=completed_keys,
        )

        if not remaining_prompts:
            print(f"\n[{idx}/{len(queue)}] Service: {s_name} | Model: {model}")
            print("  Skipping: all prompts already completed for this service/model pair.")
            continue

        print(f"\n[{idx}/{len(queue)}] Service: {s_name} | Model: {model}")
        print(f"  Workers: {args.workers} | Prompts: {len(remaining_prompts)}")
        batch_results = benchmark_service_model(s_name, model, remaining_prompts, max_workers=args.workers)
        all_results.extend(batch_results)

        # Persist incrementally after each service-model pair completes.
        write_results(output_path, all_results)

        print(f"  Completed: {len(batch_results)} results")
        completed_keys.update({(s_name, model, result.get("test_id")) for result in batch_results if result.get("test_id") is not None})

    # Save results to output
    write_results(output_path, all_results)

    print("\n" + "=" * 100)
    print("BENCHMARK COMPLETED SUCCESSFULLY!")
    print(f"Results saved to: {output_path.resolve()}")
    print(f"Total results: {len(all_results)}")
    
    # Print summary statistics
    print_summary_table(all_results)
    
    # Print error summary if any
    error_results = [r for r in all_results if r["status"] == "error"]
    if error_results:
        print(f"\n[!] Warning: {len(error_results)} errors occurred during benchmarking.")
        print("    Check the output file for details.")
    
    print("=" * 100)

if __name__ == "__main__":
    main()
