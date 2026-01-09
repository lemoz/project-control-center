---
id: WO-2025-007
title: "iMessage notifier plugin"
goal: "Add an optional iMessage/AppleScript notifier plugin for run-finished or needs‑input events."
context:
  - "Your existing iMessage AppleScript repo"
acceptance_criteria:
  - "Notifier interface defined and pluggable."
  - "iMessage plugin can send to your own Apple ID/phone via AppleScript/Shortcuts."
  - "Enabled/disabled in settings."
non_goals:
  - "Twilio or email notifications."
priority: 6
tags: ["notifications", "imessage"]
estimate_hours: 3
status: backlog
depends_on:
  - WO-2025-004
era: v1
created_at: "2025-12-12"
updated_at: "2025-12-12"
---
