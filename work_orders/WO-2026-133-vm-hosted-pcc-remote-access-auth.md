---
id: WO-2026-133
title: VM-Hosted PCC Remote Access + Auth
goal: Expose VM-hosted PCC securely over HTTPS with simple authentication.
context:
  - docs/pcc-vm-service-research-wo-2026-128.md
  - WO-2026-132 (baseline VM deployment)
  - Current local access uses ngrok basic auth
acceptance_criteria:
  - HTTPS terminates at the VM (Caddy/Nginx or tunnel)
  - UI is accessible via a stable domain
  - Auth is enforced (basic auth or Cloudflare Access)
  - Firewall rules restrict unnecessary ports
  - SSH access for debugging is documented
non_goals:
  - Multi-user OAuth integration
  - Full SSO or IAM integration
stop_conditions:
  - If HTTPS or auth cannot be made reliable, document blockers and pause
priority: 2
tags:
  - infrastructure
  - security
  - access
estimate_hours: 3
status: backlog
created_at: 2026-01-22
updated_at: 2026-01-22
depends_on:
  - WO-2026-132
era: v2
---

## Notes
- Start with the simplest secure option; document how to upgrade later.
