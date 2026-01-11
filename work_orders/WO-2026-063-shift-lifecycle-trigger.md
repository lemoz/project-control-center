---
id: WO-2026-063
title: Shift Lifecycle & Trigger
goal: Create mechanism to start, track, and end agent shifts on projects.
context:
  - docs/agent_shift_protocol.md (WO-2026-060)
  - WO-2026-061 (context assembly)
  - WO-2026-062 (handoff storage)
  - Need to know when a shift is active to prevent conflicts
acceptance_criteria:
  - API to start a shift (POST /projects/:id/shifts)
  - API to end a shift with handoff (POST /projects/:id/shifts/:id/complete)
  - Track active shift per project (only one at a time)
  - Shift timeout handling (stale shifts auto-expire)
  - Starting a shift returns assembled context
  - Ending a shift requires handoff
non_goals:
  - Scheduled/automated shift triggering (future WO)
  - Multi-agent concurrent shifts
  - UI for shift management
stop_conditions:
  - If lifecycle becomes complex, simplify to start/end only
priority: 2
tags:
  - autonomous
  - lifecycle
  - api
estimate_hours: 3
status: backlog
created_at: 2026-01-11
updated_at: 2026-01-11
depends_on:
  - WO-2026-061
  - WO-2026-062
era: v2
---

## Implementation

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,

  -- Status
  status TEXT NOT NULL DEFAULT 'active',  -- active, completed, expired, failed

  -- Who/what
  agent_type TEXT,      -- 'claude_code', 'codex', 'human', etc.
  agent_id TEXT,        -- Specific identifier if available

  -- Timing
  started_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT,      -- Auto-expire stale shifts

  -- Outcome
  handoff_id TEXT,      -- Links to shift_handoffs
  error TEXT,

  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (handoff_id) REFERENCES shift_handoffs(id)
);

CREATE INDEX IF NOT EXISTS idx_shifts_project_status
  ON shifts(project_id, status);
```

### API Endpoints

```typescript
// Start a shift
POST /projects/:id/shifts
Body: {
  agent_type?: string;
  agent_id?: string;
  timeout_minutes?: number;  // Default 120
}
Returns: {
  shift: Shift;
  context: ShiftContext;  // From WO-2026-061
}
Error: 409 if shift already active

// Get active shift
GET /projects/:id/shifts/active
Returns: Shift | null

// Complete a shift
POST /projects/:id/shifts/:shiftId/complete
Body: CreateHandoffInput  // From WO-2026-062
Returns: {
  shift: Shift;
  handoff: ShiftHandoff;
}

// Abandon a shift (no handoff, marks as failed)
POST /projects/:id/shifts/:shiftId/abandon
Body: { reason?: string }
Returns: Shift

// List recent shifts
GET /projects/:id/shifts?limit=10
Returns: Shift[]
```

### Shift Expiration

Background job or lazy check:
- If shift.expires_at < now and status = 'active'
- Mark as 'expired'
- Free up project for new shift

### Files to Modify

1. `server/db.ts` - Add shifts table and functions
2. `server/index.ts` - Add endpoints
3. `server/shift_context.ts` - Integrate with start shift
