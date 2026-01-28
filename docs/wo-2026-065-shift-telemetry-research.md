# WO-2026-065 Shift Telemetry Research

Status: Research Complete

## Scope
- Parsed three recent shift logs from `.system/shifts/<shift_id>/agent.log`.
- Extracted tool usage counts, API call patterns, wait time (sleep), and tool errors.
- Cross-checked which telemetry signals were actionable vs noise.

Shift samples used:
- `a82269b1-4c22-45e9-8e64-68113bd4ca74`
- `ba6b3932-a83c-44b1-9dd8-1c2b0a25936e`
- `c9f95d69-43cc-49fe-8989-b2929e19c349`

## Telemetry candidates (value assessment)

High-signal (keep)
- Run lifecycle summary: runs started, runs completed, failures, and the run ids polled most often.
- Wait time while polling runs (sum of explicit `sleep` durations) to expose blocked time.
- Tool usage summary (Bash vs Read/Edit/Write/TodoWrite) and error count.
- Mutating API calls (POST/PATCH) vs GET to show actual changes made vs monitoring.
- Work orders touched (WO ids referenced in endpoints).

Medium-signal (conditional)
- Top API endpoints hit (useful for diagnosing feedback loops like over-polling).
- Communications/escalations handled (reads, acknowledgements, provide-input calls).

Low-signal / likely noise
- Full command history (too verbose, rarely actionable).
- File-level diffs for shift agent (usually none; more relevant for builder runs).
- Time split (research vs execute) without explicit phase markers; logs do not include timestamps.

## Prototype storage schema

Minimal attachment to `shift_handoffs` (preferred):

```sql
ALTER TABLE shift_handoffs ADD COLUMN telemetry_json TEXT;
```

Example JSON payload:

```json
{
  "tool_usage": { "Bash": 272, "Read": 5, "Edit": 0, "Write": 0, "TodoWrite": 16 },
  "api": {
    "get": 117,
    "post": 8,
    "patch": 1,
    "top_endpoints": {
      "/runs/2983b3b1-1b67-4f75-bb83-aa3a6493011a": 81,
      "/projects/project-control-center/shift-context": 5
    }
  },
  "wait_time_seconds": 3020,
  "tool_errors": 27,
  "work_orders_touched": ["WO-2026-035", "WO-2026-034", "WO-2026-037"],
  "runs_polled": {
    "2983b3b1-1b67-4f75-bb83-aa3a6493011a": 81
  }
}
```

Optional event table (only if we need event-level drill-down):

```sql
CREATE TABLE IF NOT EXISTS shift_telemetry_events (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shift_telemetry_events_shift
  ON shift_telemetry_events(shift_id, created_at DESC);
```

If we need real time allocation, add explicit phase events (e.g., `phase_start` / `phase_end`) so durations are computable without inference.

## 3-shift sample findings

Shift `a82269b1-4c22-45e9-8e64-68113bd4ca74`
- Tool uses: 306 total (Bash 272, TodoWrite 16, TaskOutput 8, Read 5)
- API calls: 126 curl (GET 117, POST 8, PATCH 1)
- Wait time: 3020s from `sleep` commands (~50m)
- Tool errors: 27
- Dominant endpoint: `/runs/2983b3b1-1b67-4f75-bb83-aa3a6493011a` polled 81 times

Shift `ba6b3932-a83c-44b1-9dd8-1c2b0a25936e`
- Tool uses: 197 total (Bash 177, TodoWrite 12, Read 8)
- API calls: 106 curl (GET 93, PATCH 9, POST 4)
- Wait time: 4740s from `sleep` commands (~79m)
- Tool errors: 2
- Dominant endpoints: run polling across three run ids (28 + 23 + 13 GETs)

Shift `c9f95d69-43cc-49fe-8989-b2929e19c349`
- Tool uses: 128 total (Bash 116, TodoWrite 7, Read 4)
- API calls: 82 curl (GET 71, PATCH 8, POST 3)
- Wait time: 1260s from `sleep` commands (~21m)
- Tool errors: 2
- Dominant endpoints: two run ids polled 18 times each

Observed pattern: shift activity is dominated by Bash + curl polling, with significant time waiting on runs. This makes run lifecycle + wait-time telemetry immediately useful, while granular command logs are not.

## Recommendations

Add (high value)
- Aggregated tool usage counts + error count (low cost, high signal).
- Run lifecycle and polling summary (top run ids + counts, run outcomes).
- Wait time in seconds (requires explicit tracking, but even `sleep` aggregation is useful).
- Work order ids touched (from API endpoints).

Hold (only if needed)
- Endpoint frequency list beyond top 5 (can be derived when needed).
- Detailed event log table (only if debugging requires it).

Skip for now (noise)
- Full command transcripts and tool outputs.
- Fine-grained time split without explicit phase markers.

Stop condition
- If telemetry requires full event logging or high-frequency writes without materially improving next-shift decisions, keep it minimal (aggregated JSON on shift handoff only).
