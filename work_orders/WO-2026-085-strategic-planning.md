---
id: WO-2026-085
title: Strategic Planning & Roadmaps
goal: Help global agent coordinate big initiatives across projects by sending decomposition suggestions to project shifts.
context:
  - User has high-level goals ("launch by March")
  - Need to decompose into actionable work across projects
  - Global agent is facilitator, NOT command-and-control
  - Projects are autonomous - global agent sends suggestions via communication system
  - Project shifts decide whether to create WOs from suggestions
  - WO-2026-144 (Unified Communication Model) enables suggestion intent
acceptance_criteria:
  - Initiative model (big goal with target date, involved projects)
  - Global agent analyzes initiative and generates decomposition plan
  - Send decomposition suggestions to each involved project shift
  - Start shifts on involved projects to process suggestions
  - Project shifts autonomously create WOs based on suggestions
  - Track progress across projects toward initiative goal
  - Critical path identification from linked WOs
non_goals:
  - Global agent directly creating WOs (violates project autonomy)
  - Gantt charts or complex project management UI
  - Auto-scheduling (show info, human decides)
stop_conditions:
  - Keep lightweight; don't build full PM tool
  - If projects consistently reject decomposition suggestions, improve suggestion quality
priority: 4
tags:
  - autonomous
  - global-agent
  - planning
  - communication
estimate_hours: 4
status: done
created_at: 2026-01-12
updated_at: 2026-01-28
depends_on:
  - WO-2026-079
  - WO-2026-144
era: v2
---
## Initiative Model

```typescript
interface Initiative {
  id: string;
  name: string;
  description: string;
  target_date: string;
  status: 'planning' | 'active' | 'completed' | 'at_risk';

  // Scope
  projects: string[];  // Project IDs involved
  milestones: Milestone[];

  // Progress (derived from project WOs that reference this initiative)
  total_wos: number;
  completed_wos: number;
  blocked_wos: number;
  critical_path: string[];  // WO IDs on critical path
}

interface Milestone {
  name: string;
  target_date: string;
  wos: string[];  // WOs that must complete (linked by projects)
  status: 'pending' | 'completed' | 'at_risk';
}
```

## Correct Architecture Flow

```
User: "I want to launch Canvas City by March"
        ↓
Global agent creates initiative with involved projects
        ↓
Global agent analyzes and generates decomposition plan:
  - Milestone 1: Core gameplay (Feb 1)
    - Project A: needs X, Y
    - Project B: needs Z
  - Milestone 2: Multiplayer (Feb 15)
    - Project A: needs P, Q
        ↓
For each involved project, send communication:
  intent: "suggestion"
  body: "Initiative 'Canvas City' needs your project to:
         - Implement X (depends on nothing)
         - Implement Y (depends on X)
         Target: Feb 1 milestone"
        ↓
Start shift on each involved project
        ↓
Project shifts review suggestions:
  - Evaluate feasibility
  - Create WOs if appropriate (with initiative_id tag)
  - May adjust scope, dependencies, estimates
        ↓
Global agent tracks progress via WOs tagged with initiative_id
        ↓
"Milestone X at risk, blocked by WO-Y in Project B"
```

## API

```
POST /global/initiatives
  - Create initiative from goal description

GET /global/initiatives/:id
  - Get initiative with progress

GET /global/initiatives/:id/critical-path
  - Show blocking chain

POST /global/initiatives/:id/plan
  - Generate decomposition plan (suggestions, NOT WOs)
  - Returns suggested work per project

POST /global/initiatives/:id/notify-projects
  - Send suggestions to involved project shifts
  - Optionally start shifts to process suggestions
```

## Key Principle: Project Autonomy

The global agent does NOT:
- Create WOs directly on projects
- Force projects to accept decomposition plans
- Override project decisions about scope/timeline

The global agent DOES:
- Create and manage initiative metadata
- Generate decomposition suggestions
- Send suggestions via communication system
- Start project shifts to process suggestions
- Track progress from WOs that projects create
- Surface blockers and risks across projects
