---
id: WO-2026-233
title: Project Detail Panel on Global Canvas
status: done
priority: 1
tags:
  - ui
  - canvas
  - detail-panel
  - global
estimate_hours: 4
created_at: 2026-01-28
updated_at: 2026-01-28
depends_on:
  - WO-2026-231
era: v2
---
## Goal

Clicking a project node on the global orbital canvas opens a slide-in detail panel showing project health, work orders, escalations, budget, and recent activity.

## Context

- Existing WO detail panel pattern: `app/live/LiveOrbitalCanvas.tsx:783-866`
- Project data available from `GET /global/context` per-project fields and `GET /repos/{id}`
- Panel should link through to project-level views (live canvas, kanban, chat)

## Acceptance Criteria

- [ ] Clicking a project node opens a slide-in panel
- [ ] Panel shows: project name, health status, stage, priority
- [ ] Panel shows WO summary: counts by status (ready, building, blocked, done)
- [ ] Panel shows active escalations with summaries
- [ ] Panel shows budget info (remaining, burn rate, runway) if available
- [ ] Panel shows active shift status (running/idle, agent, started_at)
- [ ] Panel shows recent runs (last 5) with outcomes
- [ ] Links to: project live canvas (`/live?project={id}`), kanban (`/projects/{id}`), chat (`/projects/{id}/chat`)
- [ ] Dismissable via click outside or X button
