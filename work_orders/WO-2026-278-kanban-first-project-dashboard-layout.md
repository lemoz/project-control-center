---
id: WO-2026-278
title: Kanban-first project dashboard layout
goal: Reorder the project dashboard so the primary workflow (Kanban) is visible first, with secondary panels moved below or collapsed.
context:
  - app/projects/[id]/page.tsx
  - app/projects/[id]/KanbanBoard.tsx
  - app/projects/[id]/SuccessPanel.tsx
  - app/projects/[id]/CostPanel.tsx
  - app/projects/[id]/BudgetPanel.tsx
  - app/projects/[id]/ConstitutionPanel.tsx
  - app/projects/[id]/VMPanel.tsx
  - app/projects/[id]/AutopilotPanel.tsx
  - app/projects/[id]/AutoShiftPanel.tsx
acceptance_criteria:
  - Kanban is above the fold on desktop for the default project route.
  - Secondary panels are organized to reduce initial visual load (collapsed, grouped, or moved below Kanban).
  - Existing panel data and controls continue to work.
  - Tech Tree modal flow remains unchanged.
non_goals:
  - Full redesign of every secondary panel.
  - Rewriting project data-fetching architecture.
stop_conditions:
  - If panel reordering causes regressions in project startup actions (VM, autopilot, shift controls), stop and document blockers before merge.
priority: 2
tags:
  - ux
  - dashboard
  - workflow
estimate_hours: 3
status: ready
created_at: 2026-02-06
updated_at: 2026-02-06
depends_on: []
era: v1
---
## Implementation Notes
- Favor clear default workflow over maximal data density.
- Preserve direct access paths to previously top-level control actions.

