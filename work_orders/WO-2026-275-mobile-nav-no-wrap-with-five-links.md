---
id: WO-2026-275
title: Mobile nav no-wrap with five links
goal: Fix mobile navigation layout so all core nav actions fit cleanly on small viewports without wrapping or orphaned items.
context:
  - app/components/NavBar.tsx
  - app/globals.css
acceptance_criteria:
  - At 390x844 and 375x812 viewports, mobile nav does not wrap to multiple rows.
  - All required global nav links remain reachable on mobile.
  - Bottom-nav safe-area behavior remains correct with iOS inset padding.
  - Active nav state remains visually clear for each route.
non_goals:
  - Full information architecture redesign.
  - Introducing new routes not already part of global navigation.
stop_conditions:
  - If preserving all nav items in a bottom bar harms legibility or tap targets below acceptable size, stop and propose overflow or icon-only alternatives.
priority: 1
tags:
  - ux
  - mobile
  - navigation
estimate_hours: 2
status: ready
created_at: 2026-02-06
updated_at: 2026-02-06
depends_on: []
era: v1
---
## Implementation Notes
- Validate both portrait and landscape mobile layouts.
- Preserve keyboard and screen-reader access when adjusting nav structure.

