---
id: WO-2025-001
title: Project charter + v0 scaffold
goal: Create a clear project charter and a runnable v0 scaffold (Next.js PWA UI + local Node runner + SQLite) so we can dogfood Work Orders inside this app.
context:
  - README.md
  - DECISIONS.md
  - docs/work_orders.md
acceptance_criteria:
  - Project Charter exists in docs/charter.md describing purpose, target users, success metrics, constraints, and v0/v1 scope.
  - Repo has a Next.js TypeScript app that starts with `npm run dev` and renders a basic responsive dashboard shell.
  - Repo has a local Node/TS server that starts with `npm run server:dev` and exposes a health endpoint plus a placeholder repo-scan endpoint.
  - SQLite schema is defined and migrations/initialization exist; app can read/write portfolio state locally.
  - UI shows a placeholder portfolio list populated from the local server (mock data acceptable) and links to a per‑project Kanban placeholder.
  - Provider abstraction is defined with a Codex-only implementation stub (no full run loop required yet).
  - "`README.md` updated with actual setup/run commands for v0."
non_goals:
  - Implement full repo scanning, Kanban CRUD, or agent run orchestration in this Work Order.
  - Add Claude Code or Gemini CLI providers yet.
  - Add ngrok setup, auth, or notification plugins yet.
stop_conditions:
  - If Next.js + local server integration path is unclear, stop and propose options before proceeding.
  - If any dependency requires paid/cloud config beyond local dev, stop and ask.
priority: 1
tags:
  - bootstrap
  - charter
  - v0
estimate_hours: 6
status: done
created_at: 2025-12-12
updated_at: 2025-12-15
depends_on: []
era: v0
---
## Background
We’re building a local-first, mobile-friendly control center to manage all your projects and long-running agent work.
This repo is the first dogfood target: once v0 runs locally, we’ll track and build the rest of the system using this UI.

## Deliverables
### 1) Project Charter
Create `docs/charter.md` covering:
- Mission and “why now”
- Primary users (you as director/reviewer) and later users (optional multi-user)
- Core workflows (portfolio, Kanban Work Orders, builder+reviewer gate)
- Success metrics for v0 (time saved switching projects, reduced context loss)
- Constraints (local-first, ngrok access, summary-first review, private-by-default)
- Explicit v0 scope vs v1 scope

### 2) UI scaffold (Next.js PWA)
- Next.js + TypeScript project initialized in repo root (or `app/`), with sensible structure.
- Responsive layout that works on mobile (PWA manifest + installable shell).
- Pages:
  - `/` dashboard shell showing “Portfolio” list (placeholder ok).
  - `/projects/[id]` placeholder showing project header + Kanban columns.

### 3) Local API/runner scaffold
- Node/TS server (Express/Fastify/etc.) with:
  - `GET /health`
  - `GET /repos` returning mock repo list for now.
- Simple dev script + CORS config for local UI.

### 4) SQLite baseline
- Local SQLite DB (path in `.env` or default in repo root, gitignored).
- Minimal schema:
  - `projects` (id, path, name, type, stage, status, priority, tags, last_run_at, created_at, updated_at)
  - `work_orders` (id, project_id, title, status, priority, tags, created_at, updated_at)
- Migration/init strategy documented and runnable.

### 5) Provider interface stub
- Define provider interface for builder/reviewer and a Codex provider stub that can be expanded later.
- Store settings structure for provider/model selection, even if UI doesn’t expose it yet.

## Notes
- If helpful, split follow-up Work Orders for: repo scanning, Kanban CRUD, run loop, settings UI, ngrok hardening, iMessage notifier.
