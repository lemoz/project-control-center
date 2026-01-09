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

## VM-based project isolation (v2)
- **Decision:** Each project can have a dedicated GCP VM for isolated execution; PCC orchestrates remotely via SSH.
- **Why:** Better isolation/safety, supports cloud CLIs, and reduces cross-project interference.
- **Status:** Scaffolding done (WO-2026-038), provisioning + lifecycle done (WO-2026-039). Remote exec and runner integration in progress.
- **Architecture:** Per-project VM with repo sync, artifact egress back to host, SSH readiness checks before marking running.

## Chat system with worktree isolation
- **Decision:** Chat threads can make file changes in isolated git worktrees; changes only affect main when user explicitly merges.
- **Why:** Prevents accidental changes to main branch; gives user control over when chat modifications are applied.
- **Implementation:** Per-thread worktree at `.system/chat-worktrees/thread-{id}/`, merge via UI button.

## Era-based work order organization
- **Decision:** Work orders are grouped into eras (v0, v1, v2) representing project maturity stages.
- **Why:** Provides clear progression, helps prioritization, and enables tech tree visualization by era lanes.
- **Eras:**
  - v0: Bootstrap/foundation (charter, discovery, kanban, runner)
  - v1: Core features (chat, settings, testing, worktree)
  - v2: Advanced (VM isolation, constitution, autonomous runner, cost metering)

## Run status sync with work order status
- **Decision:** When a work order is marked done, associated runs should auto-transition to merged.
- **Why:** Prevents stale "You Review" cards on Kanban when WO is already complete.
- **Status:** Manual fix applied; WO-2026-044 tracks automated solution.
