---
id: WO-2026-093
title: "Visualization: Force-Directed Graph"
goal: Test if physics-based layout reveals emergent structure and relationships between projects/WOs.
context:
  - WO-2026-092 (builds on Activity Pulse learnings)
  - Hypothesis: Related things will cluster naturally, revealing structure you miss in lists
  - Inspired by: d3-force, knowledge graphs, network visualizations
  - "Shared design: Node = Project, Size = consumption rate, Escalation badges, Click → popup → drill-through, Voice-primary/canvas-ambient"
acceptance_criteria:
  - Projects and WOs rendered as nodes
  - Dependencies rendered as edges (lines/arrows)
  - d3-force simulation for physics-based layout
  - Connected nodes attract, unconnected repel
  - Clusters emerge naturally from relationships
  - Drag nodes to rearrange (simulation adjusts)
  - Click node to highlight its connections
  - Smooth animation as simulation settles
non_goals:
  - Perfect layout (emergent is the point)
  - Complex edge styling (simple lines fine)
  - Hierarchical layout (that's different approach)
stop_conditions:
  - If simulation never settles, add cooling/damping
  - If too chaotic with many nodes, add clustering
priority: 3
tags:
  - ui
  - canvas
  - visualization
  - exploration
estimate_hours: 3
status: done
created_at: 2026-01-12
updated_at: 2026-01-22
depends_on:
  - WO-2026-092
era: v2
---
## Hypothesis

Physics-based layout will:
1. Cluster related work together spatially
2. Reveal dependency chains as visual paths
3. Show isolated nodes that might be stuck
4. Surface "hub" nodes with many connections

## Visual Design

```
        ○ WO-089
        │
    ○───●───○  <- Hub node (many connections)
   /    │    \
  ○     ○     ○
       /
      ○ WO-077 (pulsing - active)

Nodes:
● = project (larger)
○ = work order
◉ = active (glowing)

Edges:
─── = dependency
--- = weak link (same era?)
```

## Force Configuration

```typescript
import * as d3 from 'd3-force';

const simulation = d3.forceSimulation(nodes)
  // Pull linked nodes together
  .force('link', d3.forceLink(edges)
    .id(d => d.id)
    .distance(80)
    .strength(0.5))

  // Push all nodes apart
  .force('charge', d3.forceManyBody()
    .strength(-200))

  // Center the graph
  .force('center', d3.forceCenter(width/2, height/2))

  // Prevent overlap
  .force('collision', d3.forceCollide()
    .radius(d => d.radius + 5));
```

## Node Sizing

| Type | Base Size | Modifier |
|------|-----------|----------|
| Project | 30px | +10px if active |
| WO (ready) | 15px | - |
| WO (building) | 20px | Pulsing |
| WO (done) | 10px | Faded |
| WO (blocked) | 15px | Red border |

## Interaction

```
Hover node:
- Highlight node
- Highlight connected edges
- Dim unconnected nodes
- Show tooltip with details

Click node:
- Select it
- Show details in side panel
- Keep highlight until click elsewhere

Drag node:
- Pin it in place
- Simulation continues around it
- Double-click to unpin
```

## Edge Types

| Relationship | Style | Color |
|--------------|-------|-------|
| depends_on | Solid arrow | Gray |
| Same project | Thin line | Light gray |
| Active flow | Animated dash | Blue |

## Questions to Answer

After building:
1. Do meaningful clusters emerge?
2. Can you spot dependency chains visually?
3. Is it overwhelming or insightful?
4. Does dragging to rearrange help or hurt?
5. What relationships are missing?
