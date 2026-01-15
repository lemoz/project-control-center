---
id: WO-2026-096
title: "Visualization: Orbital/Gravity View"
goal: Test if a gravity/attention metaphor helps prioritize focus on active and important work.
context:
  - WO-2026-095 (builds on Heatmap learnings)
  - "Hypothesis: Hot work should pull toward center, idle drifts away"
  - Inspired by Solar system visualizations, attention/focus metaphors, physics games
  - "Shared design: Node = Project, Size = consumption rate, Escalation badges, Click → popup → drill-through, Voice-primary/canvas-ambient"
acceptance_criteria:
  - Central sun represents user attention
  - Active/important nodes orbit close to center
  - Idle/completed nodes drift to outer rings
  - Nodes slowly orbit (not static)
  - Heat (activity) pulls nodes inward
  - Cooling (idle time) lets nodes drift outward
  - Click node to focus - pulls it to center temporarily
  - Visual rings to show attention zones (hot/warm/cold)
non_goals:
  - Realistic orbital physics
  - Precise positioning (conceptual, not exact)
  - Dependencies/connections
stop_conditions:
  - If orbiting is distracting, make it very slow or optional
priority: 3
tags:
  - ui
  - canvas
  - visualization
  - exploration
estimate_hours: 3
status: done
created_at: 2026-01-12
updated_at: 2026-01-15
depends_on:
  - WO-2026-095
era: v2
---
## Hypothesis

Gravity/orbital view will:
1. Naturally prioritize active work (it's close to you)
2. Let completed/idle work fade to periphery
3. Match mental model of "attention has gravity"
4. Create calming, ambient visualization

## Visual Design

```
                    · · · · · · · · ·
               ·          ○            ·
            ·        ○         ○         ·
          ·      ○                 ○       ·
         ·                                  ·
        ·   ○      ┌─────────┐      ○       ·
        ·         │    ◉    │              ·
        ·    ○    │  focus  │    ○         ·
        ·         └─────────┘              ·
         ·   ○                      ○     ·
          ·      ○              ○        ·
            ·        ○      ○          ·
               ·          ○         ·
                    · · · · · · ·

Inner ring: Active work (building, testing, review)
Middle ring: Ready work (needs attention soon)
Outer ring: Backlog, done, idle
```

## Zones

```typescript
const zones = [
  { name: 'focus', minR: 0, maxR: 80, color: '#fef3c7' },      // Hot center
  { name: 'active', minR: 80, maxR: 180, color: '#fef9c3' },   // Warm
  { name: 'ready', minR: 180, maxR: 280, color: '#f0fdf4' },   // Mild
  { name: 'idle', minR: 280, maxR: 400, color: '#f8fafc' },    // Cool
  { name: 'archive', minR: 400, maxR: Infinity, color: '#fff' } // Cold (fading)
];
```

## Physics

```typescript
interface OrbitalNode {
  id: string;
  angle: number;         // Current orbital position (radians)
  radius: number;        // Distance from center
  targetRadius: number;  // Where gravity is pulling it
  angularVelocity: number; // Orbit speed

  // Heat/gravity
  heat: number;          // 0-1, higher = more gravity
  heatDecay: number;     // How fast heat fades
}

function updateNode(node: OrbitalNode, deltaTime: number) {
  // Activity generates heat
  if (node.isActive) {
    node.heat = Math.min(1, node.heat + 0.1 * deltaTime);
  } else {
    node.heat = Math.max(0, node.heat - node.heatDecay * deltaTime);
  }

  // Heat determines target radius (hot = close, cold = far)
  node.targetRadius = lerp(400, 80, node.heat);

  // Slowly move toward target radius
  node.radius = lerp(node.radius, node.targetRadius, 0.02);

  // Orbit (closer = faster)
  const baseSpeed = 0.001;
  node.angularVelocity = baseSpeed * (400 / node.radius);
  node.angle += node.angularVelocity * deltaTime;
}
```

## Visual States

| State | Appearance | Behavior |
|-------|------------|----------|
| Building | Bright, glowing | Pulled to inner ring |
| Testing | Cyan glow | Inner ring |
| Review | Purple glow | Inner-middle ring |
| Ready | Solid, visible | Middle ring |
| Blocked | Red tint | Middle ring (attention needed) |
| Done | Faded | Drifts outward |
| Backlog | Very dim | Outer ring |

## Interaction

```
Hover:
- Node grows slightly
- Show tooltip with details
- Highlight its zone

Click:
- Pull node to center temporarily
- Show details panel
- Other nodes spread slightly

Double-click:
- "Pin" to center
- Click elsewhere to unpin
```

## Ambient Feel

- Very slow orbital motion (calming, not frenetic)
- Soft zone rings (not harsh lines)
- Gentle glow effects
- Maybe subtle particle trails on hot nodes
- Stars in background for depth

## Questions to Answer

After building:
1. Does the gravity metaphor feel intuitive?
2. Is it satisfying to see work drift inward when active?
3. Does the orbital motion add or distract?
4. Can you find what needs attention quickly?
5. Is it too abstract or just right?
