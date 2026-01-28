---
id: WO-2026-232
title: Global Canvas as Home Page
status: you_review
priority: 1
tags:
  - ui
  - canvas
  - home
  - onboarding
estimate_hours: 3
created_at: 2026-01-28
updated_at: 2026-01-28
depends_on:
  - WO-2026-230
  - WO-2026-231
era: v2
---
## Goal

Replace the current card-grid landing page with the global orbital canvas as the default route (`/`). This becomes the primary entry point to PCC.

## Context

- Current home page: `app/page.tsx` — server-rendered card grid of repos
- New home: GlobalOrbitalCanvas from WO-2026-231
- First-time users land on an empty or sparse orbital — communicates "add projects and they appear here"
- Card grid can become a secondary list view accessible from nav or as fallback

## Acceptance Criteria

- [ ] `/` route renders GlobalOrbitalCanvas as the primary view
- [ ] VoiceWidget remains present on the home page
- [ ] Empty state when no projects: center node visible, message prompting to add repos
- [ ] Clicking a project node navigates to detail panel (not away from canvas)
- [ ] Previous card-grid portfolio view still accessible (via nav link or toggle)
