---
id: WO-2026-161
title: Live Agent Activity Display
goal: Show real-time agent activity on the /live page so users can see what the agent is currently doing during a shift.
context:
  - Live page shows orbital canvas and narration panel
  - When a shift is active, users should see what the agent is working on
  - UI updates via polling (useAgentFocusSync polls every 5 seconds)
  - Agent logs are at .system/shifts/{shiftId}/agent.log
  - Run status available via shift-context endpoint
acceptance_criteria:
  - Show current agent action (building, testing, reviewing, etc.)
  - Display which WO the agent is working on
  - Show recent activity log or streaming output
  - Visual indicator on the canvas for the active WO node
  - Activity panel updates in near real-time
non_goals:
  - Full log viewer with search/filter
  - Historical shift replay
stop_conditions:
  - Keep it simple - don't over-engineer the log display
  - If SSE is complex, polling every 2-3s is acceptable
priority: 2
tags:
  - live-demo
  - ui
  - agent
estimate_hours: 3
status: ready
created_at: 2026-01-26
depends_on:
  - WO-2026-155
era: v2
---
## UI Options

1. **Activity panel** - Dedicated section showing agent log stream
2. **Canvas overlay** - Floating card near active WO showing current action
3. **Enhanced narration** - Chief of staff narrates agent actions
4. **Combination** - All of the above

## Implementation Notes

- Could use SSE endpoint for streaming updates
- Or enhance polling to include recent log lines
- Consider tail -f style log display with auto-scroll
