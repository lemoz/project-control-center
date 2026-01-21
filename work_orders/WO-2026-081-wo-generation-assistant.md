---
id: WO-2026-081
title: WO Generation Assistant
goal: Help global agent create well-formed work orders for projects from high-level descriptions or pain points.
context:
  - User says "I want feature X" → needs WO with proper structure
  - Pain points from projects → translate to actionable WOs
  - Maintain consistency with project patterns
acceptance_criteria:
  - Generate WO from natural language description
  - Include goal, acceptance criteria, stop conditions
  - Suggest dependencies based on existing WOs
  - Estimate hours based on similar past WOs
  - Validate WO meets ready_check requirements
non_goals:
  - Auto-approve generated WOs (user or global agent reviews)
  - Execute WOs (separate flow)
stop_conditions:
  - If generation quality is poor, require more user input
priority: 3
tags:
  - autonomous
  - global-agent
  - tooling
estimate_hours: 3
status: you_review
created_at: 2026-01-12
updated_at: 2026-01-21
depends_on:
  - WO-2026-079
era: v2
---
## Interface

```typescript
interface WOGenerationRequest {
  project_id: string;
  description: string;  // Natural language
  type?: 'feature' | 'bugfix' | 'refactor' | 'research';
  priority?: number;
}

interface GeneratedWO {
  draft: WorkOrder;
  confidence: number;
  suggestions: string[];  // Things to clarify
  similar_wos: string[];  // Reference WOs
}
```

## API

```
POST /projects/:id/work-orders/generate
Body: { description: "Add dark mode support" }

Response: {
  draft: {
    id: "WO-2026-XXX",
    title: "Add Dark Mode Support",
    goal: "...",
    acceptance_criteria: [...],
    stop_conditions: [...],
    depends_on: [...],
    estimate_hours: 4
  },
  confidence: 0.8,
  suggestions: ["Clarify: CSS-only or system preference detection?"],
  similar_wos: ["WO-2025-042"]
}
```

## Implementation

1. Use Claude to generate structured WO from description
2. Query existing WOs for context and patterns
3. Use run metrics for time estimation
4. Return draft for review before creation
