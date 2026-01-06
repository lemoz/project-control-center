---
id: WO-2026-021
title: Tech Tree Visualization for Work Order Dependencies
status: done
priority: 2
tags: [ui, visualization, dependencies]
created: 2026-01-06
updated: 2026-01-06
estimate_hours: 8
depends_on: [WO-2025-003]
era: v1
---

# Tech Tree Visualization for Work Order Dependencies

## Goal
Add a game-style tech tree visualization to show work order dependencies and progression, complementing the Kanban board view.

## Context
- Work orders can have dependencies (depends_on) and era groupings
- Users need to understand which work orders block others
- Visual representation helps with planning and prioritization

## Acceptance Criteria
- [x] Add `depends_on` array field to work order schema
- [x] Add `era` field to work order schema for grouping
- [x] Create `/repos/:id/tech-tree` API endpoint that builds dependency graph
- [x] Detect and report dependency cycles
- [x] Create TechTreeView component with SVG visualization
- [x] Layout nodes by era (horizontal bands) and dependency depth
- [x] Draw bezier curve arrows connecting dependencies
- [x] Color-code nodes by status (backlog, ready, in_progress, done, etc.)
- [x] Highlight dependencies (green) and dependents (blue) on hover/click
- [x] Add view toggle between Kanban and Tech Tree on project page
- [x] Show dependency info in WorkOrderDetails and KanbanBoard

## Non-Goals
- Auto-layout optimization algorithms
- Drag-and-drop dependency editing
- Export to image

## Stop Conditions
- Tech tree renders for project-control-center with all work orders visible
- Dependencies are clearly shown with arrows
- View toggle switches between Kanban and Tech Tree

## Implementation Notes
- TechTreeView.tsx (~500 lines) with era-based horizontal layout
- work_order_deps table in SQLite for dependency tracking
- Cycle detection uses DFS with white/gray/black coloring
