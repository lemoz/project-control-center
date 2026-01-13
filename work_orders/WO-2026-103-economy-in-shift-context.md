---
id: WO-2026-103
title: Economy in Shift Context
goal: Add budget and cost data to shift context so agents are aware of their financial situation when making decisions.
context:
  - WO-2026-102 (budget allocation system)
  - Agents should know their runway and budget status
  - Enables cost-aware decision making
  - "Part of the context would be where are they at with their budget, how much runway do they have"
acceptance_criteria:
  - Add economy field to ShiftContext type
  - Include budget remaining, burn rate, runway days
  - Include budget status (healthy/warning/critical/exhausted)
  - Include cost efficiency metrics (cost per WO, cost per run)
  - Economy data fetched when building shift context
  - Global agent also sees portfolio-wide economy summary
  - Shift decision prompt includes economy awareness
non_goals:
  - Automatic behavior changes based on budget (that's WO-2026-104)
  - Budget modification from within shift
stop_conditions:
  - If economy data is too noisy, summarize to key metrics only
priority: 2
tags:
  - economy
  - shift
  - context
estimate_hours: 3
status: backlog
created_at: 2026-01-13
updated_at: 2026-01-13
depends_on:
  - WO-2026-102
era: v2
---
## ShiftContext Addition

```typescript
interface ShiftContext {
  // ... existing fields ...

  economy: {
    // Budget status
    budget_allocation_usd: number;
    budget_remaining_usd: number;
    budget_status: 'healthy' | 'warning' | 'critical' | 'exhausted';

    // Burn rate
    burn_rate_daily_usd: number;    // Average over last 7 days
    runway_days: number;            // At current burn rate

    // Period info
    period_days_remaining: number;
    daily_drip_usd: number;         // Budget per day remaining

    // Efficiency metrics
    avg_cost_per_run_usd: number;
    avg_cost_per_wo_completed_usd: number;

    // This period
    spent_this_period_usd: number;
    runs_this_period: number;
    wos_completed_this_period: number;
  };
}
```

## Global Context Addition

```typescript
interface GlobalContextResponse {
  // ... existing fields ...

  economy: {
    // Global budget
    monthly_budget_usd: number;
    total_allocated_usd: number;
    total_spent_usd: number;
    total_remaining_usd: number;

    // Portfolio health
    projects_healthy: number;
    projects_warning: number;
    projects_critical: number;
    projects_exhausted: number;

    // Efficiency
    portfolio_burn_rate_daily_usd: number;
    portfolio_runway_days: number;
  };
}
```

## Shift Decision Prompt Addition

Add economy awareness to the shift prompt:

```
## Economy Status

Budget: $45.23 remaining of $150 allocation (30%)
Status: WARNING - below 50% with 18 days left in period
Burn rate: $5.80/day average
Runway: 7.8 days at current rate

Daily drip available: $2.51

Cost efficiency:
- Avg cost per run: $3.42
- Avg cost per WO completed: $8.15

Consider:
- Prioritize high-value WOs
- Avoid speculative exploration
- Request budget increase if blocked on critical work
```

## Agent Behavior Hints

The prompt should guide budget-aware behavior:

**Healthy (>50% remaining):**
- Normal operations
- Can explore, experiment
- Full autonomy

**Warning (25-50% remaining):**
- Prioritize high-impact work
- Reduce speculative runs
- Consider efficiency

**Critical (<25% remaining):**
- Essential work only
- Flag to user if blocked
- Conservative decisions

**Exhausted (0% remaining):**
- Cannot start new runs
- Escalate to user
- Document what's blocked

## Implementation

1. Update `buildShiftContext()` in `shift_context.ts`
2. Add `buildEconomyContext()` helper
3. Update `buildGlobalContextResponse()` in `global_context.ts`
4. Update shift decision prompt builder
5. Update global decision prompt builder
