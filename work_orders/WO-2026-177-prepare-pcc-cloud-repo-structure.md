---
id: WO-2026-177
title: Prepare pcc-cloud repo structure
status: you_review
priority: 1
tags:
  - cloud
  - foundation
  - repo-split
estimate_hours: 3
depends_on: []
era: v2
updated_at: 2026-01-27
goal: Prepare the complete structure and migration plan for splitting PCC into two repos (open-source core + proprietary cloud).
context:
  - PCC is currently a single repo with local-first architecture
  - Target is two repos: project-control-center (OSS) and pcc-cloud (proprietary)
  - Builder agent cannot create external GitHub repos - this WO prepares everything possible
  - Manual steps (repo creation, push) will be documented in MIGRATION.md
acceptance_criteria:
  - pcc-cloud/ subdirectory created with proposed structure
  - pcc-cloud/package.json with dependencies for cloud services (express, pg, stripe, etc.)
  - pcc-cloud/tsconfig.json configured for the cloud codebase
  - pcc-cloud/README.md explaining what pcc-cloud is and how it relates to core PCC
  - pcc-cloud/src/ with placeholder directories (auth/, billing/, vm/, api/)
  - MIGRATION.md at repo root documenting the full split process
  - MIGRATION.md includes manual steps clearly marked (create repo, push, set up secrets)
  - List of files that will STAY in project-control-center vs MOVE to pcc-cloud
  - Update main README.md to mention the two-repo architecture is coming
non_goals:
  - Actually creating the GitHub repo (manual step)
  - Pushing to external repo (manual step)
  - Setting up GitHub secrets or CI (separate WO)
  - Moving the landing page code yet (depends on landing page WOs completing first)
stop_conditions:
  - If you attempt to create or push to external repo, STOP and document in MIGRATION.md
  - If unclear which code belongs where, document the ambiguity and recommend
---
