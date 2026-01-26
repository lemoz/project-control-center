---
id: WO-2026-165
title: Agent Focus Auto-Pan
status: done
priority: 1
tags:
  - live-demo
  - canvas
  - agent
estimate_hours: 4
depends_on:
  - WO-2026-163
era: v2
updated_at: 2026-01-26
---
## Goal

Automatically pan the canvas to the work order the agent is currently working on, creating a "follow the agent" experience.

## Context

- Agent logs contain WO references in API calls and text
- Canvas has pan/zoom via `LiveOrbitalCanvas.tsx`
- `useAgentFocusSync` exists but doesn't parse logs for WO detection

## Acceptance Criteria

- [ ] Parse agent logs to detect WO mentions (API calls, text)
- [ ] Canvas smoothly pans to center on detected WO
- [ ] Focused WO node visually highlighted (glow, pulse)
- [ ] Opens WO detail panel (WO-2026-163) when focusing
- [ ] Debounced so canvas doesn't jump around rapidly
