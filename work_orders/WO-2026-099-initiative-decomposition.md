---
id: WO-2026-099
title: Multi-Repo Initiative Decomposition
goal: Allow high-level initiatives to generate work suggestions across multiple repos, which project shifts autonomously process.
context:
  - WO-2026-085 (Strategic Planning) sketched initiative model
  - WO-2026-098 (Cross-Project Dependencies) enables the linking
  - WO-2026-144 (Unified Communication Model) enables suggestion intent
  - Users think in features, not repo boundaries
  - '"Add video upload" naturally spans frontend, API, backend'
  - Global agent is facilitator, NOT command-and-control
  - Projects are autonomous - global agent sends suggestions via communication system
  - Project shifts decide whether to create WOs from suggestions
acceptance_criteria:
  - Initiative model with name, description, target_date, involved_projects
  - POST /global/initiatives creates initiative
  - POST /global/initiatives/:id/plan generates decomposition suggestions (NOT WOs)
  - POST /global/initiatives/:id/notify-projects sends suggestions to involved project shifts
  - Project shifts autonomously create WOs based on suggestions
  - Suggested WOs include cross-project dependency hints
  - Initiative tracks progress from WOs that projects create (via initiative_id tag)
  - GET /global/initiatives/:id shows rollup status
non_goals:
  - Global agent directly creating WOs (violates project autonomy)
  - Gantt charts or detailed scheduling
  - Auto-prioritization of generated WOs
  - Conflict resolution if repos have competing work
stop_conditions:
  - Keep decomposition simple; project shifts can adjust suggestions
  - Don't try to be a full project management tool
  - If projects consistently reject suggestions, improve suggestion quality
priority: 3
tags:
  - global-agent
  - planning
  - multi-repo
  - communication
estimate_hours: 4
status: ready
created_at: 2026-01-12
updated_at: 2026-01-28
depends_on:
  - WO-2026-098
  - WO-2026-085
  - WO-2026-144
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

  // Suggestions sent (for tracking, not direct WO links)
  suggestions_sent: {
    project_id: string;
    suggested_title: string;
    sent_at: string;
  }[];

  // Progress (derived from WOs tagged with initiative_id by projects)
  status: 'planning' | 'active' | 'completed' | 'at_risk';
  progress: {
    total_wos: number;  // WOs tagged with this initiative
    done: number;
    in_progress: number;
    blocked: number;
  };

  created_at: string;
  updated_at: string;
}
```

## Correct Architecture Flow

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

POST /global/initiatives/:id/plan
  → Returns decomposition SUGGESTIONS (not WOs):
    - videonest-python: "Video Processing Service" (no deps)
    - videonest-api: "Video Upload Endpoint" (depends on processing)
    - videonest-web: "Video Upload UI Component" (depends on API)

        ↓

POST /global/initiatives/:id/notify-projects
  → Sends suggestion communications to each project shift:
    intent: "suggestion"
    body: "Initiative 'Video Upload Feature' needs your project to:
           - Implement Video Processing Service
           Suggested dependencies: none
           Target: [initiative target_date]"

        ↓ Start shifts on involved projects

Project shifts receive suggestions and autonomously decide:
  - Evaluate feasibility
  - Create WOs if appropriate (with initiative_id tag)
  - May adjust scope, dependencies, estimates

        ↓

Initiative tracks progress via WOs tagged with initiative_id
```

## API

```
POST /global/initiatives
  Create initiative

GET /global/initiatives
  List all initiatives

GET /global/initiatives/:id
  Get initiative with progress rollup

POST /global/initiatives/:id/plan
  Generate decomposition SUGGESTIONS (not WOs)
  Body: { guidance?: string }  // Optional hints
  Returns: { suggestions: [...] }  // Suggested work per project

POST /global/initiatives/:id/notify-projects
  Send suggestions to involved project shifts
  Body: { start_shifts?: boolean }  // Optionally start shifts
  Uses communication system with intent: "suggestion"

PATCH /global/initiatives/:id
  Update initiative (add projects, change target, etc.)

DELETE /global/initiatives/:id
  Archive initiative (doesn't delete WOs)
```

## Suggestion Generation Prompt

```
You are generating work SUGGESTIONS for an initiative across multiple repos.
These are suggestions that will be sent to project shifts, who will decide
whether to create WOs from them.

Initiative: {name}
Description: {description}

Involved Projects:
{for each project}
- {project_id}: {project_name}
  Path: {path}
  Tech: {detected tech stack}
  Recent WOs: {sample of recent WO titles for context}
{end for}

Generate work SUGGESTIONS for each project that together implement this initiative.
- Each suggestion should be small and focused (2-4 hours of work)
- Suggest cross-project dependencies (project shifts will set actual depends_on)
- Order dependencies correctly (backend before API before frontend)
- Include acceptance criteria specific to that repo's role
- These are SUGGESTIONS - project shifts may adjust or reject them

Output JSON:
{
  "suggestions": [
    {
      "project_id": "...",
      "suggested_title": "...",
      "suggested_goal": "...",
      "suggested_acceptance_criteria": ["..."],
      "suggested_dependencies": ["project_id:description"],
      "estimated_hours": N
    }
  ]
}
```

## Progress Tracking

Progress is tracked from WOs that projects create and tag with the initiative_id.
The global agent does NOT track WOs it created (it doesn't create WOs).

```typescript
function getInitiativeProgress(initiative: Initiative): Progress {
  // Find all WOs across projects that reference this initiative
  const wos = findWOsWithTag(`initiative:${initiative.id}`);

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
- Drill down to see WOs across repos (found via initiative_id tag)
- Visual showing dependency flow between repos
- Progress bar with per-repo breakdown

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
