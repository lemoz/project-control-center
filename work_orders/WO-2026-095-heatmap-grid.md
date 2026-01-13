---
id: WO-2026-095
title: "Visualization: Heatmap Grid"
goal: Test if a dense grid view enables instant system health comprehension.
context:
  - WO-2026-094 (builds on Timeline River learnings)
  - Hypothesis: Color-coded grid lets you grok health of many items instantly
  - Inspired by: GitHub contribution graph, server monitoring grids, trading floors
  - "Shared design: Node = Project, Size = consumption rate, Escalation badges, Click → popup → drill-through, Voice-primary/canvas-ambient"
acceptance_criteria:
  - Grid of tiles, one per WO (or project)
  - Color = status (green/yellow/red spectrum)
  - Brightness/saturation = activity level
  - Hover tile for details tooltip
  - Click tile to select and show details
  - Sort/group options (by project, status, priority, era)
  - Tiles can subtly pulse when active
non_goals:
  - Relationships/dependencies (no lines)
  - Detailed per-tile info (just color + minimal label)
  - Time dimension (snapshot view)
stop_conditions:
  - If too many tiles, add grouping/zooming
priority: 3
tags:
  - ui
  - canvas
  - visualization
  - exploration
estimate_hours: 2
status: backlog
created_at: 2026-01-12
updated_at: 2026-01-12
depends_on:
  - WO-2026-094
era: v2
---
## Hypothesis

Heatmap grid will:
1. Enable instant "is anything broken?" assessment
2. Scale to many items without visual overload
3. Surface patterns (clusters of red, areas of activity)
4. Feel like a command center / control panel

## Visual Design

```
┌────────────────────────────────────────────────┐
│ System Health                    [by status ▼] │
├────────────────────────────────────────────────┤
│ ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐      │
│ │██││██││▓▓││░░││██││██││▓▓││██││░░││██│      │
│ └──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘      │
│ ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐      │
│ │░░││▓▓││██││██││░░││▒▒││██││░░││██││▓▓│      │
│ └──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘      │
│ ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐              │
│ │██││░░││██││▓▓││░░││██││██││░░│              │
│ └──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘              │
├────────────────────────────────────────────────┤
│ ■ Done (45)  ■ Ready (12)  ■ Building (3)     │
│ ■ Blocked (5)  ■ Failed (2)                    │
└────────────────────────────────────────────────┘

██ = bright (active/healthy)
▓▓ = medium
░░ = dim (idle/stale)
▒▒ = warning (orange)
```

## Color Mapping

```typescript
function getTileColor(wo: WorkOrder): string {
  const statusColors = {
    done: '#22c55e',      // Green
    ready: '#3b82f6',     // Blue
    building: '#8b5cf6',  // Purple (pulsing)
    testing: '#06b6d4',   // Cyan
    review: '#a855f7',    // Light purple
    blocked: '#f59e0b',   // Orange
    failed: '#ef4444',    // Red
    backlog: '#6b7280',   // Gray
  };

  const baseColor = statusColors[wo.status] || '#6b7280';

  // Adjust brightness by activity
  // Active = bright, idle = dim
  const brightness = wo.isActive ? 1.0 :
                     wo.lastActivity > hourAgo ? 0.7 :
                     wo.lastActivity > dayAgo ? 0.4 : 0.2;

  return adjustBrightness(baseColor, brightness);
}
```

## Tile Content

```
┌────────┐
│  077   │  <- WO number (or abbreviated title)
│  [●]   │  <- Status icon or activity indicator
└────────┘

On hover, show tooltip:
┌──────────────────────────────┐
│ WO-2026-077                  │
│ Global Context Aggregation   │
│ Status: done                 │
│ Last activity: 5 min ago     │
└──────────────────────────────┘
```

## Grouping Options

| Group By | Layout |
|----------|--------|
| Status | Columns per status |
| Project | Rows per project |
| Era | Sections by era |
| Priority | High → Low rows |
| None | Single sorted grid |

## Animation

- Active tiles pulse gently (opacity oscillation)
- Status changes animate color transition
- New tiles fade in
- Removed tiles fade out

## Questions to Answer

After building:
1. Can you assess overall health in <2 seconds?
2. Do problem areas jump out visually?
3. Is the density overwhelming or empowering?
4. What grouping works best?
5. Is hover enough or do you want click-to-expand?
