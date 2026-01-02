---
id: WO-2025-006
title: ngrok exposure + basic auth
goal: Document and add helper scripts to expose the UI via ngrok reserved domain with basic auth.
context:
  - README.md (add ngrok setup + auth section)
  - scripts/ (add ngrok.sh)
  - "app/ (optional: surface public URL)"
acceptance_criteria:
  - README documents ngrok install + authtoken, reserved domain config, and basic auth usage with example env vars/command.
  - scripts/ngrok.sh starts ngrok to http://localhost:3010 using env vars for domain + basic auth.
  - Docs remind to keep credentials in .env (gitignored); no secrets committed.
non_goals:
  - Advanced auth/SSO.
  - UI display of public URL unless it is trivial (stretch).
priority: 5
tags:
  - ngrok
  - security
  - access-anywhere
estimate_hours: 2
status: you_review
created_at: 2025-12-12
updated_at: 2026-01-02
stop_conditions:
  - If ngrok CLI is missing or reserved-domain details are unknown, pause and ask.
  - If exposing the public URL requires extra deps or network polling, skip and report.
---
