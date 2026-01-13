---
id: WO-2026-098
title: Cross-Project WO Dependencies
goal: Allow work orders in one project to depend on work orders in other projects.
context:
  - Multi-repo setups have natural cross-repo dependencies
  - Frontend feature needs API endpoint needs backend service
  - Currently WO depends_on only works within same project
  - Global agent needs to understand cross-project blocking
acceptance_criteria:
  - depends_on field accepts "project_id:WO-XXXX" format for cross-project deps
  - GET /repos/:id/work-orders includes cross-project dep status (satisfied/blocked)
  - GET /global/blocked-chains shows cross-project dependency chains
  - Shift context includes cross-project blockers
  - Tech tree visualization can show cross-project edges (different color/style)
non_goals:
  - Auto-creating dependent WOs (that's initiatives)
  - Cross-project merge coordination (future)
  - Notifications when cross-project dep is satisfied
stop_conditions:
  - Keep schema simple; don't over-engineer the reference format
priority: 2
tags:
  - infrastructure
  - global-agent
  - multi-repo
estimate_hours: 3
status: backlog
created_at: 2026-01-12
updated_at: 2026-01-12
depends_on:
  - WO-2026-077
era: v2
---
## Schema Changes

```sql
-- depends_on already stores array as JSON
-- Just need to support "project_id:WO-XXXX" format

-- Example:
-- ["WO-2026-050", "videonest-api:WO-2026-001"]
--  ^ same project   ^ cross-project
```

## Dependency Resolution

```typescript
interface ResolvedDependency {
  project_id: string;
  work_order_id: string;
  status: string;
  satisfied: boolean;
  is_cross_project: boolean;
}

function resolveDependencies(wo: WorkOrder): ResolvedDependency[] {
  return wo.depends_on.map(dep => {
    if (dep.includes(':')) {
      const [projectId, woId] = dep.split(':');
      const depWo = getWorkOrder(projectId, woId);
      return {
        project_id: projectId,
        work_order_id: woId,
        status: depWo?.status || 'not_found',
        satisfied: depWo?.status === 'done',
        is_cross_project: true
      };
    } else {
      // Same project
      const depWo = getWorkOrder(wo.project_id, dep);
      return {
        project_id: wo.project_id,
        work_order_id: dep,
        status: depWo?.status || 'not_found',
        satisfied: depWo?.status === 'done',
        is_cross_project: false
      };
    }
  });
}
```

## API Changes

```
GET /repos/:id/work-orders/:woId
  + resolved_dependencies: ResolvedDependency[]
  + blocked_by_cross_project: boolean

GET /global/blocked-chains
  Returns dependency chains that span projects:
  [
    {
      chain: [
        { project: "videonest-web", wo: "WO-2026-005", status: "ready" },
        { project: "videonest-api", wo: "WO-2026-003", status: "building" },
        { project: "videonest-python", wo: "WO-2026-001", status: "done" }
      ],
      blocking_wo: { project: "videonest-api", wo: "WO-2026-003" }
    }
  ]
```

## Shift Context Impact

```typescript
// In shift-context, show cross-project blockers
{
  work_orders: {
    blocked: [
      {
        id: "WO-2026-005",
        title: "Upload UI",
        blocked_by: [
          { project: "videonest-api", wo: "WO-2026-003", status: "building" }
        ]
      }
    ]
  }
}
```

## Tech Tree Visualization

- Same-project edges: solid gray
- Cross-project edges: dashed blue
- Hover shows project name
