---
id: WO-2026-084
title: User Preference Learning
goal: Learn and apply user preferences to improve global agent decisions.
context:
  - Users have patterns (review PRs in morning, prefer certain project focus)
  - Escalation batching based on availability
  - Reduce friction by anticipating needs
acceptance_criteria:
  - Track user interaction patterns (when, what actions)
  - Store explicit preferences (priority projects, quiet hours)
  - Apply preferences in global agent decisions
  - Respect quiet hours for non-urgent escalations
non_goals:
  - Complex ML (simple heuristics + explicit settings)
  - Calendar integration (future WO)
stop_conditions:
  - Start with explicit preferences, add learned patterns later
priority: 4
tags:
  - autonomous
  - global-agent
  - ux
estimate_hours: 2
status: ready
created_at: 2026-01-12
updated_at: 2026-01-13
depends_on:
  - WO-2026-079
era: v2
---
## Preference Model

```typescript
interface UserPreferences {
  // Explicit settings
  quiet_hours: { start: "22:00", end: "08:00" };
  priority_projects: string[];  // Focus on these first
  escalation_batch_minutes: number;  // Batch non-urgent for this long

  // Learned patterns
  typical_active_hours: { start: string, end: string };
  avg_response_time_minutes: number;
  preferred_review_time: string;  // When they usually review PRs
}
```

## API

```
GET /global/preferences
  - Get current preferences

PATCH /global/preferences
  - Update explicit preferences

GET /global/preferences/patterns
  - View learned patterns (read-only)
```

## Application

```
Global agent checks preferences before:
- Escalating to user (respect quiet hours)
- Batching escalations (don't interrupt too frequently)
- Prioritizing projects (user's priority list first)
- Scheduling handoff reports (send at preferred time)
```
