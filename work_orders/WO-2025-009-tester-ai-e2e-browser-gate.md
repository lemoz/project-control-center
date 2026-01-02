---
id: WO-2025-009
title: "Tester gate: automated browser E2E checks"
goal: "Add an automated “Tester” gate that runs browser-based E2E checks (desktop + mobile viewports) before anything reaches You Review."
context:
  - "DECISIONS.md (Two-agent gate before human review)"
  - "Work Order flow in docs/work_orders.md"
  - "Recent UI flakiness: Next dev chunk/runtime errors"
acceptance_criteria:
  - "Add Playwright (or equivalent) E2E test runner and a minimal test suite."
  - "Tests run against a production-like build (`next build` + `next start`), not `next dev`."
  - "Include mobile viewport smoke (e.g., iPhone SE) for key flows."
  - "Gate definition documented: Builder → Reviewer → Tester → You."
  - "On failure, tester outputs a concise report plus artifacts (trace/video/screenshot)."
non_goals:
  - "Full test coverage of all future features."
  - "Automated cloud CI; local-only is fine for v0."
stop_conditions:
  - "If Playwright install/usage is blocked by environment constraints, stop and propose an alternative."
priority: 2
tags: ["testing", "e2e", "quality-gate"]
estimate_hours: 4
status: done
created_at: "2025-12-12"
updated_at: "2025-12-12"
---

## Suggested initial smoke flows
- Load Portfolio page and ensure no console errors.
- Star/unstar a repo and verify it reorders after refresh.
- Navigate into a project page and ensure Kanban columns render.
- Server offline fallback renders without crashing.
