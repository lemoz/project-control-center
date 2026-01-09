---
id: WO-2026-026
title: Constitution Injection into Agent Prompts
goal: Inject the merged constitution (global + local) into all agent prompts - builder, reviewer, chat agent - so that agents make decisions aligned with user preferences and learned patterns.
context:
  - server/runner_agent.ts (builder and reviewer prompts)
  - server/chat_agent.ts (chat agent prompts)
  - WO-2026-024 (constitution storage and APIs)
  - WO-2026-025 (constitution generation)
acceptance_criteria:
  - Builder prompt includes relevant constitution sections before task instructions
  - Reviewer prompt includes constitution for evaluating code against user preferences
  - Chat agent prompt includes constitution for aligned responses and suggestions
  - Constitution is fetched fresh at start of each run/chat (not cached indefinitely)
  - Selective injection - only include relevant sections based on context (optional optimization)
  - Constitution clearly delineated in prompts (e.g., wrapped in XML tags)
  - Handle missing constitution gracefully (agents work without it, just less aligned)
  - Logging shows when constitution was injected and which sections
non_goals:
  - Dynamic constitution updates mid-run (constitution is fixed at run start)
  - Per-work-order constitution overrides (use project-level for now)
  - Constitution-aware response validation (checking if response follows constitution)
  - Automatic constitution updates based on agent behavior
stop_conditions:
  - If constitution adds too much to prompt length (over 2000 tokens), implement selective injection or summarization
  - If agents start over-indexing on constitution vs task requirements, reduce prominence in prompt
priority: 2
tags:
  - constitution
  - prompts
  - builder
  - reviewer
  - chat
  - autonomy
estimate_hours: 4
status: you_review
created_at: 2026-01-06
updated_at: 2026-01-09
depends_on:
  - WO-2026-024
era: v2
---
# Constitution Injection into Agent Prompts

## Overview

Once a constitution exists, it should inform all agent behavior. This work order adds constitution injection to builder, reviewer, and chat agent prompts.

## Injection Points

### Builder Agent (runner_agent.ts)

Inject after system context, before work order details:

```typescript
const builderPrompt = `
You are a Builder agent implementing a work order.

<constitution>
${constitution}
</constitution>

<work_order>
${workOrderContent}
</work_order>

<task>
Implement the work order following the acceptance criteria.
Follow the constitution for style, patterns, and decision-making.
</task>
`;
```

### Reviewer Agent (runner_agent.ts)

Inject to inform code review standards:

```typescript
const reviewerPrompt = `
You are a Reviewer agent evaluating code changes.

<constitution>
${constitution}
</constitution>

<work_order>
${workOrderContent}
</work_order>

<diff>
${diffContent}
</diff>

<task>
Review the changes against:
1. Work order acceptance criteria
2. Constitution style and anti-patterns
3. Code quality and correctness

Approve only if changes meet all criteria.
</task>
`;
```

### Chat Agent (chat_agent.ts)

Inject for aligned conversational responses:

```typescript
const chatSystemPrompt = `
You are a helpful assistant for Project Control Center.

<constitution>
${constitution}
</constitution>

Use the constitution to:
- Match the user's communication style
- Make suggestions aligned with their preferences
- Avoid patterns they've marked as anti-patterns
- Apply their decision heuristics when relevant
`;
```

## Implementation

### Fetching Constitution

```typescript
// server/constitution.ts
export function getConstitutionForProject(projectId: string | null): string {
  const global = readGlobalConstitution();
  const local = projectId ? readProjectConstitution(projectId) : null;
  return mergeConstitutions(global, local);
}

// Returns empty string if no constitution exists
// Agents should work fine without constitution, just less aligned
```

### Selective Injection (Optional Optimization)

If constitution gets long, inject only relevant sections:

```typescript
function selectRelevantSections(
  constitution: string,
  context: 'builder' | 'reviewer' | 'chat',
  workOrderTags?: string[]
): string {
  // Builder: Style, Anti-Patterns, Domain Knowledge
  // Reviewer: Style, Anti-Patterns, Success Patterns
  // Chat: Communication, Decision Heuristics

  // Could also filter by work order tags
  // e.g., if WO has "testing" tag, include testing-related sections
}
```

### Logging

```typescript
function injectConstitution(prompt: string, constitution: string, context: string): string {
  if (!constitution) {
    log(`[constitution] No constitution found, proceeding without`);
    return prompt;
  }

  log(`[constitution] Injecting ${constitution.length} chars into ${context} prompt`);
  log(`[constitution] Sections: ${extractSectionNames(constitution).join(', ')}`);

  return prompt.replace('{{CONSTITUTION}}', constitution);
}
```

## Prompt Template Updates

Update prompt templates to have a clear injection point:

```typescript
const BUILDER_PROMPT_TEMPLATE = `
You are a Builder agent.

{{CONSTITUTION}}

<work_order>
{{WORK_ORDER}}
</work_order>

...
`;
```

## Handling Missing Constitution

If no constitution exists:
1. Log that we're proceeding without
2. Remove the `<constitution>` section entirely (don't leave empty tags)
3. Agents work normally, just without personalization

```typescript
if (constitution.trim()) {
  prompt = prompt.replace('{{CONSTITUTION}}', `<constitution>\n${constitution}\n</constitution>`);
} else {
  prompt = prompt.replace('{{CONSTITUTION}}', '');
}
```

## Future: Project Runner Agent

When we build the autonomous project runner (future WO), it will also receive the constitution:

```typescript
const projectRunnerPrompt = `
You are an autonomous Project Runner managing ${projectName}.

<constitution>
${constitution}
</constitution>

<success_criteria>
${projectSuccessCriteria}
</success_criteria>

<task>
Analyze project state and determine next actions to move toward success.
Follow the constitution for all decisions.
</task>
`;
```

## Future: Global Ecosystem Agent

When we build the multi-project orchestrator (future WO), global constitution becomes critical:

```typescript
const ecosystemPrompt = `
You manage multiple projects toward the user's overall goals.

<global_constitution>
${globalConstitution}
</global_constitution>

<projects>
${projectSummaries}
</projects>

<task>
Prioritize and coordinate work across projects.
Spawn new projects when needs arise.
Follow the constitution for all meta-decisions.
</task>
`;
```
