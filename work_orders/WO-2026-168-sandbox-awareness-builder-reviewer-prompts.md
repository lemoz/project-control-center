---
id: WO-2026-168
title: Sandbox awareness for builder/reviewer prompts
status: backlog
priority: 2
tags:
  - runner
  - builder
  - reviewer
  - prompts
estimate_hours: 1
depends_on: []
era: v2
updated_at: 2026-01-26
goal: Add execution environment context to builder and reviewer prompts so they know they're sandboxed without internet access and won't waste iterations trying to fetch external resources.
context:
  - Builder runs with --sandbox workspace-write, reviewer with --sandbox read-only
  - Neither agent can access internet (no curl, WebFetch, or external APIs)
  - Prompts built dynamically in server/runner_agent.ts (buildBuilderPrompt, buildReviewerPrompt)
  - Currently prompts don't mention sandbox - agents may try to fetch docs and fail
acceptance_criteria:
  - buildBuilderPrompt() includes "Execution Environment" section explaining sandbox constraints
  - buildReviewerPrompt() includes similar awareness section
  - Both mention: no internet access, can't fetch URLs/APIs/docs, all context must come from WO
  - Builder prompt advises to escalate if critical documentation is missing from WO
non_goals:
  - Changing actual sandbox permissions or flags
  - Auto-fetching documentation
  - Adding internet access to sandboxed agents
stop_conditions:
  - If prompt changes require modifying CLI sandbox flags, stop and report
---
