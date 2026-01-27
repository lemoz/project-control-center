---
id: WO-2026-219
title: Incident logging and analytics
status: you_review
priority: 2
tags:
  - monitoring
  - logging
  - analytics
  - security
estimate_hours: 2
depends_on:
  - WO-2026-215
era: v2
updated_at: 2026-01-27
goal: Persist security incidents to database and provide analytics to improve monitoring accuracy over time.
context:
  - Stream monitor (WO-2026-215) generates incidents
  - Need to track false positive rate to tune patterns
  - Incidents should be queryable for debugging and improvement
  - Similar logging patterns exist for runs and escalations in server/db.ts
acceptance_criteria:
  - New security_incidents table in SQLite database
  - Columns include id, run_id, timestamp, pattern_matched, agent_output_snippet, gemini_verdict, gemini_reason, action_taken, user_resolution, false_positive flag
  - createSecurityIncident() function called by stream monitor
  - updateIncidentResolution() called when user resumes or aborts
  - If user resumes, prompt to mark as false positive (optional)
  - API endpoint GET /security-incidents with filters (date range, verdict, false_positive)
  - API endpoint PATCH /security-incidents/:id for marking false positive
  - Summary stats function getIncidentStats() returns total, by verdict, false positive rate
  - Stats displayed in settings or observability dashboard
  - Incidents older than 90 days auto-archived (not deleted)
non_goals:
  - Pattern auto-tuning based on false positives (manual for now)
  - Exporting incidents
  - Real-time incident alerting (just logging)
stop_conditions:
  - If analytics reveal very high false positive rate (>20%), pause and review patterns before continuing
---
## Database Schema

```sql
CREATE TABLE security_incidents (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,

  -- Detection info
  pattern_category TEXT NOT NULL,  -- 'prompt_injection', 'dangerous_command', etc.
  pattern_matched TEXT NOT NULL,   -- the actual regex that matched
  trigger_content TEXT NOT NULL,   -- the content that triggered detection

  -- Context
  agent_output_snippet TEXT,       -- last 2000 chars of output
  wo_id TEXT,
  wo_goal TEXT,

  -- Gemini analysis
  gemini_verdict TEXT NOT NULL,    -- 'SAFE', 'WARN', 'KILL'
  gemini_reason TEXT,
  gemini_latency_ms INTEGER,

  -- Action
  action_taken TEXT NOT NULL,      -- 'killed', 'warned', 'allowed'

  -- Resolution (filled in later by user)
  user_resolution TEXT,            -- 'resumed', 'aborted', null
  false_positive INTEGER DEFAULT 0,
  resolution_timestamp TEXT,
  resolution_notes TEXT,

  -- Metadata
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT
);

CREATE INDEX idx_incidents_run ON security_incidents(run_id);
CREATE INDEX idx_incidents_project ON security_incidents(project_id);
CREATE INDEX idx_incidents_timestamp ON security_incidents(timestamp);
CREATE INDEX idx_incidents_verdict ON security_incidents(gemini_verdict);
```

## Analytics Queries

```typescript
interface IncidentStats {
  total: number;
  by_verdict: { SAFE: number; WARN: number; KILL: number };
  by_category: Record<string, number>;
  false_positive_rate: number;  // false_positives / total_resolved
  avg_gemini_latency_ms: number;
  last_7_days: number;
  last_30_days: number;
}
```

## False Positive Tracking

When user clicks "Resume Run" after security_hold:
1. Show dialog: "Was this a false positive?"
2. If yes, mark incident.false_positive = 1
3. Log the pattern that caused false positive
4. Over time, patterns with high FP rate can be reviewed
