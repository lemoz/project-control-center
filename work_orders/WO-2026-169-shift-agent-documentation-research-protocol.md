---
id: WO-2026-169
title: Shift agent documentation research protocol
status: ready
priority: 2
tags:
  - shift-agent
  - prompts
  - documentation
estimate_hours: 1
depends_on:
  - WO-2026-168
era: v2
updated_at: 2026-01-28
goal: Teach shift agents to pre-research and embed documentation in work orders before creating/updating them, since builder/reviewer agents are sandboxed without internet access.
context:
  - Shift agent prompts at prompts/shift_agent.md and prompts/shift_agent_vm.md
  - Shift agents have internet access (WebFetch, WebSearch, headless browser)
  - Builders/reviewers are sandboxed - they cannot fetch docs themselves
  - Currently no guidance telling shift agents to research docs before WO creation
acceptance_criteria:
  - prompts/shift_agent.md includes "Documentation Research Protocol" section
  - prompts/shift_agent_vm.md includes same section (adapted for headless browser)
  - Section explains builder/reviewer sandbox constraints
  - Section provides workflow: research docs → extract patterns → embed in WO context
  - Includes example showing how to PATCH documentation into a WO
  - Lists when to research (new libraries, external APIs, unfamiliar patterns)
  - Lists what to include (install commands, API signatures, code examples)
non_goals:
  - Auto-fetching docs based on WO tags
  - Modifying builder/reviewer prompts (covered by WO-2026-168)
stop_conditions:
  - If shift agent prompt structure differs significantly between versions, stop and clarify
---
