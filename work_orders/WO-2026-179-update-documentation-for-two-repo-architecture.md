---
id: WO-2026-179
title: Update documentation for two-repo architecture
status: ready
priority: 2
tags:
  - cloud
  - foundation
  - documentation
estimate_hours: 2
depends_on:
  - WO-2026-177
era: v2
updated_at: 2026-01-27
goal: Update all documentation to reflect the two-repo architecture (OSS core + proprietary cloud).
context:
  - WO-2026-177 creates the pcc-cloud structure and MIGRATION.md
  - This WO updates ongoing documentation (README, CONTRIBUTING, etc.)
  - Need to clearly explain what each repo is for and who should use which
  - Documentation should help both self-hosted users and future cloud users
acceptance_criteria:
  - README.md updated with "Architecture" section explaining two repos
  - README.md includes comparison table (self-hosted vs cloud)
  - CONTRIBUTING.md updated to explain where different contributions go
  - pcc-cloud/README.md explains cloud-specific setup and development
  - docs/ directory created if not exists with architecture diagram (text-based is fine)
  - docs/SELF_HOSTED.md guide for running PCC locally
  - docs/CLOUD_ARCHITECTURE.md explaining how cloud deployment works
  - All existing docs reviewed for outdated single-repo assumptions
non_goals:
  - API documentation (separate effort)
  - User-facing cloud documentation (comes with onboarding WOs)
  - Video tutorials or interactive guides
stop_conditions:
  - If unclear what the final architecture will look like, document assumptions and note uncertainties
---
