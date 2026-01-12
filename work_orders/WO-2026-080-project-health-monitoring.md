---
id: WO-2026-080
title: Project Health Monitoring
goal: Detect and surface project health issues (stalled, failing, blocked) for global agent attention.
context:
  - Global agent needs to know which projects need help
  - Projects can get stuck without explicit escalation
  - Proactive detection vs reactive escalation
acceptance_criteria:
  - Health score per project (healthy, attention_needed, stalled, failing)
  - Detection rules (no runs in X days, Y consecutive failures, etc.)
  - Health included in global context
  - Optional alerts/triggers for state changes
non_goals:
  - Auto-remediation (global agent decides action)
  - Notification system
stop_conditions:
  - Start with simple heuristics, evolve based on patterns
priority: 3
tags:
  - autonomous
  - global-agent
  - monitoring
estimate_hours: 2
status: backlog
created_at: 2026-01-12
updated_at: 2026-01-12
depends_on:
  - WO-2026-079
era: v2
---
## Health Rules

```typescript
function calculateProjectHealth(project: Project): HealthStatus {
  // Failing: 3+ consecutive failed runs
  if (recentFailureStreak(project) >= 3) return 'failing';

  // Stalled: no runs in 3+ days with ready WOs
  if (daysSinceLastRun(project) > 3 && hasReadyWOs(project)) return 'stalled';

  // Blocked: all WOs blocked on dependencies
  if (allWOsBlocked(project)) return 'blocked';

  // Attention needed: pending escalations or long-running shift
  if (hasUnresolvedEscalations(project)) return 'attention_needed';

  return 'healthy';
}
```

## Health Summary

```typescript
interface ProjectHealth {
  project_id: string;
  status: 'healthy' | 'attention_needed' | 'stalled' | 'failing' | 'blocked';
  reasons: string[];  // Why this status
  last_activity: string;
  metrics: {
    days_since_run: number;
    recent_failure_rate: number;
    pending_escalations: number;
    ready_wo_count: number;
  };
}
```
