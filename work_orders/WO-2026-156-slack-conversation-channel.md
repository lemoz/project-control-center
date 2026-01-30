---
id: WO-2026-156
title: Slack Conversation Channel
goal: Enable bidirectional conversations between users and the global agent via Slack, where conversations become context for global agent shifts.
context:
  - WO-2026-144 Unified Project Communication Model (done)
  - WO-2026-148 Global Agent Sessions (done)
  - WO-2026-079 Global Agent Shift Loop (done)
  - Conversations are ephemeral bubbles that capture intent
  - When conversation ends, context is passed to global agent shift
  - Global agent can also initiate conversations (escalations, questions, updates)
  - No direct actions - all execution goes through global agent shifts
acceptance_criteria:
  - Slack app/bot setup with OAuth for workspace installation
  - Incoming messages create or continue a conversation thread
  - Conversation state tracked (active, ended, processed)
  - '"End conversation" detection (explicit command, timeout, or natural conclusion)'
  - When conversation ends, context packaged and passed to global agent
  - Global agent can send messages to user via Slack (initiate conversation)
  - Support for DMs and channel mentions
  - Conversation history stored for context
  - Link conversations to projects when project context is detected
non_goals:
  - Real-time streaming responses (async is fine)
  - Slack-specific commands for direct system control (everything routes through global agent)
  - File uploads/attachments (text conversations first)
stop_conditions:
  - Keep integration simple - don't build a full Slack app framework
  - If OAuth complexity is high, start with webhook-based approach
priority: 3
tags:
  - communication
  - global-agent
  - slack
  - integration
estimate_hours: 6
status: you_review
created_at: 2026-01-23
updated_at: 2026-01-30
track_id: 138764e0-ff8d-46c3-bddb-292a806bce03
depends_on:
  - WO-2026-144
era: v2
---
## Architecture

```
┌─────────────────┐         ┌─────────────────┐
│   Slack User    │◄───────►│   Slack API     │
└─────────────────┘         └────────┬────────┘
                                     │
                                     ▼
                            ┌─────────────────┐
                            │  PCC Slack Bot  │
                            │  (webhook/app)  │
                            └────────┬────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                                 ▼
           ┌───────────────┐                ┌───────────────┐
           │ Conversation  │                │ Global Agent  │
           │    Store      │                │ Shift Trigger │
           └───────────────┘                └───────────────┘
```

## Conversation Flow

### User → Agent
1. User sends message in Slack (DM or @mention)
2. PCC bot receives via webhook/events API
3. If no active conversation, create one
4. Store message in conversation
5. Respond conversationally (acknowledge, ask clarifying questions)
6. Detect conversation end:
   - User says "done", "thanks", "that's all"
   - Timeout (e.g., 10 min no activity)
   - Explicit "/end" command
7. Package conversation context
8. Trigger global agent shift with conversation as input

### Agent → User
1. Global agent needs user input (escalation, question, decision)
2. Creates outbound conversation request
3. PCC sends Slack message to user
4. User response continues the conversation
5. Same flow as above when conversation ends

## Data Model

```typescript
interface SlackConversation {
  id: string;
  slack_channel_id: string;
  slack_user_id: string;
  slack_thread_ts?: string;
  status: 'active' | 'ended' | 'processed';
  project_id?: string;  // if project context detected
  messages: ConversationMessage[];
  started_at: string;
  ended_at?: string;
  processed_at?: string;
  global_shift_id?: string;  // if triggered a shift
}
```

## Slack App Scopes Needed
- `chat:write` - send messages
- `im:history` - read DM history
- `im:write` - send DMs
- `app_mentions:read` - respond to @mentions
- `channels:history` - read channel messages (if mentioned)
