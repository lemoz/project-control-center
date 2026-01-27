---
id: WO-2026-117
title: Track Visualization in WO List
goal: Surface track information in the main work order list views with filtering and grouping options.
context:
  - WO-2026-114 provides track data in WO responses
  - app/projects/[id]/work-orders/ contains WO list views
  - Users need to filter and group WOs by track
  - Track badges help quickly identify WO context
acceptance_criteria:
  - Track badge/chip displayed on each WO card showing track name and color
  - '"Filter by Track" dropdown in WO list header'
  - '"Group by Track" toggle that shows WOs organized under track headers'
  - Track progress summary showing done/ready/backlog counts per track
  - Clicking track badge filters to that track
  - '"No Track" filter option for unassigned WOs'
  - Track filter state persisted in URL query params
non_goals:
  - Modifying tech tree view (WO-2026-118)
  - Track management (WO-2026-116)
  - Bulk track assignment
stop_conditions:
  - If grouping makes the list too long, add collapse/expand for groups
priority: 2
tags:
  - ui
  - tracks
  - visualization
  - filtering
estimate_hours: 3
status: you_review
created_at: 2026-01-15
updated_at: 2026-01-27
depends_on:
  - WO-2026-114
  - WO-2026-116
era: v2
---
## Overview

The work order list is the primary view for managing WOs. Adding track visualization helps users understand the strategic context of each WO and filter to focus on specific tracks.

## Track Badge on WO Cards

```
┌─────────────────────────────────────────────────────────────┐
│ WO-2026-113                                    [🟢 Ready]   │
│ Merge Lock Mechanism for Concurrent Runs                    │
│                                                             │
│ [Runner Reliability] [runner] [git] [bug-fix]               │
│  ↑ track badge       ↑ existing tags                        │
└─────────────────────────────────────────────────────────────┘
```

Track badge styling:
- Background: track color at 20% opacity
- Border: track color
- Text: track color (darkened for light backgrounds)
- Positioned before tags, slightly larger

## Filter by Track

```
┌─────────────────────────────────────────────────────────────┐
│ Work Orders                                                 │
│                                                             │
│ Status: [All ▼]  Track: [All Tracks ▼]  Search: [________] │
│                         ┌──────────────────┐                │
│                         │ All Tracks       │                │
│                         │ ──────────────── │                │
│                         │ ● Runner (12)    │                │
│                         │ ● Economy (8)    │                │
│                         │ ● Viz (10)       │                │
│                         │ ● Autonomous (20)│                │
│                         │ ──────────────── │                │
│                         │ ○ No Track (5)   │                │
│                         └──────────────────┘                │
└─────────────────────────────────────────────────────────────┘
```

- Dropdown shows all tracks with WO counts
- Track color indicator (●) next to each option
- "No Track" option for unassigned WOs
- Selection updates URL: ?track=runner-reliability

## Group by Track

Toggle button: `[≡ List] [⊞ Group by Track]`

When grouped:

```
┌─────────────────────────────────────────────────────────────┐
│ Runner Reliability                          12 WOs (10 done)│
│ ──────────────────────────────────────────────────────────  │
│ ├─ WO-2026-113 Merge Lock Mechanism           [🔨 Building] │
│ ├─ WO-2026-100 Configurable Base Branch       [✅ Done]     │
│ ├─ WO-2026-107 pnpm Workspace Symlinks        [✅ Done]     │
│ └─ ... (collapse/expand)                                    │
│                                                             │
│ Economy                                      8 WOs (3 done) │
│ ──────────────────────────────────────────────────────────  │
│ ├─ WO-2026-104 Budget Enforcement             [🟢 Ready]    │
│ ├─ WO-2026-110 Cost Backfill                  [🟢 Ready]    │
│ └─ ...                                                      │
│                                                             │
│ No Track                                     5 WOs          │
│ ──────────────────────────────────────────────────────────  │
│ ├─ WO-2026-044 Sync run status                [✅ Done]     │
│ └─ ...                                                      │
└─────────────────────────────────────────────────────────────┘
```

Features:
- Track header shows name, total WOs, done count
- Collapsible track sections
- Track sorted by sort_order (from tracks table)
- "No Track" section at bottom

## Track Progress Summary

Optional header widget showing track health:

```
┌─────────────────────────────────────────────────────────────┐
│ Track Progress                                              │
│                                                             │
│ Runner ████████████░░ 10/12    Economy ███░░░░░ 3/8        │
│ Viz    ███████░░░ 7/10         Auto    █████████████░ 19/21│
└─────────────────────────────────────────────────────────────┘
```

- Horizontal bar per track
- Filled portion = done WOs
- Shows most active tracks first

## URL State

```
/projects/[id]/work-orders?track=runner-reliability&group=track
```

Query params:
- `track`: Track ID to filter (or "none" for unassigned)
- `group`: "track" to enable grouping

## Files to Modify

1. `app/projects/[id]/work-orders/page.tsx` - Add filter and group controls
2. `app/projects/[id]/work-orders/WorkOrderCard.tsx` - Add track badge
3. `app/projects/[id]/work-orders/WorkOrderFilters.tsx` - Add track dropdown
4. `app/projects/[id]/work-orders/TrackGroup.tsx` - New component for grouped view
5. `app/projects/[id]/work-orders/TrackProgressSummary.tsx` - New summary widget

## Component: TrackBadge

```tsx
function TrackBadge({ track }: { track: Track | null }) {
  if (!track) return null;

  return (
    <span
      className="px-2 py-0.5 rounded-full text-xs font-medium"
      style={{
        backgroundColor: `${track.color}20`,
        borderColor: track.color,
        color: track.color,
      }}
    >
      {track.name}
    </span>
  );
}
```

## Testing

1. Verify track badges appear on WO cards
2. Filter by track, verify only matching WOs shown
3. Group by track, verify correct grouping
4. Collapse/expand track groups
5. Filter "No Track", verify unassigned WOs
6. URL state persists on reload
