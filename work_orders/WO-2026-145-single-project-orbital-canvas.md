---
id: WO-2026-145
title: Single-Project Orbital Canvas Implementation
goal: Adapt OrbitalGravityViz to display WOs within a single project using status rings and filtered view for the landing page.
context:
  - WO-2026-138 research doc (docs/wo-2026-138-single-project-orbital-canvas-research.md)
  - app/playground/canvas/visualizations/OrbitalGravityViz.tsx (current impl)
  - app/playground/canvas/hooks/useProjectsVisualization.ts (data source)
  - Hybrid approach - status rings + filtered view
  - Landing page shows live PCC agent working
acceptance_criteria:
  - Extend OrbitalGravityViz to accept mode prop (projects vs work-orders)
  - WO-as-node mapping (heat from status, size from estimate_hours, color from track)
  - Status rings layout (inner=building/review, mid=ready, outer=backlog, archive=done)
  - Default filter to active + ready + blocked (toggle to show all)
  - Track-based coloring with status controlling glow/outline
  - Density handling (hide labels unless hovered or high-heat, cap backlog nodes)
  - Click/hover focus works for WO nodes
  - Data source uses workOrderNodes from VisualizationData
non_goals:
  - Agent focus sync (separate WO-2026-140)
  - Ambient narration integration
  - New API endpoints (use existing /work-orders + /runs)
stop_conditions:
  - Keep visual style consistent with current orbital viz
  - Performance acceptable with 100+ nodes
priority: 2
tags:
  - implementation
  - ui
  - canvas
  - visualization
  - landing-page
estimate_hours: 8
status: ready
created_at: 2026-01-22
updated_at: 2026-01-22
depends_on:
  - WO-2026-138
era: v2
---
## Implementation Plan

### 1. Component Props Extension

```tsx
type OrbitalGravityVizProps = {
  mode: 'projects' | 'work-orders';
  projectId?: string; // required for work-orders mode
  filter?: 'active' | 'all'; // default 'active' for WO mode
};
```

### 2. WO Node Mapping

```ts
function mapWOToNode(wo: WorkOrder, runs: Run[]): OrbitalNode {
  const activeRun = runs.find(r => r.work_order_id === wo.id && isActiveStatus(r.status));
  const heat = computeWOHeat(wo.status, activeRun);
  const size = wo.estimate_hours 
    ? clamp(10 + Math.sqrt(wo.estimate_hours) * 4, 10, 28)
    : clamp(10 + (6 - wo.priority) * 3, 10, 26);
  
  return {
    id: wo.id,
    label: wo.id.replace('WO-2026-', ''),
    heat,
    size,
    color: wo.track?.color ?? statusColor(wo.status),
    glow: !!activeRun || wo.escalationCount > 0,
    // ...
  };
}
```

### 3. Heat Calculation

| Status | Base Heat |
|--------|-----------|
| building/ai_review/you_review | 0.85-1.0 |
| waiting_for_input | 0.9 |
| ready | 0.55-0.7 |
| blocked | 0.7-0.8 |
| backlog | 0.2-0.35 |
| done/parked | 0.05-0.2 |

### 4. Status Rings

- Inner ring (r < 0.3): building/testing/review (hot)
- Middle ring (0.3 < r < 0.6): ready + blocked
- Outer ring (0.6 < r < 0.85): backlog
- Archive (r > 0.85): done/parked (faded)

### 5. Filtering

Default filter (landing page):
- Show: building, testing, ai_review, you_review, waiting_for_input, ready, blocked
- Hide: backlog, done, parked

Toggle to reveal all.

### 6. Density Handling

- Labels hidden by default; show on hover/focus or if heat >= 0.7
- Backlog/done nodes: smaller radius, slower orbit, capped count (top 20 by recency)
- Track clustering when total nodes > 80 (optional v2)
