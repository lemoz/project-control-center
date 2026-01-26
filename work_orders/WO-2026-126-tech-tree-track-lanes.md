---
id: WO-2026-126
title: Tech Tree Track Lanes
goal: Group tech tree nodes into horizontal swim lanes by track for better visual organization
context:
  - app/projects/[id]/TechTreeView.tsx (current implementation)
  - WO-2026-125 adds track data to API response
  - Currently 112 nodes, gets chaotic without grouping
acceptance_criteria:
  - Nodes grouped into horizontal lanes by track
  - Each lane has a header showing track name and color
  - Lanes are collapsible
  - Unassigned lane for nodes without a track
  - Dependencies still render as arrows across lanes
non_goals:
  - Filtering (separate WO-2026-127)
  - Reordering lanes
  - Drag-drop between lanes
stop_conditions:
  - If performance degrades significantly with lanes, simplify
priority: 2
tags:
  - ui
  - tech-tree
  - tracks
  - visualization
estimate_hours: 3
status: done
depends_on:
  - WO-2026-125
era: v2
created_at: 2026-01-22
updated_at: 2026-01-26
---
## Summary

The tech tree currently displays all 112 nodes in a flat dependency graph which gets visually chaotic. This WO organizes nodes into horizontal swim lanes based on their track assignment.

## Design

- Each track gets a horizontal lane
- Lanes stack vertically
- Lane header shows track name with color indicator
- Click lane header to collapse/expand
- Nodes without track go in "Unassigned" lane at bottom
- Dependency arrows cross lane boundaries as needed
