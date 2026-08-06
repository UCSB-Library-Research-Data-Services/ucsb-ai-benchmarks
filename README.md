
## Benchmarks

### SciCode

SciCode is a scientist-curated benchmark consisting of 80 "authentic laboratory problems across 16 scientific disciplines, developed by domain experts," introduced in the research paper **[SciCode: A Research Coding Benchmark Curated by Scientists](https://arxiv.org/abs/2407.13168)**. The problems dataset is available on [HuggingFace](https://huggingface.co/datasets/SciCode1/SciCode).

**Methodology:** SciCode evaluates LLMs on multi-step scientific code generation by sequentially prompting the model for each sub-problem step, injecting its prior code outputs as dependencies, and validating correctness against ground-truth reference values loaded from an HDF5 database ([`test_data.h5`](https://github.com/scicode-bench/SciCode/tree/main#instructions-to-evaluate-a-new-model-using-inspect_ai-recommended)).

SciCode provide three types of evaluations:

- With and without scientific background: Scientific background provide base knowledge that hypothetically can enahnce the inherent knowledge base of the model being tested, and provide more chances for the task to succeed.
- Gold vs. generated solutions to previous subproblems: "Each main problem in SciCode factorizes into multiple subproblems, and solutions to previous problems provide vital information for solving the current one. SciCode enables use of gold or generated solutions to previous subproblems. Gold solutions focus only on the current problem, while generated ones provide a more realistic evaluation setting and are more challenging due to error accumulation." (Tian et al., 2024, p. 6)
- Main vs. subproblem levels: "(1) The LM is considered to have successfully solved the main problem when all subproblem solutions are correct and the integrated solution to the main problem is correct. (2) Alternatively, SciCode can assess at a subproblem level, evaluating a subproblem independently of other subproblems or its main problem" (Tian et al., 2024, p. 6)


**Metrics:** Two primary metrics are evaluated:

1. Problem correctness: Binary score (1 or 0) indicating whether a model successfully completed all sub-steps of a problem.
2. Sub-problem correctness: A micro-averaged metric computed over individual sub-steps:

$$
\text{Sub-problem Correctness} = \frac{\sum_{i=1}^{P} C_i}{\sum_{i=1}^{P} S_i}
$$

## Evaluated models 

## CIT

- gemma-4-31b
- mistral-small-4-119b-2603
- granite-4.1-30b
- Qwen3-Coder-Next
- qwen3.6-35b-a3b
- gpt-oss-120b