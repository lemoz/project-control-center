---
id: WO-2026-187
title: PCC deployment to VMs
status: ready
priority: 1
tags:
  - cloud
  - vm
  - deployment
  - docker
estimate_hours: 4
depends_on:
  - WO-2026-178
era: v2
updated_at: 2026-01-27
goal: Create Docker image and deployment configuration for running PCC on workspace VMs.
context:
  - PCC core is refactored for cloud mode (WO-2026-178)
  - pcc-cloud provisions VMs via Fly.io (separate repo)
  - Need Docker image that runs PCC in cloud mode
  - VM needs to communicate back to pcc-cloud for status updates
  - This Dockerfile lives in project-control-center (open source)
acceptance_criteria:
  - Dockerfile in project-control-center root for cloud deployment
  - Image includes Node.js, PCC server, and dependencies
  - Configurable via environment variables (PCC_MODE=cloud, workspace ID, callback URL)
  - Health check endpoint exposed for Fly.io monitoring
  - Startup script initializes SQLite database
  - Image published to container registry (GitHub Container Registry)
  - Documentation for building and publishing the image
  - Image size optimized (multi-stage build)
  - .dockerignore to exclude unnecessary files
non_goals:
  - Auto-updating VMs when new PCC version releases (future)
  - Custom VM configurations per workspace
  - GPU or special hardware support
  - Fly.io specific config (that's in pcc-cloud)
stop_conditions:
  - If Docker build is complex, start with simple working image and optimize later
  - If registry access is unclear, document options and ask
---
