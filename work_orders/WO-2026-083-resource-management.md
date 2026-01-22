---
id: WO-2026-083
title: Resource Management
goal: Track and allocate resources (VMs, budget, capacity) across projects.
context:
  - Multiple projects compete for limited VMs
  - Budget tracking prevents runaway costs
  - Global agent needs to balance resources
acceptance_criteria:
  - Resource pool tracking (VMs available, in use, cost)
  - Budget limits per project and global
  - Allocation decisions in global context
  - Auto-stop idle VMs after threshold
  - Usage reporting
non_goals:
  - Billing integration (manual budget input)
  - Auto-scaling (fixed pool)
stop_conditions:
  - Keep simple; we have few projects currently
priority: 3
tags:
  - autonomous
  - global-agent
  - infrastructure
estimate_hours: 2
status: parked
created_at: 2026-01-12
updated_at: 2026-01-22
depends_on:
  - WO-2026-079
era: v2
---
## Resource Model

```typescript
interface ResourcePool {
  vms: {
    total_available: number;
    in_use: number;
    idle: VMInstance[];  // Running but no active work
  };
  budget: {
    daily_limit: number;
    daily_used: number;
    monthly_limit: number;
    monthly_used: number;
  };
  capacity: {
    max_concurrent_runs: number;
    active_runs: number;
  };
}
```

## API

```
GET /global/resources
  - Current resource state

POST /global/resources/budget
  - Set budget limits

GET /global/resources/usage?range=7d
  - Usage history

POST /global/resources/stop-idle
  - Stop VMs idle > threshold
```

## Global Agent Considerations

```
Before delegating to project:
1. Check VM availability
2. Check budget remaining
3. Check concurrent run capacity

If constrained:
- Queue the work
- Or stop idle resources from other projects
- Or report to user for budget increase
```
