import glob
from inspect_ai.log import read_eval_log

print('| Model | Split | Background? | Subproblem Correctness | Problem Correctness | Total Tokens |')
print('|---|---|---|---|---|---|')

for f in sorted(glob.glob('SciCode/eval/inspect_ai/logs/*.eval')):
    try:
        log = read_eval_log(f)
        model = log.eval.model
        split = log.eval.task_args.get('split', 'N/A')
        bg = log.eval.task_args.get('with_background', 'N/A')
        
        # Don't list dummy runs in our clean dashboard
        if log.eval.task_args.get('mode') == 'dummy':
            continue
            
        sub_prob_corr = 'N/A'
        prob_corr = 'N/A'
        for score in log.results.scores:
            if 'sub_problem_correctness' in score.metrics:
                sub_prob_corr = f'{score.metrics["sub_problem_correctness"].value * 100:.1f}%'
            elif 'mean' in score.metrics:
                prob_corr = f'{score.metrics["mean"].value * 100:.1f}%'
                
        # Get token count
        total_tokens = 0
        if log.stats and log.stats.model_usage:
            for usage in log.stats.model_usage.values():
                total_tokens += usage.total_tokens
        if total_tokens == 0:
            continue
        
        print(f'| {model} | {split} | {bg} | {sub_prob_corr} | {prob_corr} | {total_tokens:,} |')
    except Exception:
        pass