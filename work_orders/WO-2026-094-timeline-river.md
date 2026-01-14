---
id: WO-2026-094
title: "Visualization: Timeline River"
goal: Test if a flowing timeline metaphor helps understand progress and work moving through stages.
context:
  - WO-2026-093 (builds on Force Graph learnings)
  - Hypothesis: Time-as-horizontal-space makes progress intuitive
  - Inspired by: Git flow diagrams, conveyor belt games, river metaphors
  - "Shared design: Node = Project, Size = consumption rate, Escalation badges, Click → popup → drill-through, Voice-primary/canvas-ambient"
acceptance_criteria:
  - Horizontal "river" with time flowing left to right
  - Projects as lanes/channels in the river
  - Runs appear as bubbles that flow through stages
  - Stages visible as regions: backlog → ready → building → review → done
  - Active runs animate movement through the river
  - Completed runs drift to the right edge and fade
  - Click bubble to see run details
non_goals:
  - Precise timing/spacing (conceptual, not Gantt)
  - Historical data (just current + recent)
  - Multiple projects in detail (focus on one, show others as parallel streams)
stop_conditions:
  - If animation is distracting, make it subtler
  - If too abstract, add more concrete labels
priority: 3
tags:
  - ui
  - canvas
  - visualization
  - exploration
estimate_hours: 3
status: you_review
created_at: 2026-01-12
updated_at: 2026-01-14
depends_on:
  - WO-2026-093
era: v2
---
## Hypothesis

Timeline river will:
1. Make progress feel tangible (things move!)
2. Show bottlenecks (bubbles pile up in a stage)
3. Create sense of flow and momentum
4. Surface stalled work (bubbles not moving)

## Visual Design

```
  BACKLOG      READY      BUILDING     REVIEW       DONE
     │           │           │           │           │
═════╪═══════════╪═══════════╪═══════════╪═══════════╪══════▶
  ○  │        ○  │           │  ◉→       │           │  ○
     │     ○     │           │     ◉→    │           │    ○
═════╪═══════════╪═══════════╪═══════════╪═══════════╪══════▶
  ○  │           │  ○        │           │  ◉→       │
     │           │           │           │           │  ○
═════╪═══════════╪═══════════╪═══════════╪═══════════╪══════▶

○ = idle work order
◉ = active run (moving right)
→ = direction of flow
```

## Stage Regions

```typescript
const stages = [
  { id: 'backlog', label: 'Backlog', color: '#666', x: 0, width: 0.15 },
  { id: 'ready', label: 'Ready', color: '#4a9', x: 0.15, width: 0.15 },
  { id: 'building', label: 'Building', color: '#49a', x: 0.30, width: 0.25 },
  { id: 'review', label: 'Review', color: '#94a', x: 0.55, width: 0.20 },
  { id: 'done', label: 'Done', color: '#4a4', x: 0.75, width: 0.25 },
];
```

## Animation

```typescript
interface RiverBubble {
  id: string;
  type: 'wo' | 'run';
  lane: number;        // Which project lane
  x: number;           // 0-1 position in river
  targetX: number;     // Where it's heading
  status: string;

  // Animation
  velocity: number;    // Current speed
  bobOffset: number;   // Gentle vertical bob
}

function animateBubble(bubble: RiverBubble, deltaTime: number) {
  // Move toward target
  const dx = bubble.targetX - bubble.x;
  bubble.velocity = lerp(bubble.velocity, dx * 0.5, 0.1);
  bubble.x += bubble.velocity * deltaTime;

  // Gentle bob
  bubble.bobOffset = Math.sin(Date.now() / 500 + bubble.id.hashCode()) * 3;
}
```

## Lane Layout

```
Each project gets a lane (horizontal band)
├── Lane 1: Project Control Center
│   └── WOs and runs flow through
├── Lane 2: Other Project
│   └── ...
└── Lane 3: Another Project
    └── ...

Lanes can expand/collapse
Click lane header to focus
```

## Visual Feedback

| State | Visual |
|-------|--------|
| Moving smoothly | Bubble flows right |
| Stuck/stalled | Bubble jiggles in place |
| Failed | Bubble turns red, sinks |
| Success | Bubble glows green, accelerates to Done |
| Waiting | Bubble pulses in place |

## Questions to Answer

After building:
1. Does the flow metaphor feel natural?
2. Can you spot bottlenecks (many bubbles in one stage)?
3. Is the movement satisfying or distracting?
4. Does it help understand progress?
5. How should completed work fade out?
