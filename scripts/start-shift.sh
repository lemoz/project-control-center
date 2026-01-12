#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-project-control-center}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_PATH="${2:-$(cd "${SCRIPT_DIR}/.." && pwd)}"

PROMPT_CONTENT="$(sed "s|{project_id}|${PROJECT_ID}|g" "${PROJECT_PATH}/prompts/shift_agent.md")"

exec claude \
  --project "${PROJECT_PATH}" \
  --prompt "${PROMPT_CONTENT}" \
  --dangerously-skip-permissions \
  --allowedTools "Read,Edit,Bash,Glob,Grep,WebFetch,WebSearch"
