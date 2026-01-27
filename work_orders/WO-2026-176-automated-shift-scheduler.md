---
id: WO-2026-176
title: Automated shift scheduler
status: done
priority: 1
tags:
  - shift-agent
  - scheduler
  - settings
  - autonomous
estimate_hours: 4
depends_on:
  - WO-2026-063
  - WO-2026-074
era: v2
updated_at: 2026-01-27
goal: Automatically start shifts at regular intervals so projects make progress without manual triggering.
context:
  - Shift lifecycle APIs exist (WO-2026-063) - POST /projects/:id/shifts
  - Shift agent works locally (WO-2026-074) and on VM (WO-2026-089)
  - Settings panel at app/settings/ with existing forms pattern
  - Settings storage in server/settings.ts and server/db.ts
  - Currently shifts must be started manually
acceptance_criteria:
  - New "shift_scheduler_settings" table (enabled, interval_minutes, cooldown_minutes, max_shifts_per_day, quiet_hours_start, quiet_hours_end)
  - Scheduler loop in server (setInterval) checks every 60s when enabled
  - For each project with opt-in, starts shift if: interval elapsed since last shift, not in cooldown, not in quiet hours, under daily limit, has ready WOs
  - New ShiftSchedulerSettingsForm in app/settings/ with: master toggle, interval (default 120 min), cooldown (default 30 min), max per day (default 6), quiet hours (default 2am-6am)
  - Per-project opt-in stored in projects table (auto_shift_enabled column, default false)
  - Project settings UI shows auto-shift toggle
  - Scheduler status visible in settings (running/paused, next check, recent activity)
  - Spawns shift agent via existing mechanism (CLI or API)
non_goals:
  - Event-driven triggers (WO ready, run complete)
  - Cron expressions (simple interval only)
  - Cross-project prioritization (each project independent)
  - VM vs local selection (uses project's existing isolation_mode)
stop_conditions:
  - If spawning shift agent is unreliable, add retry logic or stop and report
  - If interval check causes performance issues, increase check interval
---
