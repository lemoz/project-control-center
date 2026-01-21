---
id: WO-2026-112
title: Unified Observability Dashboard
goal: Single dashboard showing VM health, run status, costs, and system health at a glance.
context:
  - Inspired by Earl St Sauver's article on Claude Code workflows
  - Currently debugging requires manual log reading, SSH to VM, DB queries
  - Cost tracking exists but no visualization
  - Budget system exists but not surfaced
  - Your team of Claudes needs a platform team
acceptance_criteria:
  - VM health panel (disk, memory, CPU, containers)
  - Active runs panel (status, phase, duration)
  - Budget/cost panel (spend rate, runway, alerts)
  - Run timeline (recent runs with pass/fail indicators)
  - Live log tailing for active runs
  - Alerts for critical conditions (disk > 80%, budget exhausted)
  - Auto-refresh every 30 seconds
non_goals:
  - Full Grafana/Prometheus stack (keep it simple)
  - Historical analytics (just current state + recent history)
  - Mobile optimization
stop_conditions:
  - If too complex, ship VM health first, iterate
priority: 2
tags:
  - ui
  - observability
  - infrastructure
estimate_hours: 6
status: you_review
created_at: 2026-01-15
updated_at: 2026-01-21
depends_on:
  - WO-2026-110
era: v2
---
## Design

```
┌─────────────────────────────────────────────────────────────────┐
│ PCC Observability                              [Auto-refresh: ON]│
├──────────────────┬──────────────────┬───────────────────────────┤
│ VM Health        │ Budget           │ Active Runs               │
│ ────────────     │ ────────         │ ───────────               │
│ Disk: ████░ 21%  │ $127/$500 (25%)  │ WO-093 building  3m       │
│ Mem:  ███░░ 34%  │ Daily: $4.23     │ WO-095 building  3m       │
│ CPU:  █░░░░  8%  │ Runway: 12 days  │ WO-096 testing   1m       │
│ Containers: 3    │ [Add Funds]      │ WO-100 building  3m       │
│                  │                  │ WO-109 ai_review 5m       │
│ [SSH] [Logs]     │ [History]        │                           │
├──────────────────┴──────────────────┴───────────────────────────┤
│ Run Timeline (24h)                                               │
│ ──────────────────────────────────────────────────────────────  │
│ 6am    9am    12pm   3pm    6pm    9pm    12am   3am    now     │
│  ●      ●●     ●      ●●●    ●●     ●      ●●●    ●●     ◐◐◐◐◐ │
│  ✓      ✓✗     ✓      ✓✓✗    ✓✓     ✗      ✓✓✓    ✓✓     ◐◐◐◐◐ │
│                                                                  │
│ Legend: ● complete  ◐ in progress  ✓ passed  ✗ failed           │
├──────────────────────────────────────────────────────────────────┤
│ Alerts                                                           │
│ ──────                                                           │
│ (none)                                                           │
├──────────────────────────────────────────────────────────────────┤
│ Live Logs: WO-2026-093                               [Select ▼]  │
│ ──────────────────────────────────────────────────────────────  │
│ [17:45:23] Builder iteration 1 starting                          │
│ [17:45:24] Syncing worktree to VM workspace                      │
│ [17:45:27] Running codex in container pcc-run-xxx-builder-1      │
│ [17:45:32] [DEBUG] OPENAI_API_KEY length: 164                    │
│ █                                                                │
└──────────────────────────────────────────────────────────────────┘
```

## API Endpoints

```typescript
// New endpoints for dashboard
GET /observability/vm-health
Response: {
  disk: { used_gb, total_gb, percent },
  memory: { used_gb, total_gb, percent },
  cpu: { load_1m, load_5m, percent },
  containers: [{ name, status, uptime }],
  reachable: boolean,
  last_check: string
}

GET /observability/runs/active
Response: [{
  id, work_order_id, status, phase,
  started_at, duration_seconds,
  current_activity: string  // Latest log line
}]

GET /observability/runs/timeline
  ?hours=24
Response: [{
  id, work_order_id, status,
  started_at, finished_at,
  outcome: 'passed' | 'failed' | 'in_progress'
}]

GET /observability/budget/summary
Response: {
  monthly_budget, spent, remaining,
  daily_rate, runway_days,
  status: 'healthy' | 'warning' | 'critical'
}

GET /observability/alerts
Response: [{
  id, type, severity, message,
  created_at, acknowledged: boolean
}]

GET /runs/:id/logs/tail
  ?lines=50
Response: { lines: string[], has_more: boolean }

WS /runs/:id/logs/stream
  -> Real-time log lines
```

## Alert Conditions

```typescript
const ALERT_CONDITIONS = [
  { type: 'vm_disk', threshold: 0.8, message: 'VM disk > 80%' },
  { type: 'vm_disk', threshold: 0.95, severity: 'critical', message: 'VM disk > 95%' },
  { type: 'vm_unreachable', message: 'Cannot reach VM' },
  { type: 'budget_warning', threshold: 0.25, message: 'Budget < 25% remaining' },
  { type: 'budget_exhausted', message: 'Budget exhausted' },
  { type: 'run_stuck', duration_minutes: 30, message: 'Run stuck for 30+ minutes' },
  { type: 'baseline_failures', count: 3, message: '3+ consecutive baseline failures' },
];
```

## Implementation Phases

### Phase 1: VM Health + Active Runs
- SSH to VM for metrics
- Query runs table for active
- Simple panel layout

### Phase 2: Budget Integration
- Pull from budget tables
- Calculate runway
- Add alerts

### Phase 3: Timeline + Logs
- Historical run query
- Log tailing (file read)
- WebSocket for streaming

### Phase 4: Alerts
- Background checker
- Alert persistence
- Notification hooks

## Component Structure

```
app/
  observability/
    page.tsx              # Main dashboard
    components/
      VMHealthPanel.tsx
      ActiveRunsPanel.tsx
      BudgetPanel.tsx
      RunTimeline.tsx
      LiveLogs.tsx
      AlertsBanner.tsx
    hooks/
      useVMHealth.ts      # Polling hook
      useActiveRuns.ts
      useLogStream.ts     # WebSocket hook
```
