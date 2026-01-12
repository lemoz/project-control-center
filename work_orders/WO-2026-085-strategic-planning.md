---
id: WO-2026-085
title: Strategic Planning & Roadmaps
goal: Help global agent break big initiatives into projects/WOs and sequence work with dependencies.
context:
  - User has high-level goals ("launch by March")
  - Need to decompose into actionable work
  - Cross-project dependencies need coordination
acceptance_criteria:
  - Initiative model (big goal with target date)
  - Decompose initiative into projects + WOs
  - Dependency graph across projects
  - Critical path identification
  - Progress tracking toward initiative
non_goals:
  - Gantt charts or complex project management UI
  - Auto-scheduling (show info, human decides)
stop_conditions:
  - Keep lightweight; don't build full PM tool
priority: 4
tags:
  - autonomous
  - global-agent
  - planning
estimate_hours: 4
status: backlog
created_at: 2026-01-12
updated_at: 2026-01-12
depends_on:
  - WO-2026-079
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

  // Decomposition
  projects: string[];  // Project IDs involved
  milestones: Milestone[];

  // Progress
  total_wos: number;
  completed_wos: number;
  blocked_wos: number;
  critical_path: string[];  // WO IDs on critical path
}

interface Milestone {
  name: string;
  target_date: string;
  wos: string[];  // WOs that must complete
  status: 'pending' | 'completed' | 'at_risk';
}
```

## API

```
POST /global/initiatives
  - Create initiative from goal description

GET /global/initiatives/:id
  - Get initiative with progress

GET /global/initiatives/:id/critical-path
  - Show blocking chain

POST /global/initiatives/:id/decompose
  - AI-assisted breakdown into WOs
```

## Flow

```
User: "I want to launch Canvas City by March"
        ↓
Global agent creates initiative
        ↓
Decomposes into milestones:
  - Core gameplay (Feb 1)
  - Multiplayer (Feb 15)
  - Polish & deploy (Mar 1)
        ↓
Each milestone → WOs across projects
        ↓
Track progress, surface blockers
        ↓
"Milestone X at risk, blocked by WO-Y"
```
