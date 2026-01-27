---
id: WO-2026-127
title: Tech Tree Track Filter
goal: Add filter controls to show/hide tracks in the tech tree view
context:
  - app/projects/[id]/TechTreeView.tsx
  - WO-2026-126 adds track lanes
  - 11 tracks currently defined for PCC
acceptance_criteria:
  - Filter panel with checkbox for each track
  - Show all and Hide all buttons
  - Filter state persisted in URL params
  - Hidden tracks completely removed from view (not just collapsed)
  - Dependency arrows to hidden nodes show as dashed/faded
non_goals:
  - Filtering by status (already exists)
  - Filtering by priority
  - Saved filter presets
stop_conditions:
  - If too many tracks make filter panel unwieldy, consider dropdown
priority: 3
tags:
  - ui
  - tech-tree
  - tracks
  - visualization
  - filtering
estimate_hours: 2
status: done
depends_on:
  - WO-2026-126
era: v2
created_at: 2026-01-22
updated_at: 2026-01-27
---
## Summary

With track lanes in place, users need ability to filter which tracks are visible. This helps focus on specific areas of work.

## Design

- Filter panel above or beside the tech tree
- Checkbox list of all tracks with color indicators
- Quick actions: Show All, Hide All
- URL params: `?tracks=track1,track2` for shareable filtered views
- When a track is hidden, any arrows pointing to/from those nodes render dashed
