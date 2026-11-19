#!/bin/bash

for m in claude-v5.5-haiku claude-v5.5-opus claude-v5.5-sonnet moonshotai-kimi-k3 \
         nvidia-nemotron-super-3-120b openai-gpt-6-luna openai-gpt-6-sol; do
  uv run bench run performance --service AICOMMONS --model "$m" || exit 1
done
uv run bench collect performance 
uv run bench build