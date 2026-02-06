---
id: WO-2026-280
title: Resolve chat and voice FAB overlap
goal: Prevent bottom-right floating actions from overlapping each other or covering critical content across desktop and mobile.
context:
  - app/globals.css
  - app/components/ChatWidget.tsx
  - app/live/live.module.css
  - app/live/CollapsibleVoiceWidget.tsx
acceptance_criteria:
  - Chat and Voice FABs no longer overlap at desktop and mobile breakpoints.
  - Floating actions respect bottom nav offset and safe-area insets.
  - FAB placement avoids covering key content in list/detail views.
  - Behavior remains stable when chat overlay is open/closed and voice widget is expanded/collapsed.
non_goals:
  - Complete floating-action redesign.
  - Replacing chat or voice feature architecture.
stop_conditions:
  - If positioning fixes require substantial refactor of overlay stack/z-index policy, stop and propose a dedicated floating-action layout model.
priority: 2
tags:
  - ux
  - mobile
  - layout
estimate_hours: 1.5
status: ready
created_at: 2026-02-06
updated_at: 2026-02-06
depends_on: []
era: v1
---
## Implementation Notes
- Validate with active chat badge and expanded voice widget states.
- Document z-index and offset intent in CSS comments to avoid regressions.

