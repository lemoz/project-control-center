---
id: WO-2026-119
title: Track Context in Shift Handoffs
goal: Include track information in shift context so agents understand the strategic direction of work orders.
context:
  - WO-2026-061 - Shift Context Assembly
  - WO-2026-076 - Auto-Generate Shift Handoffs
  - server/handoff_generator.ts - generates shift handoffs
  - server/shift_context.ts - assembles shift context
  - Tracks provide strategic "why" that helps agents prioritize
acceptance_criteria:
  - Shift context includes "Active Tracks" section showing tracks with in-progress WOs
  - Each WO in context includes its track name and goal
  - Track summary shows progress (done/total) per track
  - Handoff templates reference track goals when discussing priorities
  - Agent can cite track goals in decision rationale
non_goals:
  - Track management via shift commands
  - Automatic track assignment by agents
  - Track-based prioritization logic (agent uses tracks as input, not rule)
stop_conditions:
  - If track context makes handoffs too long, summarize to top 3-5 active tracks
priority: 2
tags:
  - autonomous
  - tracks
  - shift
  - context
estimate_hours: 2
status: done
created_at: 2026-01-15
updated_at: 2026-01-22
depends_on:
  - WO-2026-114
era: v2
---
## Overview

Shift agents make decisions about what to work on next. Knowing which tracks are active and their strategic goals helps agents make better prioritization decisions. This WO adds track context to shift handoffs.

## Shift Context Addition

Add to the shift context structure:

```typescript
interface ShiftContext {
  // ... existing fields ...

  tracks: {
    active: TrackSummary[];   // Tracks with ready/building WOs
    stalled: TrackSummary[];  // Tracks with no recent progress
  };
}

interface TrackSummary {
  id: string;
  name: string;
  goal: string | null;
  color: string;
  progress: {
    done: number;
    ready: number;
    building: number;
    backlog: number;
    total: number;
  };
  recentActivity: string | null;  // ISO date of last WO status change
}
```

## Context Assembly

In `assembleShiftContext()`:

```typescript
function assembleTrackContext(projectId: string): TrackContext {
  const tracks = listTracks(projectId);
  const wos = listWorkOrders(projectId);

  const summaries = tracks.map(track => {
    const trackWos = wos.filter(wo => wo.trackId === track.id);
    return {
      id: track.id,
      name: track.name,
      goal: track.goal,
      color: track.color,
      progress: {
        done: trackWos.filter(wo => wo.status === "done").length,
        ready: trackWos.filter(wo => wo.status === "ready").length,
        building: trackWos.filter(wo => ["building", "ai_review", "you_review"].includes(wo.status)).length,
        backlog: trackWos.filter(wo => wo.status === "backlog").length,
        total: trackWos.length,
      },
      recentActivity: getRecentActivityDate(trackWos),
    };
  });

  return {
    active: summaries.filter(t => t.progress.ready > 0 || t.progress.building > 0),
    stalled: summaries.filter(t => t.progress.ready === 0 && t.progress.building === 0 && t.progress.backlog > 0),
  };
}
```

## Handoff Template Update

Update the handoff prompt to include track context:

```markdown
## Active Tracks

The following strategic tracks have work ready or in progress:

{{#each tracks.active}}
### {{name}}
- **Goal:** {{goal}}
- **Progress:** {{progress.done}}/{{progress.total}} complete
- **Ready WOs:** {{progress.ready}}
- **Building:** {{progress.building}}
{{/each}}

{{#if tracks.stalled.length}}
## Stalled Tracks

These tracks have backlog items but no active work:

{{#each tracks.stalled}}
- **{{name}}:** {{progress.backlog}} backlog items (Goal: {{goal}})
{{/each}}
{{/if}}
```

## WO Context Enhancement

When listing WOs in the context, include track info:

```markdown
## Ready Work Orders

{{#each readyWorkOrders}}
### {{id}}: {{title}}
- **Track:** {{track.name}} ({{track.goal}})
- **Priority:** {{priority}}
- **Tags:** {{tags}}
{{/each}}
```

## Example Output

```markdown
## Active Tracks

### Runner Reliability
- **Goal:** Parallel runs that don't break each other
- **Progress:** 10/12 complete
- **Ready WOs:** 0
- **Building:** 1 (WO-2026-113)

### Economy
- **Goal:** Cost awareness and self-sustaining agent budgets
- **Progress:** 3/8 complete
- **Ready WOs:** 3
- **Building:** 0

### Visualization
- **Goal:** Rich visual dashboards for system state
- **Progress:** 7/10 complete
- **Ready WOs:** 2
- **Building:** 1 (WO-2026-093)

## Stalled Tracks

- **Run Estimation:** 4 backlog items (Goal: Predict how long runs will take)
- **Multi-Repo:** 2 backlog items (Goal: Coordinate work across projects)
```

## Agent Usage

Agents can reference tracks in their decision-making:

> "Starting WO-2026-104 (Budget Enforcement) because the Economy track is 3/8 complete
> and establishing budget controls is critical for the track's goal of self-sustaining
> agent budgets."

Or:

> "The Run Estimation track has been stalled with 4 backlog items. Consider prioritizing
> WO-2026-070 (Historical Averages API) to make progress on predicting run times."

## Files to Modify

1. `server/shift_context.ts` - Add track context assembly
2. `server/handoff_generator.ts` - Include tracks in handoff template
3. `server/types.ts` - Add TrackSummary types

## Testing

1. Generate shift context, verify tracks section present
2. Active tracks show correct ready/building counts
3. Stalled tracks identified correctly
4. WOs in context include track info
5. Handoff includes track goals in relevant sections
