---
id: WO-2026-125
title: Add Track Info to Tech Tree API
goal: Include track information in tech tree nodes so the UI can group/color by track
context:
  - server/index.ts (tech-tree endpoint around line 2150)
  - server/work_orders.ts (track field already exists on WorkOrder type)
  - app/projects/[id]/TechTreeView.tsx (consumes tech tree data)
acceptance_criteria:
  - Tech tree API response includes trackId and track object for each node
  - Track object contains id, name, and color
  - Nodes without a track have null trackId
non_goals:
  - UI changes (separate WO)
  - Track CRUD operations
stop_conditions:
  - If track data not available at query time, document limitation
priority: 2
tags:
  - api
  - tech-tree
  - tracks
  - visualization
estimate_hours: 1
status: done
depends_on: []
era: v2
created_at: 2026-01-22
updated_at: 2026-01-22
---
## Summary

The tech tree API currently returns work order nodes with basic info (id, title, status, depends_on). This WO adds track information to each node so the UI can visualize groupings.

## Implementation

1. In the tech-tree endpoint, join with tracks table to get track info
2. Add `trackId` and `track: {id, name, color}` to each node
3. Return null for nodes without an assigned track
