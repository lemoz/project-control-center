---
id: WO-2026-071
title: LLM Estimation Service
goal: Create a service that uses an LLM to estimate run time before a run starts, given the WO content and historical data.
context:
  - LLM can understand WO complexity in ways heuristics can't
  - Historical data grounds the estimate in reality
  - Use fast/cheap model (haiku) to minimize latency and cost
acceptance_criteria:
  - Function that takes WO content + historical context → estimate
  - Uses Claude haiku for speed
  - Returns: estimated_iterations, estimated_minutes, confidence, reasoning
  - Estimate stored in run record before run starts
  - Prompt engineered for accurate estimation
non_goals:
  - Progressive updates during run (WO-2026-072)
  - UI display (WO-2026-073)
  - Fine-tuning or custom models
stop_conditions:
  - If estimates are wildly inaccurate, add calibration factor
priority: 2
tags:
  - autonomous
  - llm
  - estimation
estimate_hours: 2
status: done
created_at: 2026-01-12
updated_at: 2026-01-27
depends_on:
  - WO-2026-070
era: v2
---
## Implementation

### Estimation Function

```typescript
interface RunEstimate {
  estimated_iterations: number;  // 1-5
  estimated_minutes: number;     // 20-120
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;             // Brief explanation
}

async function estimateRunTime(
  woContent: string,
  historicalContext: EstimationContext
): Promise<RunEstimate>
```

### Prompt Template

```
You are estimating wall-clock time for an autonomous code agent run.

## Historical Data
- Average setup: {{avg_setup}} seconds
- Average builder phase: {{avg_builder}} seconds
- Average reviewer phase: {{avg_reviewer}} seconds
- Average iterations: {{avg_iterations}}
- Average total time: {{avg_total}} seconds

## Recent Similar Runs
{{#each recent_runs}}
- {{wo_title}}: {{iterations}} iterations, {{total_minutes}} min ({{outcome}})
{{/each}}

## Work Order to Estimate
{{wo_content}}

## Instructions
Based on the work order complexity, estimate:
1. Likely iterations (1-5): More files, new patterns, or complex logic = more iterations
2. Total time in minutes
3. Confidence (high/medium/low)
4. Brief reasoning (1-2 sentences)

Respond in JSON: {"estimated_iterations": N, "estimated_minutes": N, "confidence": "...", "reasoning": "..."}
```

### Integration Points

1. Called when run is kicked off (before setup starts)
2. Estimate stored in runs table (new columns or JSON field)
3. Available via GET /runs/:id for UI display

### Files to Modify

1. `server/estimation.ts` - New file for estimation logic
2. `server/runner_agent.ts` - Call estimation before run loop
3. `server/db.ts` - Add estimate fields to runs table
