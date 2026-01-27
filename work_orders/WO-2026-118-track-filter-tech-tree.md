---
id: WO-2026-118
title: Track Filter and Grouping in Tech Tree
goal: Add track-based filtering and optional swimlane grouping to the tech tree visualization while preserving the chronological dependency view.
context:
  - app/projects/[id]/TechTreeView.tsx - existing tech tree implementation
  - Tech tree shows WO dependencies in chronological order
  - Tracks provide a strategic lens on top of the timeline
  - Users want to focus on specific tracks or see cross-track dependencies
acceptance_criteria:
  - Track filter dropdown to show only WOs in selected track(s)
  - Multi-select track filter (show Runner + Economy together)
  - Track color applied to WO nodes (border or background tint)
  - Optional swimlane view grouping WOs by track horizontally
  - Cross-track dependencies shown as lane-crossing edges
  - Track legend showing track names and colors
  - '"Most recent activity" sorting for tracks in swimlane view'
  - Preserve existing chronological layout as default
non_goals:
  - Replacing the dependency-based layout with pure track grouping
  - Track management from tech tree (use /tracks page)
  - Hiding dependencies within the same track
stop_conditions:
  - If swimlanes make the graph too wide, make it scrollable or collapsible
  - If performance degrades with swimlanes, keep filter-only initially
priority: 3
tags:
  - ui
  - tracks
  - tech-tree
  - visualization
estimate_hours: 3
status: ready
created_at: 2026-01-15
updated_at: 2026-01-27
depends_on:
  - WO-2026-114
  - WO-2026-117
era: v2
---
## Overview

The tech tree shows WO dependencies chronologically (left-to-right by completion/creation). Tracks add a strategic grouping layer. This WO adds track-based filtering and an optional swimlane view without breaking the core dependency visualization.

## Default View (Filter Only)

Track filter in header, WO nodes colored by track:

```
┌─────────────────────────────────────────────────────────────┐
│ Tech Tree                    Track: [All ▼] [Swimlanes ○]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [001]──[002]──[003]──[004]──[020]──[100]──[113]           │
│    │      │      │      │      │                            │
│    │      └──[008]     [011]──[001]──[016]                  │
│    │                    │      │                            │
│    └────────────────[024]──[025]──[026]                     │
│                                                             │
│  Legend: [■ Runner] [■ Chat] [■ Constitution] [■ Economy]  │
└─────────────────────────────────────────────────────────────┘

Node colors indicate track membership
Dependencies still drive layout
```

## Swimlane View

When swimlanes enabled, group by track with horizontal lanes:

```
┌─────────────────────────────────────────────────────────────┐
│ Tech Tree                    Track: [All ▼] [Swimlanes ●]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Runner        [004]──[020]──[100]──[113]                   │
│ ─────────────────────────────────────────                   │
│                  ╲                                          │
│ Chat          [011]──[001]──[016]──[042]                   │
│ ─────────────────╱───────────────────────                   │
│                                                             │
│ Constitution  [024]──[025]──[026]                          │
│ ─────────────────────────────────────────                   │
│                                                             │
│ Economy       [101]──[102]──[103]──[104]                   │
│ ─────────────────────────────────────────                   │
│                                                             │
│ No Track      [044]  [045]                                 │
│ ─────────────────────────────────────────                   │
└─────────────────────────────────────────────────────────────┘

Cross-track dependencies shown as diagonal lines crossing lanes
Time flows left-to-right within each lane
```

## Track Filter (Multi-Select)

```
┌──────────────────────────────┐
│ Track Filter                 │
│ ┌──────────────────────────┐ │
│ │ [✓] Runner Reliability   │ │
│ │ [✓] Economy              │ │
│ │ [ ] Chat                 │ │
│ │ [ ] Constitution         │ │
│ │ [ ] Autonomous           │ │
│ │ [ ] Visualization        │ │
│ │ ...                      │ │
│ └──────────────────────────┘ │
│ [Select All] [Clear]         │
└──────────────────────────────┘
```

- Multi-select checkboxes
- Only selected tracks' WOs shown
- Dependencies to/from hidden WOs shown as faded or dotted

## Track Sorting in Swimlanes

Options for swimlane order:
1. **Manual order** (sort_order from tracks table)
2. **Most recent activity** - tracks with recent WO updates first
3. **Most WOs** - largest tracks first
4. **Alphabetical**

Default: Manual order (user-defined in /tracks page)

## Node Styling

WO nodes styled by track:

```tsx
function getNodeStyle(wo: WorkOrder) {
  const track = wo.track;
  if (!track) return { border: "#gray" };

  return {
    border: `2px solid ${track.color}`,
    background: `${track.color}15`,  // 15% opacity fill
  };
}
```

## Legend Component

```tsx
function TrackLegend({ tracks }: { tracks: Track[] }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {tracks.map(track => (
        <div key={track.id} className="flex items-center gap-1">
          <span
            className="w-3 h-3 rounded"
            style={{ background: track.color }}
          />
          <span className="text-xs">{track.name}</span>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <span className="w-3 h-3 rounded bg-gray-300" />
        <span className="text-xs">No Track</span>
      </div>
    </div>
  );
}
```

## Files to Modify

1. `app/projects/[id]/TechTreeView.tsx` - Add track filter, swimlane toggle
2. `app/projects/[id]/TechTreeFilters.tsx` - New/updated filter component
3. `app/projects/[id]/TechTreeLegend.tsx` - New legend component
4. `app/projects/[id]/TechTreeSwimlanes.tsx` - New swimlane layout component

## Layout Algorithm for Swimlanes

```typescript
function layoutSwimlanes(wos: WorkOrder[], tracks: Track[]) {
  // Group WOs by track
  const byTrack = groupBy(wos, wo => wo.trackId ?? "none");

  // For each track, layout WOs left-to-right by dependency depth
  const lanes = tracks.map(track => {
    const trackWos = byTrack[track.id] ?? [];
    // Calculate x position based on dependency chain length
    return {
      track,
      nodes: trackWos.map(wo => ({
        wo,
        x: calculateDepthInTrack(wo, trackWos),
        y: track.sortOrder,
      })),
    };
  });

  return lanes;
}
```

## Testing

1. Filter by single track, verify only those WOs shown
2. Filter by multiple tracks, verify union shown
3. Enable swimlanes, verify tracks grouped correctly
4. Cross-track dependencies render as lane-crossing edges
5. Track legend accurate and interactive (click to filter)
6. Performance acceptable with 100+ WOs
