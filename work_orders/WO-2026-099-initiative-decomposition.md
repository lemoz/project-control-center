---
id: WO-2026-099
title: Multi-Repo Initiative Decomposition
goal: Allow high-level initiatives to auto-decompose into coordinated WOs across multiple repos.
context:
  - WO-2026-085 (Strategic Planning) sketched initiative model
  - WO-2026-098 (Cross-Project Dependencies) enables the linking
  - Users think in features, not repo boundaries
  - '"Add video upload" naturally spans frontend, API, backend'
acceptance_criteria:
  - Initiative model with name, description, target_date, involved_projects
  - POST /global/initiatives creates initiative
  - POST /global/initiatives/:id/decompose uses AI to break into WOs per repo
  - Generated WOs have cross-project dependencies set correctly
  - Initiative tracks progress across all child WOs
  - GET /global/initiatives/:id shows rollup status
non_goals:
  - Gantt charts or detailed scheduling
  - Auto-prioritization of generated WOs
  - Conflict resolution if repos have competing work
stop_conditions:
  - Keep decomposition simple; user can adjust generated WOs
  - Don't try to be a full project management tool
priority: 3
tags:
  - global-agent
  - planning
  - multi-repo
estimate_hours: 4
status: backlog
created_at: 2026-01-12
updated_at: 2026-01-12
depends_on:
  - WO-2026-098
  - WO-2026-085
era: v2
---
## Initiative Model

```typescript
interface Initiative {
  id: string;
  name: string;
  description: string;
  target_date?: string;

  // Scope
  involved_projects: string[];  // Project IDs

  // Generated WOs
  work_orders: {
    project_id: string;
    work_order_id: string;
    role: string;  // "frontend", "api", "backend", etc.
  }[];

  // Progress
  status: 'planning' | 'active' | 'completed' | 'at_risk';
  progress: {
    total_wos: number;
    done: number;
    in_progress: number;
    blocked: number;
  };

  created_at: string;
  updated_at: string;
}
```

## Decomposition Flow

```
User: "I want to add video upload to videonest"

POST /global/initiatives
{
  "name": "Video Upload Feature",
  "description": "Users can upload videos from the web UI,
                  which are processed and stored",
  "involved_projects": ["videonest-web", "videonest-api", "videonest-python"]
}

        ↓ AI analyzes repos, understands their roles

POST /global/initiatives/:id/decompose

        ↓ Generates WOs with dependencies

videonest-web:
  WO-2026-001: "Video Upload UI Component"
    depends_on: ["videonest-api:WO-2026-001"]

videonest-api:
  WO-2026-001: "Video Upload Endpoint"
    depends_on: ["videonest-python:WO-2026-001"]

videonest-python:
  WO-2026-001: "Video Processing Service"
    depends_on: []
```

## API

```
POST /global/initiatives
  Create initiative

GET /global/initiatives
  List all initiatives

GET /global/initiatives/:id
  Get initiative with progress rollup

POST /global/initiatives/:id/decompose
  AI generates WOs across involved projects
  Body: { guidance?: string }  // Optional hints

PATCH /global/initiatives/:id
  Update initiative (add projects, change target, etc.)

DELETE /global/initiatives/:id
  Archive initiative (doesn't delete WOs)
```

## Decomposition Prompt

```
You are decomposing a feature initiative into work orders across multiple repos.

Initiative: {name}
Description: {description}

Involved Projects:
{for each project}
- {project_id}: {project_name}
  Path: {path}
  Tech: {detected tech stack}
  Recent WOs: {sample of recent WO titles for context}
{end for}

Generate work orders for each project that together implement this initiative.
- Each WO should be small and focused (2-4 hours)
- Set cross-project dependencies using "project_id:WO-ID" format
- Order dependencies correctly (backend before API before frontend)
- Include acceptance criteria specific to that repo's role

Output JSON:
{
  "work_orders": [
    {
      "project_id": "...",
      "title": "...",
      "goal": "...",
      "acceptance_criteria": ["..."],
      "depends_on": ["project:WO-XXX"],
      "estimate_hours": N
    }
  ]
}
```

## Progress Tracking

```typescript
function getInitiativeProgress(initiative: Initiative): Progress {
  const wos = initiative.work_orders.map(ref =>
    getWorkOrder(ref.project_id, ref.work_order_id)
  );

  return {
    total_wos: wos.length,
    done: wos.filter(wo => wo.status === 'done').length,
    in_progress: wos.filter(wo => ['building', 'testing', 'review'].includes(wo.status)).length,
    blocked: wos.filter(wo => wo.blocked_by_cross_project).length,
    percent_complete: (done / total_wos) * 100
  };
}
```

## UI Considerations

- Initiative dashboard showing all initiatives
- Drill down to see WOs across repos
- Visual showing dependency flow between repos
- Progress bar with per-repo breakdown
