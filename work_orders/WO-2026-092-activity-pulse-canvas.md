---
id: WO-2026-092
title: "Visualization: Activity Pulse Canvas"
goal: Test if real-time activity pulses make projects feel "alive" and draw attention appropriately.
context:
  - WO-2026-091 (canvas foundation)
  - Hypothesis: Seeing visual "life" creates engagement and surfaces active work
  - Inspired by: Server monitoring dashboards, heartbeat visualizations
  - "Shared design: Node = Project, Size = consumption rate, Escalation badges, Click → popup → drill-through, Voice-primary/canvas-ambient"
acceptance_criteria:
  - Projects rendered as circles on canvas
  - Circle size = token consumption rate (bigger = hungrier projects)
  - Pulse animation when run is active (expanding ring effect)
  - Glow intensity = current activity level
  - Idle projects are dimmer, smaller
  - Click project to see details in info panel
  - Smooth transitions when activity changes
non_goals:
  - Sophisticated layout algorithm (simple grid or random is fine)
  - Dependencies/connections (that's Version B)
  - Historical activity (just current state)
stop_conditions:
  - If pulse animations cause performance issues, simplify
priority: 3
tags:
  - ui
  - canvas
  - visualization
  - exploration
estimate_hours: 2
status: parked
created_at: 2026-01-12
updated_at: 2026-01-13
depends_on:
  - WO-2026-091
era: v2
---
## Hypothesis

Seeing projects "breathe" with activity will:
1. Make the system feel alive vs static
2. Draw attention to where work is happening
3. Surface stuck/idle projects that need attention

## Visual Design

```
Active project (run in progress):
    ╭───╮
   ╱  ●  ╲  <- expanding pulse ring
  │   ◉   │  <- glowing center
   ╲     ╱
    ╰───╯

Idle project:
     ○      <- dim, smaller

Healthy but idle:
     ◯      <- medium size, no glow

Unhealthy (failing runs):
     ◉      <- red tint, maybe jitter
```

## Animation Details

```typescript
interface PulseState {
  // Core
  baseRadius: number;      // From health metric
  currentRadius: number;   // Animated

  // Pulse ring (when active)
  pulseRings: {
    radius: number;
    opacity: number;
    expanding: boolean;
  }[];

  // Glow
  glowIntensity: number;   // 0-1
  glowColor: string;       // Based on status

  // Position
  x: number;
  y: number;
}

// Animation loop
function animatePulse(node: PulseState, deltaTime: number) {
  if (node.isActive) {
    // Spawn new pulse ring every ~2 seconds
    // Expand rings outward, fade opacity
    // Subtle "breathing" on base radius
  }

  // Smooth transitions for size/glow changes
  node.currentRadius = lerp(node.currentRadius, node.baseRadius, 0.1);
}
```

## Layout

Simple initial layout:
- Grid arrangement by project
- Or: random positions that don't overlap
- No physics simulation (keep it simple)

## Color Coding

| State | Color | Behavior |
|-------|-------|----------|
| Active (building) | Blue | Pulsing |
| Active (testing) | Cyan | Pulsing |
| Active (reviewing) | Purple | Pulsing |
| Healthy idle | Green | Dim, static |
| Warning (stalled) | Yellow | Dim, static |
| Error (failing) | Red | Subtle jitter |

## Questions to Answer

After building:
1. Does it feel alive? Or just noisy?
2. Do you naturally look at pulsing nodes?
3. Is the size/glow enough to show health?
4. What's missing from this view?
