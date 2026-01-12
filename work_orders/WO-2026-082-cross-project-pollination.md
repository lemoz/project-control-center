---
id: WO-2026-082
title: Cross-Project Pollination
goal: Enable global agent to identify and transfer successful patterns between projects.
context:
  - Projects solve similar problems independently
  - Successful patterns should propagate
  - "Project A solved auth well, Project B needs auth"
acceptance_criteria:
  - Track successful patterns/solutions with tags
  - Query similar problems across projects
  - Suggest existing solutions when creating WOs
  - Option to copy/adapt WO from another project
non_goals:
  - Automatic code sharing (manual adaptation)
  - Dependency between projects (just knowledge sharing)
stop_conditions:
  - Start with manual tagging, add auto-detection later
priority: 3
tags:
  - autonomous
  - global-agent
  - knowledge
estimate_hours: 3
status: backlog
created_at: 2026-01-12
updated_at: 2026-01-12
depends_on:
  - WO-2026-079
era: v2
---
## Pattern Model

```typescript
interface Pattern {
  id: string;
  name: string;
  description: string;
  tags: string[];  // 'auth', 'api', 'testing', etc.
  source_project: string;
  source_wo: string;
  implementation_notes: string;
  success_metrics: string;
  created_at: string;
}
```

## API

```
GET /global/patterns
  - List all patterns

GET /global/patterns/search?tags=auth,oauth
  - Find patterns by tag

POST /global/patterns
  - Register new pattern from successful WO

POST /projects/:id/work-orders/from-pattern
  - Create WO based on pattern, adapted for project
```

## Flow

```
Project A completes auth WO successfully
        ↓
Global agent (or user) registers pattern
        ↓
Pattern stored with tags: ['auth', 'oauth', 'jwt']
        ↓
Later: Project B needs auth
        ↓
Global agent queries patterns, finds match
        ↓
Suggests: "Project A solved this, adapt WO-2025-XXX?"
        ↓
Create adapted WO for Project B
```
