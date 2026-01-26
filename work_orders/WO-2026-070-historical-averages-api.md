---
id: WO-2026-070
title: Historical Averages API
goal: Provide an API endpoint that returns historical run timing data for use in LLM estimation prompts.
context:
  - LLM needs grounding data to make accurate estimates
  - Should support per-project and global averages
  - Include recent similar WOs for context
acceptance_criteria:
  - Endpoint returns avg phase times (setup, builder, reviewer)
  - Returns avg iteration count
  - Returns recent completed runs with their WO tags and times
  - Supports filtering by project_id or global
  - Returns data in format ready to inject into LLM prompt
non_goals:
  - The estimation logic itself (WO-2026-071)
  - Caching or performance optimization
  - Complex similarity matching
stop_conditions:
  - If similarity matching is complex, use simple tag-based matching
priority: 2
tags:
  - autonomous
  - api
  - estimation
estimate_hours: 1.5
status: done
created_at: 2026-01-12
updated_at: 2026-01-26
depends_on:
  - WO-2026-069
era: v2
---
## Implementation

### API Endpoint

```typescript
GET /repos/:id/estimation-context
Query params:
  - wo_id?: string  // Current WO being estimated (to find similar)
  - limit?: number  // Recent runs to include (default 5)

Returns: {
  averages: {
    setup_seconds: number;
    builder_seconds: number;
    reviewer_seconds: number;
    test_seconds: number;
    iterations: number;
    total_seconds: number;
  };
  recent_runs: Array<{
    wo_id: string;
    wo_title: string;
    wo_tags: string[];
    wo_estimate_hours: number;
    iterations: number;
    total_seconds: number;
    outcome: 'approved' | 'failed';
  }>;
  sample_size: number;
}
```

### Similar WO Matching

Simple tag-based similarity:
1. Get tags from current WO
2. Find recent runs where WO had overlapping tags
3. Weight by recency and tag overlap count

### Files to Modify

1. `server/db.ts` - Query functions for aggregated metrics
2. `server/index.ts` - Add endpoint
