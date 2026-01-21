#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PCC_PATH="$(cd "${SCRIPT_DIR}/.." && pwd)"

exec node --import tsx/esm "${PCC_PATH}/scripts/start-shift-vm.ts" "$@"
