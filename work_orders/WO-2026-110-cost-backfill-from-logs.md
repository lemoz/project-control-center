---
id: WO-2026-110
title: Cost Backfill from Run Logs
goal: Estimate and backfill token costs for historical runs using log data and model pricing.
context:
  - WO-2026-101 (cost tracking foundation) built the tables
  - 150 cost_records exist but all have 0 tokens (Codex doesn't expose usage)
  - Run logs have model names, iteration counts, timestamps
  - result.json files have output summaries (proxy for output tokens)
  - Can estimate costs retroactively to populate the data
acceptance_criteria:
  - Script to scan all historical runs and estimate costs
  - Estimate input tokens from WO content + context size
  - Estimate output tokens from result.json summaries + diffs
  - Apply correct model pricing (gpt-5.2-codex, claude-3-5-sonnet)
  - Backfill cost_records with estimates (mark as estimated)
  - Log estimation methodology for transparency
  - Summary report of total estimated costs
non_goals:
  - Perfect accuracy (estimates are fine, directionally correct)
  - Real-time token capture (that's separate WO)
stop_conditions:
  - If estimation is wildly inaccurate, document and adjust methodology
priority: 2
tags:
  - economy
  - data
  - backfill
estimate_hours: 3
status: done
created_at: 2026-01-15
updated_at: 2026-01-22
depends_on:
  - WO-2026-101
era: v2
---
## Estimation Methodology

### Input Token Estimation

For builder iterations:
```typescript
const estimateBuilderInputTokens = (run: Run, wo: WorkOrder) => {
  // Base context sent to builder
  const woContentTokens = countTokens(wo.content);  // ~500-2000
  const constitutionTokens = 1793;                   // From logs
  const systemPromptTokens = 2000;                   // Estimate

  // Per-iteration additions
  const testOutputTokens = 1000;  // Avg test failure output
  const reviewerFeedbackTokens = 500;

  return woContentTokens + constitutionTokens + systemPromptTokens +
         (run.iteration - 1) * (testOutputTokens + reviewerFeedbackTokens);
};
```

For reviewer iterations:
```typescript
const estimateReviewerInputTokens = (run: Run, wo: WorkOrder) => {
  const woContentTokens = countTokens(wo.content);
  const diffTokens = estimateDiffTokens(run);  // From git diff size
  const constitutionTokens = 1793;

  return woContentTokens + diffTokens + constitutionTokens + 2000;
};
```

### Output Token Estimation

```typescript
const estimateOutputTokens = (resultJson: BuilderResult) => {
  // result.json summary is ~10% of actual output
  const summaryTokens = countTokens(resultJson.summary);
  const changesTokens = countTokens(JSON.stringify(resultJson.changes));

  return (summaryTokens + changesTokens) * 10;  // Multiplier for full response
};
```

### Pricing (Jan 2026)

```typescript
const PRICING = {
  'gpt-5.2-codex': { input: 0.015, output: 0.060 },  // per 1K tokens
  'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
};
```

## Data Sources

1. **run.log** - Model names, iteration markers, timestamps
2. **result.json** - Output summaries per iteration
3. **work_orders/*.md** - WO content for input estimation
4. **git diff** - Change size per iteration

## Implementation

```bash
# Scan all runs
for run_dir in .system/runs/*/; do
  run_id=$(basename $run_dir)

  # Parse run.log for iterations
  iterations=$(grep "Builder iteration" $run_dir/run.log | wc -l)

  # Parse result.json files
  for result in $run_dir/builder/iter-*/result.json; do
    # Estimate and insert cost_record
  done
done
```

## Output

```sql
-- Mark backfilled records
INSERT INTO cost_records (
  ...,
  description  -- 'backfill-estimated'
)
```

## Validation

Compare estimates to any known costs from other sources:
- Anthropic/OpenAI billing dashboards
- Spot check a few runs manually
