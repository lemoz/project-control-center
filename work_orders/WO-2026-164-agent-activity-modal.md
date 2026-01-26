---
id: WO-2026-164
title: Agent Activity Detail Modal
status: done
priority: 1
tags:
  - live-demo
  - ui
  - agent
estimate_hours: 3
depends_on:
  - WO-2026-163
era: v2
updated_at: 2026-01-26
---
## Goal

Let users click on activity entries in the agent log to see full details - bash output, file contents, API responses.

## Context

- `AgentActivityPanel` shows parsed log entries
- Stream-json logs have full tool inputs/outputs in `tool_use_result`
- `parseShiftLog.ts` extracts activity entries

## Acceptance Criteria

- [ ] Clicking activity entry opens modal with full details
- [ ] Modal shows tool name, input, and output
- [ ] Bash commands show command and stdout/stderr
- [ ] Code/JSON content has syntax highlighting
- [ ] Modal scrollable for long outputs
- [ ] Dismissable via X, click outside, or Escape
