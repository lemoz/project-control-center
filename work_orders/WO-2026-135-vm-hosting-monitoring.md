---
id: WO-2026-135
title: VM Hosting Health Monitoring & Alerts
goal: Monitor PCC hosting VM health and alert on issues
context:
  - server/vm_manager.ts (existing VM health checks)
  - /observability/vm-health endpoint
  - WO-2026-132 deploys PCC to VM
acceptance_criteria:
  - Health check endpoint exposed on hosting VM
  - External uptime monitor configured (e.g., UptimeRobot, GCP monitoring)
  - Alerts on VM unreachable, high CPU/memory, disk full
  - Basic runbook for common failure scenarios
non_goals:
  - Complex APM or distributed tracing
  - Multi-region failover
stop_conditions:
  - If monitoring adds significant cost, document and defer
priority: 3
tags:
  - infrastructure
  - monitoring
  - vm
  - reliability
estimate_hours: 2
status: you_review
created_at: 2026-01-22
updated_at: 2026-01-27
depends_on:
  - WO-2026-132
era: v2
---
## Notes
- Can reuse existing /observability/vm-health patterns
- Consider free tier of UptimeRobot for basic HTTP monitoring
- GCP native monitoring is already available for the VM
