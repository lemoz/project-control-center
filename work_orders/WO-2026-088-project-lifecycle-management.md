---
id: WO-2026-088
title: Project Lifecycle Management
goal: Manage project lifecycle from creation to archival, including templates and graduation.
context:
  - New projects need consistent setup
  - Stable projects need less attention
  - Stale projects should be archived
acceptance_criteria:
  - Project templates for quick setup
  - Project status lifecycle (active, stable, maintenance, archived)
  - Auto-detection of stability (low WO rate, no failures)
  - Archive projects with preservation of history
  - Graduate projects (reduce attention allocation)
non_goals:
  - Delete projects (archive only)
  - Complex project types (one template to start)
stop_conditions:
  - Keep simple; we have few projects
priority: 4
tags:
  - autonomous
  - global-agent
  - lifecycle
estimate_hours: 2
status: ready
created_at: 2026-01-12
updated_at: 2026-01-26
depends_on:
  - WO-2026-080
era: v2
---
## Project Lifecycle

```
┌─────────┐    setup     ┌────────┐   stable    ┌────────────┐
│ Created │ ──────────── │ Active │ ──────────► │   Stable   │
└─────────┘              └────────┘             └────────────┘
                              │                       │
                              │ low activity          │ no activity
                              ▼                       ▼
                        ┌─────────────┐         ┌──────────┐
                        │ Maintenance │ ──────► │ Archived │
                        └─────────────┘         └──────────┘
```

## Status Definitions

- **Active**: Regular WO execution, needs full attention
- **Stable**: Working well, occasional maintenance, reduced attention
- **Maintenance**: Minimal changes, only critical fixes
- **Archived**: No active work, preserved for reference

## Graduation Rules

```typescript
function suggestGraduation(project: Project): GraduationSuggestion | null {
  // Active → Stable
  if (project.status === 'active') {
    if (failureRate(project, '30d') < 0.1 &&
        woCompletionRate(project, '30d') > 0.9 &&
        avgWOsPerWeek(project, '30d') < 2) {
      return { to: 'stable', reason: 'Consistently healthy, low activity' };
    }
  }

  // Stable → Maintenance
  if (project.status === 'stable') {
    if (daysSinceLastWO(project) > 30) {
      return { to: 'maintenance', reason: 'No WOs in 30 days' };
    }
  }

  // Maintenance → Archived
  if (project.status === 'maintenance') {
    if (daysSinceLastActivity(project) > 90) {
      return { to: 'archived', reason: 'No activity in 90 days' };
    }
  }

  return null;
}
```

## Templates

```typescript
interface ProjectTemplate {
  name: string;
  description: string;
  initial_wos: WorkOrderTemplate[];
  constitution_base: string;
  default_settings: ProjectSettings;
}

// Example: web-app template
const webAppTemplate: ProjectTemplate = {
  name: 'web-app',
  description: 'Full-stack web application',
  initial_wos: [
    { title: 'Project Setup', goal: 'Initialize repo, deps, CI' },
    { title: 'Core Architecture', goal: 'Setup routing, state, API layer' },
  ],
  constitution_base: 'web-app-constitution.md',
  default_settings: { vm_size: 'small', isolation_mode: 'vm' },
};
```
