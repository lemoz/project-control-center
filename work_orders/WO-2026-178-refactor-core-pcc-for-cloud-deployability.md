---
id: WO-2026-178
title: Refactor core PCC for cloud deployability
status: you_review
priority: 1
tags:
  - cloud
  - foundation
  - refactoring
estimate_hours: 4
depends_on:
  - WO-2026-177
era: v2
updated_at: 2026-01-27
goal: Make core PCC deployable in a cloud VM context while maintaining local-first functionality.
context:
  - PCC currently assumes local filesystem, single user, fixed paths
  - Cloud deployment requires environment-based config and headless operation
  - Changes should NOT break existing local usage
  - This enables pcc-cloud to deploy PCC instances to workspace VMs
acceptance_criteria:
  - Environment variable PCC_MODE (local | cloud) controls behavior
  - Database path configurable via PCC_DATABASE_PATH env var
  - Repos directory configurable via PCC_REPOS_PATH env var
  - New /health endpoint returns status, version, uptime, mode
  - New /heartbeat endpoint for VM monitoring (returns active runs, last activity)
  - Remove any hardcoded absolute paths (use relative or env-based)
  - Config module (server/config.ts) centralizes all environment configuration
  - Local mode works exactly as before when env vars not set
  - Document all new env vars in README or CONFIGURATION.md
non_goals:
  - Multi-tenancy within a single PCC instance (each VM = one workspace)
  - Authentication changes (cloud gateway handles auth)
  - Database migration to Postgres (stays SQLite, just configurable path)
stop_conditions:
  - If refactoring breaks existing local functionality, revert and take smaller steps
  - If unclear what should be configurable, document and ask
---
