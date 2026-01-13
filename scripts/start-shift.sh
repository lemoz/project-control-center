#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-project-control-center}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PCC_PATH="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Resolve project path from the API if not provided
if [ -n "${2:-}" ]; then
  PROJECT_PATH="$2"
else
  PROJECT_PATH=$(curl -s "http://localhost:4010/repos" | jq -r ".[] | select(.id == \"${PROJECT_ID}\") | .path")
  if [ -z "$PROJECT_PATH" ] || [ "$PROJECT_PATH" = "null" ]; then
    echo "Error: Could not resolve path for project ${PROJECT_ID}" >&2
    exit 1
  fi
fi

# Use project's own prompt if available, otherwise fall back to PCC's prompt
if [ -f "${PROJECT_PATH}/prompts/shift_agent.md" ]; then
  PROMPT_FILE="${PROJECT_PATH}/prompts/shift_agent.md"
else
  PROMPT_FILE="${PCC_PATH}/prompts/shift_agent.md"
  echo "Using shared prompt from PCC (${PROJECT_PATH} has no prompts/shift_agent.md)"
fi

PROMPT_CONTENT="$(sed "s|{project_id}|${PROJECT_ID}|g" "${PROMPT_FILE}")"

cd "${PROJECT_PATH}"

exec claude \
  --dangerously-skip-permissions \
  --allowedTools "Read,Edit,Bash,Glob,Grep,WebFetch,WebSearch" \
  -p "${PROMPT_CONTENT}"
