# Decisions

Key architectural/product choices and why. This file should stay short and current.

## Local-first + ngrok access
- **Decision:** Run everything on the laptop; expose UI via ngrok basic auth.
- **Why:** Fastest way to get “access anywhere” without building cloud infra.
- **Notes:** Treat as internet-facing; strong password; reserved domain; rate limit later.

## Hybrid portfolio metadata
- **Decision:** Store global indexed state/history in SQLite, plus per-repo sidecar `.control.yml`.
- **Why:** SQLite enables fast queries/history; sidecar keeps “human truth” portable with repos.

## Work Orders as contract-backed cards
- **Decision:** All ongoing work lives as Work Orders in `work_orders/` with YAML frontmatter.
- **Why:** Spec-first, agent-friendly, and easy to visualize as Kanban.
- **Ready contract:** `goal`, `acceptance_criteria`, and `stop_conditions` required before runs start.

## Two-agent gate before human review
- **Decision:** Every Work Order run uses a Builder agent then a fresh Reviewer agent; only approved outputs reach you.
- **Why:** You shouldn’t triage unreviewed AI diffs; reduces noise and risk.

## Reviewer read-only inspection
- **Decision:** Reviewer may run read-only shell commands against a sanitized repo snapshot when needed (in addition to Work Order + diff).
- **Why:** Avoids “diff-only” blind spots (e.g., no-op diffs, missing surrounding context) and improves convergence without granting write access.

## Summary-first review UX
- **Decision:** UI shows run summary, files changed list, tests status, and reviewer verdict; diffs only on demand.
- **Why:** Keep human loop lightweight while preserving escape hatches.

## Next.js PWA UI + Node/TS runner
- **Decision:** Next.js (TypeScript) for UI with PWA support; Node/TS local server for scanning/runs.
- **Why:** Strong mobile UX, fast iteration, matches your existing stack.

## Pluggable provider interface
- **Decision:** Define provider abstraction now; implement Codex first, then Claude Code and Gemini CLI.
- **Why:** Avoid rewriting flow when adding providers; keep settings-driven.

## Future: isolated execution targets
- **Topic:** Run agent jobs in pristine, per-project environments with scoped secrets (instead of directly on the laptop filesystem).
- **Why:** Better isolation/safety, supports cloud CLIs, and reduces cross-project interference.
- **Directions:** Local containers, a single GCP “runner” VM (SSH/IAP), and/or Cloud Run Jobs once the job pipeline is stable.
