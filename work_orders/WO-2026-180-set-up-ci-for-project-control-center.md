---
id: WO-2026-180
title: Set up CI for project-control-center
status: done
priority: 2
tags:
  - foundation
  - ci-cd
  - devops
estimate_hours: 2
depends_on:
  - WO-2026-177
  - WO-2026-178
era: v2
updated_at: 2026-01-28
goal: Create GitHub Actions CI workflow for project-control-center (the OSS core repo).
context:
  - project-control-center needs CI for tests and builds on PRs
  - pcc-cloud CI/CD is handled by a separate WO in that repo
  - Builder can create workflow files but cannot set up GitHub secrets
acceptance_criteria:
  - .github/workflows/ci.yml for project-control-center
  - Workflow runs lint, typecheck, test, build
  - Workflow uses caching for node_modules
  - CI runs on pull requests and pushes to main
  - Workflow is well-commented explaining each step
  - CI_SETUP.md documents any required GitHub secrets (if any)
non_goals:
  - pcc-cloud CI/CD (separate WO in that repo)
  - Actually setting up GitHub secrets (manual step)
  - Preview deployments
  - Deployment automation (this repo is OSS, users deploy themselves)
stop_conditions:
  - If unclear about test commands, check package.json scripts first
---
