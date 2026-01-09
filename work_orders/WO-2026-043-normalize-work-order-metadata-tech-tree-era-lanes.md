---
id: WO-2026-043
title: Normalize work order metadata + tech tree era lanes
goal: Ensure all work orders have consistent metadata (era, depends_on) and add validation to prevent drift, with tech tree displaying era lanes correctly.
context:
  - server/work_orders.ts (WO parsing and validation)
  - app/projects/[id]/TechTreeView.tsx (era lane display)
  - docs/work_orders.md (WO contract spec)
acceptance_criteria:
  - All WOs have a valid `era` field from allowed set (v0, v1, v2).
  - All WOs have `depends_on` array (can be empty for root WOs).
  - Server-side validation warns on missing/invalid era or depends_on during WO parsing.
  - Tech tree groups WOs into horizontal era lanes (v0 left, v1 middle, v2 right).
  - Era legend or labels displayed in tech tree UI.
  - API endpoint `/repos/:id/work-orders` includes era validation warnings in response.
non_goals:
  - Auto-fixing invalid metadata (warn only, human fixes).
  - Enforcing dependency correctness (just presence of field).
  - Blocking WO creation on validation failure.
stop_conditions:
  - If era validation breaks existing WO parsing, stop and make it non-blocking.
  - If tech tree layout becomes cluttered with 3 lanes, stop and propose alternatives.
priority: 3
tags:
  - work-orders
  - tech-tree
  - meta
  - validation
estimate_hours: 3
status: backlog
created_at: 2026-01-08
updated_at: 2026-01-09
depends_on:
  - WO-2025-003
  - WO-2026-021
era: v1
---

## Notes

Manual gardening done 2026-01-09:
- Added missing `depends_on` to 7 WOs
- Consolidated eras: foundation→v0, chat-v2→v1, autonomous→v2
- Added `era` field to 4 WOs that were missing it
- Current distribution: v0 (5), v1 (21), v2 (12)

This WO adds server-side validation and tech tree improvements to prevent future drift.

