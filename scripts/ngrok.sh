#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${NGROK_DOMAIN:-}" ]]; then
  echo "NGROK_DOMAIN is required (reserved domain, e.g. your-name.ngrok.app)." >&2
  exit 1
fi

if [[ -z "${NGROK_BASIC_AUTH:-}" ]]; then
  echo "NGROK_BASIC_AUTH is required (user:password)." >&2
  exit 1
fi

exec ngrok http --domain="$NGROK_DOMAIN" --basic-auth "$NGROK_BASIC_AUTH" http://localhost:3010
