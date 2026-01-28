---
id: WO-2026-231
title: Global Orbital Canvas Component
status: ready
priority: 1
tags: [ui, canvas, visualization, global]
estimate_hours: 6
created_at: 2026-01-28
updated_at: 2026-01-28
depends_on: []
era: v2
---
## Goal

Render projects as orbital nodes on a canvas at portfolio scope, reusing the OrbitalGravityViz rendering engine with project-level data.

## Context

- Existing project-level canvas: `app/live/LiveOrbitalCanvas.tsx` (WO nodes)
- Rendering engine: `app/playground/canvas/visualizations/OrbitalGravityViz.tsx`
- Data hook: `app/playground/canvas/hooks/useProjectsVisualization.ts` already computes project-level activityLevel, healthScore, consumptionRate, escalationCount
- Data sources: `GET /global/context` + `GET /repos`
- WO-2026-145 added `mode` prop concept (projects vs work-orders) — extend this pattern

## Acceptance Criteria

- [ ] New `GlobalOrbitalCanvas` component renders projects as orbital nodes
- [ ] Node heat driven by project activityLevel (active runs, recent shifts)
- [ ] Node size driven by project scale (WO count or priority)
- [ ] Node color/glow reflects health (healthy=green, attention_needed=yellow, failing=red, blocked=orange)
- [ ] Ring placement: inner=active shifts/escalations, middle=healthy active, outer=paused/parked
- [ ] Center node represents global agent session state (pulses when autonomous, dims when idle/no session)
- [ ] Escalation count shown as badge or glow intensity on node
- [ ] Click node to select (feeds into detail panel WO-2026-233)
- [ ] Hover shows tooltip: project name, health, active WOs, last activity
- [ ] Polls data on same interval as existing canvas (5s)
