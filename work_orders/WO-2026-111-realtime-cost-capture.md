---
id: WO-2026-111
title: Real-time Cost Capture from Codex
goal: Capture actual token usage from Codex runs as they happen.
context:
  - WO-2026-110 (backfill) handles historical data
  - Codex CLI doesn't expose token counts in output
  - Need to either parse Codex internals or estimate in real-time
  - OpenAI API has usage in response; Codex wraps this
acceptance_criteria:
  - Capture token usage per builder iteration
  - Capture token usage per reviewer iteration
  - Store in cost_records with actual (not estimated) flag
  - Handle cases where usage unavailable (fallback to estimation)
  - Log when falling back to estimation
non_goals:
  - Modifying Codex CLI itself
  - Perfect accuracy when Codex doesn't expose data
stop_conditions:
  - If Codex truly doesn't expose usage, document and use estimation
priority: 2
tags:
  - economy
  - infrastructure
  - integration
estimate_hours: 4
status: you_review
created_at: 2026-01-15
updated_at: 2026-01-21
depends_on:
  - WO-2026-110
era: v2
---
## Research Needed

### Codex CLI Output

Check if Codex exposes usage in:
1. `--json` output mode
2. `result.json` artifacts
3. Environment variables
4. Separate usage file

```bash
# Test with verbose output
codex exec --json --verbose ... 2>&1 | grep -i "token\|usage"
```

### OpenAI API Direct

If using OpenAI API directly (not Codex):
```typescript
const response = await openai.chat.completions.create({...});
console.log(response.usage);
// { prompt_tokens: 1234, completion_tokens: 567, total_tokens: 1801 }
```

## Implementation Options

### Option A: Parse Codex Output

If Codex exposes usage somewhere:
```typescript
const parseCodexUsage = (output: string): TokenUsage | null => {
  // Look for usage patterns in output
  const match = output.match(/tokens.*?(\d+)/i);
  return match ? { total: parseInt(match[1]) } : null;
};
```

### Option B: Wrap OpenAI Calls

Intercept the underlying API calls:
```typescript
// Proxy that logs usage
const openaiWithLogging = new Proxy(openai, {
  get(target, prop) {
    if (prop === 'chat') {
      return {
        completions: {
          create: async (params) => {
            const result = await target.chat.completions.create(params);
            logUsage(result.usage);
            return result;
          }
        }
      };
    }
    return target[prop];
  }
});
```

### Option C: Real-time Estimation

If no usage available, estimate during run:
```typescript
const estimateOnTheFly = (input: string, output: string): TokenUsage => {
  // Use tiktoken or similar for accurate count
  return {
    input_tokens: tiktoken.encode(input).length,
    output_tokens: tiktoken.encode(output).length,
  };
};
```

## Integration Points

1. **runner_agent.ts** - After builder/reviewer completes
2. **chat_actions.ts** - After chat completions
3. **handoff generator** - After handoff generation

## Fallback Chain

```typescript
const captureUsage = async (phase: string, result: any): Promise<TokenUsage> => {
  // Try to get actual usage
  if (result.usage) {
    return { ...result.usage, source: 'actual' };
  }

  // Try to parse from output
  const parsed = parseCodexUsage(result.output);
  if (parsed) {
    return { ...parsed, source: 'parsed' };
  }

  // Fall back to estimation
  return {
    ...estimateOnTheFly(result.input, result.output),
    source: 'estimated'
  };
};
```
