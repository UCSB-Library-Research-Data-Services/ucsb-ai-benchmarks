from dotenv import load_dotenv
import os

load_dotenv()

SERVICES = {
    "CIT": {
        "url": "https://api.ai.college.ucsb.edu/v1",
        "key": os.getenv("CIT_KEY"),
        "models": [
            "gemma-4-31b",
            "mistral-small-4-119b-2603",
            "granite-4.1-30b",
            "Qwen3-Coder-Next",
            "qwen3.6-35b-a3b",
            "gpt-oss-120b",
            "qwen3.8-27b",
            "gemma-4-26b-a4b-it"
            ]
        },
    "GRIT": {
        "url": "https://llm.grit.ucsb.edu/api/v1",
        "key": os.getenv("GRIT_KEY"),
        "models": [
            'qwen3.5:latest',
            'qwen3-coder-next:latest',
            'mistral:latest',
            'qwen3-coder:latest',
            'llama3.1:8b',
            'phi4:latest',
            'qwen3:latest',
            'llama3:latest',
            'deepseek-r1:latest',
            'gemma3:latest',
            'gpt-oss:20b'
        ]
        },
    "AICommons":{
        "url": "https://zkh52rh785.execute-api.us-east-1.amazonaws.com/v1",
        "key": os.getenv("AICOMMONS_KEY"),
        "models": [
            "gpt-4o",
            "gpt-4-turbo",
            "gpt-4",
            "gpt-3.5-turbo-16k",
            "gpt-3.5-turbo",
            "qwen3-32b",
            "openai-gpt-oss-20b",
            "openai-gpt-oss-120b",
            "llama-4-scout-17b-instruct",
            "llama-4-maverick-17b-instruct",
            "claude-v4.6-sonnet",
            "claude-v4.6-opus",
            "claude-v4.5-haiku",
            "amazon-nova-pro",
            "amazon-nova-micro",
            "amazon-nova-lite",
            "claude-v5-opus",
            "claude-v5-sonnet"
        ]
        }
}

