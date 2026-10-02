# UCSB AI Benchmarks

The rapid development of foundation models (FMs) and growing interest in integrating AI into academic research have made AI benchmarks a standard way to evaluate model performance, especially for complex research tasks such as scientific coding, multimodal data extraction, data analysis, and specialized literature summarization. 

A benchmark can be understood as a combination of tasks and a metric or score (Raji et al., 2021, p. 2). The quality of the benchmark is directly tied to the design of the dataset and the metrics used to evaluate performance (Reuel et al., 2024). Although most benchmarks include some indication of QoS, such as TTFT or TPS, the goal of benchmarks is to provide a consistent metric that allows comparison of how multiple models perform on particular tasks, regardless of QoS. 

The current stage and development trend of foundation models have prompted academic institutions to provide gateways and inference engines to serve researchers, scholars, and the general community, enabling testing and use of these models in more controlled environments. The ability to interact with models that run on-premises or operate under strict data-sharing agreements can attract researchers who want to use AI capabilities while maintaining more control over the data that is transferred as input and the results provided as output. If we add agentic tools to the mix, researcher-designed guardrails are paramount to guarantee data security, integrity, and access.

This project wants to explore the question of how institutionally provided AI gateways and inference perform directly over consumer-grade machines and standard internet connections. This involves not only QoS, but also whether a model's behavior degrades compared with when run in “optimal” conditions, which can be associated with the hardware and compression of a model in specific circumstances, not always accessible via API metadata. The overall goal of this project is to provide a tool that helps users identify the optimal model for specific tasks using metrics that align with their UX, and to give providers a cross-department comparison to evaluate performance and plan accordingly.

## References

Raji, I. D., Bender, E. M., Paullada, A., Denton, E., & Hanna, A. (2021). AI and the Everything in the Whole Wide World Benchmark (arXiv:2111.15366). arXiv. https://doi.org/10.48550/arXiv.2111.15366 
Reuel, A., Hardy, A., Smith, C., Lamparth, M., Hardy, M., & Kochenderfer, M. J. (2024). BetterBench: Assessing AI Benchmarks, Uncovering Issues, and Establishing Best Practices (arXiv:2411.12990). arXiv. https://doi.org/10.48550/arXiv.2411.12990 
