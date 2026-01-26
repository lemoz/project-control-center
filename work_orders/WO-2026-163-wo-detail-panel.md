---
id: WO-2026-163
title: Work Order Detail Panel
status: done
priority: 2
tags:
  - live-demo
  - ui
estimate_hours: 3
depends_on: []
era: v2
updated_at: 2026-01-26
---
## Goal

Show work order details when clicking a node on the orbital canvas, so users can see the full WO context without leaving the live view.

## Context

- Canvas at `app/live/LiveOrbitalCanvas.tsx`
- WO data via `/repos/:id/work-orders/:woId`
- Similar detail patterns in project pages

## Acceptance Criteria

- [ ] Clicking WO node on canvas opens a detail panel
- [ ] Panel shows: id, title, goal, status, priority
- [ ] Panel shows acceptance criteria list
- [ ] Panel shows recent runs (last 3-5) with status
- [ ] Panel dismissable via X button or clicking outside
- [ ] Panel styled consistently with existing cards
