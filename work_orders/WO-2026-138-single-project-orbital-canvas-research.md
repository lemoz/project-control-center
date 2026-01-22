---
id: WO-2026-138
title: Single-Project Orbital Canvas Research
goal: Explore how to adapt the multi-project orbital gravity visualization to display WOs within a single project.
context:
  - app/playground/canvas/visualizations/OrbitalGravityViz.tsx (current impl)
  - WO-2026-096 (original orbital gravity design)
  - Current viz shows projects as nodes orbiting user attention
  - Need to show WOs as nodes within a single project (e.g., PCC)
  - For landing page: visitors see PCC's WOs in motion
acceptance_criteria:
  - Document current OrbitalGravityViz data model and assumptions
  - Propose WO-as-node mapping (what determines heat/gravity?)
  - Consider node density (100+ WOs vs 10 projects)
  - Propose filtering/grouping strategies (by track? by status?)
  - Consider visual hierarchy (tracks as zones? status as rings?)
  - Identify data source changes needed
  - Sketch 2-3 alternative approaches with tradeoffs
non_goals:
  - Implementation
  - Detailed component design
  - Performance optimization (note concerns only)
stop_conditions:
  - Keep focused on visualization adaptation
  - Don't redesign the entire canvas system
priority: 3
tags:
  - research
  - ui
  - canvas
  - visualization
estimate_hours: 2
status: you_review
created_at: 2026-01-22
updated_at: 2026-01-22
depends_on: []
era: v2
---
## Research Questions

1. **Node mapping**: What WO attributes map to orbital properties?
   - Heat/gravity: status (building > ready > backlog)?
   - Size: estimate_hours? priority?
   - Color: track? status?
   - Glow: active run? escalation?

2. **Density handling**: PCC has 100+ WOs. Options:
   - Show all (might be cluttered but impressive)
   - Filter to active + ready only
   - Group by track (track = cluster, WOs orbit within)
   - Hierarchical zoom (tracks → WOs on click)

3. **Visual hierarchy options**:
   - Flat: all WOs as equal nodes, position = status
   - Tracks as orbital lanes
   - Status as concentric zones (current design)
   - Hybrid: tracks as colors, status as position

4. **Data source**:
   - Current: GlobalContextResponse with project summaries
   - Needed: Single project's WOs with status, track, run state
   - Endpoint: GET /projects/:id/work-orders or shift-context?

## Approaches to Sketch

### A: Direct Adaptation
- Swap project nodes for WO nodes
- Same heat model (active = hot, idle = cold)
- Risk: 100 nodes might be chaotic

### B: Track Clusters
- Each track is a cluster/group
- WOs orbit within their track cluster
- Tracks positioned by aggregate activity
- Cleaner but loses individual WO visibility

### C: Status Rings (strict)
- Inner ring: building/testing/review
- Middle ring: ready
- Outer ring: backlog
- Done: fades away entirely
- Very clear status, but loses track context

### D: Filtered View
- Only show "interesting" WOs (active + ready + blocked)
- Backlog/done hidden unless requested
- Cleaner but hides scope of work
