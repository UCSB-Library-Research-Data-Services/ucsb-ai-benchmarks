import os
from dotenv import load_dotenv
from inspect_ai.model import Model, get_model

load_dotenv()

SERVICES = {
    "grit": "https://llm.grit.ucsb.edu/api/v1",
    "dream-lab": "https://litellm.dreamlab.ucsb.edu/",
    "aicommons": "https://zkh52rh785.execute-api.us-east-1.amazonaws.com/v1",
    "CIT": "https://api.ai.college.ucsb.edu"
}

def get_ucsb_model(service_name: str, model_name: str, **kwargs) -> Model:
    """Retrieve an Inspect Model configured for a specific institutional endpoint."""
    if service_name not in SERVICES:
        raise ValueError(f"Unknown service: {service_name}")
    
    # Map the service API keys
    key_mapping = {
        "grit": "GRIT_KEY",
        "dream-lab": "DL_KEY",
        "aicommons": "AICOMMONS_KEY",
        "CIT": "CIT_KEY"
    }
    api_key = os.getenv(key_mapping[service_name])
    
    # Return an OpenAI-compatible model pointing to your custom base URL
    return get_model(
        model=f"openai/{model_name}",
        api_base=SERVICES[service_name],
        api_key=api_key,
        **kwargs
    )