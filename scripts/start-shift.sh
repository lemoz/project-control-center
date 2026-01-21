#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-project-control-center}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PCC_PATH="$(cd "${SCRIPT_DIR}/.." && pwd)"
API_BASE_URL="${CONTROL_CENTER_API_URL:-http://localhost:4010}"
SHIFT_TIMEOUT_MINUTES="${CONTROL_CENTER_SHIFT_TIMEOUT_MINUTES:-120}"
ALLOWED_TOOLS_DEFAULT="Read,Edit,Bash,Glob,Grep,WebFetch,WebSearch"
ALLOWED_TOOLS="${CONTROL_CENTER_SHIFT_ALLOWED_TOOLS:-$ALLOWED_TOOLS_DEFAULT}"
CLAUDE_COMMAND="${CONTROL_CENTER_SHIFT_CLAUDE_PATH:-claude}"

# Resolve project path from the API if not provided
if [ -n "${2:-}" ]; then
  PROJECT_PATH="$2"
else
  PROJECT_PATH=$(curl -s "${API_BASE_URL}/repos" | jq -r ".[] | select(.id == \"${PROJECT_ID}\") | .path")
  if [ -z "$PROJECT_PATH" ] || [ "$PROJECT_PATH" = "null" ]; then
    echo "Error: Could not resolve path for project ${PROJECT_ID}" >&2
    exit 1
  fi
fi

if [ -n "${CONTROL_CENTER_SHIFT_PROMPT_FILE:-}" ]; then
  PROMPT_FILE="${CONTROL_CENTER_SHIFT_PROMPT_FILE}"
elif [ -f "${PROJECT_PATH}/prompts/shift_agent.md" ]; then
  PROMPT_FILE="${PROJECT_PATH}/prompts/shift_agent.md"
else
  PROMPT_FILE="${PCC_PATH}/prompts/shift_agent.md"
  echo "Using shared prompt from PCC (${PROJECT_PATH} has no prompts/shift_agent.md)"
fi

if [ ! -f "${PROMPT_FILE}" ]; then
  echo "Error: Prompt file not found at ${PROMPT_FILE}" >&2
  exit 1
fi

PROMPT_CONTENT="$(
  sed -e "s|{project_id}|${PROJECT_ID}|g" \
      -e "s|{base_url}|${API_BASE_URL}|g" \
      -e "s|{shift_timeout_minutes}|${SHIFT_TIMEOUT_MINUTES}|g" \
      "${PROMPT_FILE}"
)"

cd "${PROJECT_PATH}"

exec "${CLAUDE_COMMAND}" \
  --dangerously-skip-permissions \
  --allowedTools "${ALLOWED_TOOLS}" \
  -p "${PROMPT_CONTENT}"
