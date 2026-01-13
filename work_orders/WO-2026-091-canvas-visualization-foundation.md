---
id: WO-2026-091
title: Canvas Visualization Foundation
goal: Build shared infrastructure for exploring spatial project visualizations.
context:
  - WO-2026-066 (Canvas City concept research)
  - Primary interaction is voice-first chat with global agent; canvas is ambient/glanceable
  - Multiple visualization approaches to explore sequentially (pulse, graph, timeline, etc.)
  - Shared foundation reduces duplication across experiments
  - "Key design decisions: Node = Project (not WOs), Size = token consumption rate, Escalation badges for 'needs human' state"
acceptance_criteria:
  - React canvas component with render loop (requestAnimationFrame)
  - useProjectsVisualization hook that fetches projects (as nodes), includes consumption rate and escalation status
  - Real-time activity updates (poll /repos endpoint every 5s)
  - Basic interactions: click node to select, hover for tooltip, pan/zoom canvas
  - ProjectPopup component showing quick glance info (status, escalations, WO summary, success metrics progress)
  - Click-through from popup to full project view (existing Kanban/tech tree pages)
  - Playground page at /playground/canvas with visualization switcher
  - TypeScript types for visualization node data (node = project, size = consumption)
  - Escalation badge component (red indicator when project needs human attention)
  - At least one placeholder visualization to prove the shell works
non_goals:
  - Any specific visualization style (those are separate WOs)
  - WebSocket implementation (polling is fine for MVP)
  - Persistence of visualization state
  - Mobile optimization
stop_conditions:
  - If canvas performance is poor with 20+ nodes, investigate alternatives
priority: 2
tags:
  - ui
  - canvas
  - visualization
  - foundation
estimate_hours: 4
status: you_review
created_at: 2026-01-12
updated_at: 2026-01-13
depends_on: []
era: v2
---
## Architecture

```
app/playground/canvas/page.tsx      <- Playground shell with switcher
app/playground/canvas/
  ├── CanvasShell.tsx               <- Canvas container, controls, switcher
  ├── useProjectsVisualization.ts   <- Data fetching hook
  ├── useCanvasInteraction.ts       <- Pan, zoom, click, hover
  ├── types.ts                      <- VisualizationNode, etc.
  └── visualizations/
      ├── index.ts                  <- Registry of available visualizations
      └── PlaceholderViz.tsx        <- Simple dots to prove it works
```

## Data Model

```typescript
// Node = Project (not WOs or runs)
interface ProjectNode {
  id: string;
  name: string;
  path: string;
  status: 'active' | 'blocked' | 'parked';

  // Size driver
  consumptionRate: number;  // Tokens/day - determines node size

  // Activity indicators
  isActive: boolean;        // Has active run/shift
  activityLevel: number;    // 0-1 intensity
  lastActivity: Date | null;

  // Attention signals
  needsHuman: boolean;      // Has pending escalation
  escalationCount: number;  // Number of escalations waiting
  escalationSummary?: string;

  // Metrics
  health: number;           // 0-1 overall health
  successProgress: number;  // 0-1 toward success criteria

  // Work order summary
  workOrders: {
    ready: number;
    building: number;
    blocked: number;
    done: number;
  };

  // For rendering (set by visualization)
  x?: number;
  y?: number;
  radius?: number;          // Derived from consumptionRate
}

interface VisualizationData {
  nodes: ProjectNode[];
  timestamp: Date;
}
```

## Visualization Interface

```typescript
interface Visualization {
  id: string;
  name: string;
  description: string;

  // Lifecycle
  init(canvas: HTMLCanvasElement, data: VisualizationData): void;
  update(data: VisualizationData): void;
  render(): void;
  destroy(): void;

  // Interaction
  onNodeClick?(node: VisualizationNode): void;
  onNodeHover?(node: VisualizationNode | null): void;
}
```

## Playground UI

```
┌─────────────────────────────────────────────────────────┐
│ Canvas Playground                    [A] [B] [C] [D] [E]│
├─────────────────────────────────────────────────────────┤
│                                                         │
│                    (canvas area)                        │
│                                                         │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ Selected: PCC | Status: active | Runs: 2 active         │
└─────────────────────────────────────────────────────────┘
```

## Implementation Steps

1. Create playground route and shell component
2. Build useProjectsVisualization hook with polling
3. Set up canvas with basic pan/zoom
4. Define TypeScript types and visualization interface
5. Create placeholder visualization (random dots)
6. Wire up switcher UI
7. Test with real project data
