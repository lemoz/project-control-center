---
id: WO-2026-023
title: Project Success Criteria and Goals
status: ready
priority: 1
tags: [projects, goals, metrics, autonomy]
created: 2026-01-06
updated: 2026-01-06
estimate_hours: 8
depends_on: [WO-2025-002]
era: autonomous
---

# Project Success Criteria and Goals

## Goal
Every project should define "what does success look like?" - a clear north star that the system can work toward and measure progress against. This enables autonomous operation with a defined finish line.

## Context
- Currently projects have work orders but no overarching success definition
- Without a goal, the system can't self-determine when it's "done" or prioritize effectively
- For project-control-center: "Able to fully manage 10-100 projects effectively, where those projects can self-determine and self-attain their own success"
- This is foundational for autonomous project management

## Acceptance Criteria
- [ ] Add `success_criteria` field to project schema (markdown text)
- [ ] Add `success_metrics` field for measurable KPIs (JSON array)
- [ ] Project dashboard shows success criteria prominently
- [ ] Progress indicators show how close project is to success
- [ ] Chat agent can help user define success criteria through conversation
- [ ] First work order suggestion for new projects: "Define success criteria"
- [ ] Success criteria stored in `.control.yml` sidecar for portability

## Example Success Criteria

### project-control-center
```yaml
success_criteria: |
  Able to fully manage 10-100 projects effectively.
  Projects can self-determine and self-attain their own success.
  System learns from failures and doesn't repeat mistakes.
  Expresses user's taste through agent behavior.

success_metrics:
  - name: "Active projects managed"
    target: 10
    current: 1
  - name: "Autonomous run success rate"
    target: 80%
    current: null
  - name: "Work orders completed without human intervention"
    target: 50%
    current: null
```

### A typical software project
```yaml
success_criteria: |
  Production-ready MVP with core features.
  All tests passing, CI green.
  Deployed and accessible to users.

success_metrics:
  - name: "Test coverage"
    target: 80%
  - name: "Open bugs"
    target: 0
  - name: "Core features complete"
    target: 5
    current: 2
```

## Non-Goals
- Automatic success detection (v1 is manual definition + display)
- Complex metric aggregation or dashboards
- Cross-project success rollups

## Stop Conditions
- If success criteria becomes too complex to be useful, keep it simple (just free-form text)
- If metrics tracking adds too much overhead, make it optional

## Technical Notes

### Schema changes:
```typescript
// .control.yml additions
success_criteria?: string;  // markdown
success_metrics?: Array<{
  name: string;
  target: number | string;
  current?: number | string;
}>;
```

### Files to modify:
1. `server/repos.ts`: Parse success fields from .control.yml
2. `server/db.ts`: Add columns to projects table (cached from sidecar)
3. `app/projects/[id]/page.tsx`: Display success criteria section
4. `server/chat_agent.ts`: Add action to help define success criteria
5. Documentation: Guide for writing good success criteria

### Chat agent integration:
When user creates a new project or asks "what should this project do?", agent can:
1. Ask clarifying questions about the project's purpose
2. Suggest success criteria based on project type
3. Help define measurable metrics
4. Write the success_criteria to .control.yml
