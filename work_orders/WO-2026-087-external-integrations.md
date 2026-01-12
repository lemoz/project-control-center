---
id: WO-2026-087
title: External Integrations
goal: Connect global agent to external services (GitHub, Slack, calendar) for reactive and proactive actions.
context:
  - GitHub events (issue created, PR merged) can trigger work
  - Slack for notifications and user interaction
  - Calendar for availability awareness
acceptance_criteria:
  - GitHub webhook receiver for relevant events
  - Event → action mapping (issue → WO suggestion)
  - Slack notification channel for escalations
  - Optional: calendar integration for availability
non_goals:
  - Full GitHub/Slack bot features (minimal integration)
  - Real-time chat via Slack (async notifications only)
stop_conditions:
  - Start with GitHub only, add others based on need
priority: 4
tags:
  - autonomous
  - global-agent
  - integrations
estimate_hours: 4
status: backlog
created_at: 2026-01-12
updated_at: 2026-01-12
depends_on:
  - WO-2026-079
era: v2
---
## GitHub Integration

```typescript
// Webhook events to handle
const githubEvents = {
  'issues.opened': (event) => {
    // Suggest creating WO from issue
    suggestWOFromIssue(event.issue);
  },
  'pull_request.merged': (event) => {
    // Update WO status if linked
    completeLinkedWO(event.pull_request);
  },
  'issue_comment.created': (event) => {
    // Check for commands (@pcc-agent do X)
    handleAgentMention(event.comment);
  },
};
```

## Slack Integration

```typescript
// Notification types
const slackNotifications = {
  escalation_urgent: { channel: '#pcc-alerts', mention: true },
  escalation_normal: { channel: '#pcc-updates', mention: false },
  daily_summary: { channel: '#pcc-updates', mention: false },
  run_completed: { channel: '#pcc-activity', mention: false },
};
```

## API

```
POST /webhooks/github
  - Receive GitHub events

POST /global/notify
  - Send notification via configured channel

GET /global/integrations
  - List configured integrations

PATCH /global/integrations/:service
  - Update integration config
```
