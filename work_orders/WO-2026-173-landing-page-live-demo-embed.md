---
id: WO-2026-173
title: Landing page live demo embed
status: you_review
priority: 2
tags:
  - landing-page
  - canvas
  - visualization
estimate_hours: 2
depends_on:
  - WO-2026-171
era: v2
updated_at: 2026-01-27
goal: Embed the existing LiveOrbitalCanvas and AgentActivityPanel components on the landing page hero section so visitors see real live activity.
context:
  - Landing page hero at app/(public)/landing/page.tsx (WO-2026-171)
  - Existing LiveOrbitalCanvas at app/live/LiveOrbitalCanvas.tsx
  - Existing AgentActivityPanel at app/live/AgentActivityPanel.tsx
  - LiveLanding.tsx shows how to wire up these components with data hooks
  - useProjectsVisualization, useAgentFocusSync provide the data
acceptance_criteria:
  - Landing page hero embeds actual LiveOrbitalCanvas component (not a rebuild)
  - Landing page shows actual AgentActivityPanel with real activity
  - Reuses existing hooks (useProjectsVisualization, useAgentFocusSync)
  - Component container is appropriately sized for hero section
  - Live indicator badge visible
  - CTA link to /live for full-screen experience
  - Graceful handling if no active data (empty state)
non_goals:
  - Building new/simulated visualization components
  - Duplicating canvas logic
  - Adding features not already in LiveOrbitalCanvas
stop_conditions:
  - If components can't be cleanly imported due to dependencies, stop and clarify refactoring needs
---
