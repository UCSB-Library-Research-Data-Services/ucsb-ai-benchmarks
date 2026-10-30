from dotenv import load_dotenv
import os

load_dotenv()

SERVICES = {
    "AICommons":{
        "url": "https://zkh52rh785.execute-api.us-east-1.amazonaws.com/v1",
        "key": os.getenv("AICOMMONS_KEY"),
        "models": [
            "amazon-nova-micro",
            "llama-4-maverick-17b-instruct",
            "amazon-nova-lite",
            "openai-gpt-oss-20b",
            "openai-gpt-oss-120b",
            "llama-4-scout-17b-instruct",
            "qwen3-32b",
            "claude-v4.5-haiku",
            "amazon-nova-pro",
            "claude-v5-sonnet",
            "claude-v4.6-sonnet",
            "claude-v5-opus",
            "claude-v4.6-opus",
        ],
        "deprecated_models": [
            "gpt-4o",
            "gpt-4-turbo",
            "gpt-4",
            "gpt-3.5-turbo-16k",
            "gpt-3.5-turbo",
        ]
        },
    "CIT": {
        "url": "https://api.ai.college.ucsb.edu/v1",
        "key": os.getenv("CIT_KEY"),
        "models": [
            "gpt-oss-120b",
            "Qwen3-Coder-Next",
            "gemma-4-31b"
            ],
        "deprecated_models": [
            "mistral-small-4-119b-2603",
            "granite-4.1-30b",
            "qwen3.6-35b-a3b",
            "qwen3.8-27b",
            "gemma-4-26b-a4b-it"
        ],
        "excluded_models": [
            "bge-reranker",
            "gemma-4-26b-a4b-it-qat",
            "qwen3-embedding-8b"
            ],
        },
    "NRP": {
        "url": "https://ellm.nrp-nautilus.io/v1",
        "key": os.getenv("NRP_KEY"),
        "models": [
            "qwen3-small",
            "qwen3",
            "glm-5",
            "deepseek-v4-flash",
            "minimax-m2",
            "gemma",
            "gemma4-12b",
            "gemma-small",
            "gpt-oss",
            "gemma-small-e4b",
            "kimi",
        ],
        "deprecated_models": [
            "gemma4-small"
        ],
        "excluded_models": [
            "qwen3-embedding"
        ]
        },
    "GRIT": {
        "url": "https://llm.grit.ucsb.edu/api/v1",
        "key": os.getenv("GRIT_KEY"),
        "models": [
            'gpt-oss:20b',
            'qwen3.8:latest',
            'llava:7b',
            'mistral:latest',
            'gpt-oss:120b',
            'llama3:latest',
            'llama3.1:8b',
            'qwen3-coder-next:latest',
            'gemma4:31b',
            'phi4:latest',
        ],
        "deprecated_models": [           
            'qwen3.5:latest',
            'qwen3-coder:latest',
            'qwen3:latest',
            'deepseek-r1:latest',
            'gemma3:latest',
        ],
        "excluded_models": [
            "all-the-things",
            "glm-ocr:latest"
        ],
        }
    }

