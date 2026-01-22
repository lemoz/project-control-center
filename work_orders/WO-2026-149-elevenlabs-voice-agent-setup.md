---
id: WO-2026-149
title: ElevenLabs Voice Agent Setup
goal: Configure an ElevenLabs agent for the PCC landing page with system prompt, voice, LLM, and tool definitions.
context:
  - WO-2026-143 research doc (docs/wo-2026-143-elevenlabs-conversational-ai-research.md)
  - Agent guides users through the orbital canvas, explains WOs and runs
  - Uses Claude Sonnet 4 as LLM
  - Server tools (webhooks) call PCC API endpoints
  - Client tools trigger canvas UI actions
acceptance_criteria:
  - Create ElevenLabs agent with PCC guide persona system prompt
  - Select appropriate voice (professional, clear, friendly)
  - Configure Claude Sonnet 4 as the LLM
  - Define server tools (webhooks) for PCC API integration
    - getShiftContext(projectId) -> /projects/:id/shift-context
    - getWorkOrder(workOrderId) -> /repos/:id/work-orders/:id
    - getRunStatus(runId) -> /runs/:id
    - getGlobalContext() -> /global/context
  - Define client tools for UI actions
    - focusNode({ nodeId })
    - highlightWorkOrder({ workOrderId })
    - toggleDetailPanel({ open })
  - Set up HMAC webhook verification for server tools
  - Configure data residency (US or appropriate region)
  - Document agent ID and configuration for React integration
non_goals:
  - React integration (separate WO)
  - Landing page UI implementation
  - Knowledge base setup (future enhancement)
stop_conditions:
  - If ElevenLabs requires enterprise for needed features, document and escalate
  - Keep initial prompt simple, iterate based on testing
priority: 2
tags:
  - implementation
  - voice
  - integration
  - elevenlabs
estimate_hours: 3
status: ready
created_at: 2026-01-22
updated_at: 2026-01-22
depends_on:
  - WO-2026-143
era: v2
---
## System Prompt (Draft)

```
You are a guide for the Project Control Center (PCC), an autonomous software development orchestration system. You help users understand what's happening across their projects.

Your personality:
- Concise and informative
- Technical but accessible
- Proactive about highlighting important items

When users ask about projects, work orders, or runs, use the available tools to fetch current data. When discussing specific items, use the focus tools to highlight them on the canvas.

Available context:
- The user is viewing an orbital canvas showing projects as orbiting nodes
- Each project contains work orders (WOs) and runs
- Runs can be in various states: running, waiting_for_input, you_review, merged, etc.

Keep responses brief (1-2 sentences when possible) since you're speaking, not writing.
```

## Tool Definitions

### Server Tools (Webhooks)

1. **getGlobalContext**
   - Description: Get overview of all projects, escalations, and portfolio status
   - Endpoint: POST /api/voice/global-context
   - Parameters: none

2. **getShiftContext**
   - Description: Get current state of a specific project including active runs and WOs
   - Endpoint: POST /api/voice/shift-context
   - Parameters: projectId (string, required)

3. **getWorkOrder**
   - Description: Get details of a specific work order
   - Endpoint: POST /api/voice/work-order
   - Parameters: workOrderId (string, required)

4. **getRunStatus**
   - Description: Get current status of a run
   - Endpoint: POST /api/voice/run-status
   - Parameters: runId (string, required)

### Client Tools

1. **focusNode**
   - Description: Focus the canvas on a specific node (project, WO, or run)
   - Parameters: nodeId (string, required)

2. **highlightWorkOrder**
   - Description: Highlight a work order in the canvas
   - Parameters: workOrderId (string, required)

3. **toggleDetailPanel**
   - Description: Open or close the detail panel
   - Parameters: open (boolean, required)

## Voice Selection Criteria

- Professional and clear
- Moderate pace (not too fast for comprehension)
- Neutral accent for broad accessibility
- Test 2-3 options and pick based on clarity

## Implementation Notes

1. Create webhook endpoints in PCC API that wrap existing endpoints with HMAC verification
2. Store agent ID in environment variable for React integration
3. Use signed URLs for production (not public agentId)
