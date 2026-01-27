---
id: WO-2026-180
title: Set up CI/CD for both repos
status: backlog
priority: 2
tags:
  - cloud
  - foundation
  - ci-cd
  - devops
estimate_hours: 3
depends_on:
  - WO-2026-177
  - WO-2026-178
era: v2
updated_at: 2026-01-26
goal: Create GitHub Actions workflows for testing, building, and deploying both repos.
context:
  - project-control-center needs CI for tests and builds on PRs
  - pcc-cloud needs CI plus CD for deployment to Fly.io
  - Builder can create workflow files but cannot set up GitHub secrets
  - Manual steps for secrets setup will be documented
acceptance_criteria:
  - .github/workflows/ci.yml for project-control-center (lint, typecheck, test, build)
  - .github/workflows/ci.yml for pcc-cloud (lint, typecheck, test, build)
  - .github/workflows/deploy.yml for pcc-cloud (deploy to Fly.io on main push)
  - Workflows use caching for node_modules
  - CI runs on pull requests and pushes to main
  - CD only runs on pushes to main (not PRs)
  - DEPLOYMENT.md documents required GitHub secrets (FLY_API_TOKEN, etc.)
  - DEPLOYMENT.md documents manual setup steps for Fly.io
  - Workflows are well-commented explaining each step
non_goals:
  - Actually setting up GitHub secrets (manual step)
  - Creating Fly.io account or apps (manual step)
  - Preview deployments for PRs (future enhancement)
  - Multi-environment (staging/prod) - start with single environment
stop_conditions:
  - If Fly.io deployment config requires information we don't have, write placeholder and document
  - If unclear about test commands, check package.json scripts first
---
