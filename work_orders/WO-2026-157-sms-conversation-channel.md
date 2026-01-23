---
id: WO-2026-157
title: SMS Conversation Channel
goal: Enable bidirectional conversations between users and the global agent via SMS, where conversations become context for global agent shifts.
context:
  - WO-2026-144 Unified Project Communication Model (done)
  - WO-2026-148 Global Agent Sessions (done)
  - WO-2026-079 Global Agent Shift Loop (done)
  - WO-2026-156 Slack Conversation Channel (parallel effort)
  - Conversations are ephemeral bubbles that capture intent
  - When conversation ends, context is passed to global agent shift
  - Global agent can also initiate conversations (escalations, questions, updates)
  - SMS is ideal for urgent escalations and mobile-first interactions
acceptance_criteria:
  - Twilio (or similar) integration for sending/receiving SMS
  - Dedicated phone number for the global agent
  - Incoming SMS creates or continues a conversation
  - Conversation state tracked (active, ended, processed)
  - "End conversation" detection (timeout, natural conclusion, "done")
  - When conversation ends, context packaged and passed to global agent
  - Global agent can send SMS to user (initiate conversation)
  - Phone number → user mapping for identification
  - Rate limiting to prevent abuse/cost overrun
  - Conversation history stored for context
non_goals:
  - MMS/media messages (text only)
  - Group SMS
  - Voice calls (separate channel, future WO)
  - SMS commands for direct system control (everything routes through global agent)
stop_conditions:
  - Keep costs in mind - SMS has per-message pricing
  - Start with single phone number, expand later if needed
priority: 3
tags:
  - communication
  - global-agent
  - sms
  - twilio
  - integration
estimate_hours: 4
status: backlog
created_at: 2026-01-23
updated_at: 2026-01-23
track_id: 138764e0-ff8d-46c3-bddb-292a806bce03
depends_on:
  - WO-2026-144
era: v2
---

## Architecture

```
┌─────────────────┐         ┌─────────────────┐
│   User Phone    │◄───────►│     Twilio      │
└─────────────────┘         └────────┬────────┘
                                     │
                                     ▼
                            ┌─────────────────┐
                            │  PCC SMS Handler│
                            │   (webhook)     │
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
1. User texts the PCC phone number
2. Twilio webhook hits PCC server
3. Look up user by phone number (or prompt for identification)
4. If no active conversation, create one
5. Store message, respond conversationally
6. Detect conversation end:
   - User says "done", "thanks", etc.
   - Timeout (e.g., 30 min no activity - longer than Slack due to async nature of SMS)
7. Package conversation context
8. Trigger global agent shift

### Agent → User
1. Global agent needs user input (urgent escalation)
2. Creates outbound conversation request with priority
3. PCC sends SMS to user's registered phone
4. User response continues the conversation
5. Same flow as above

## Data Model

```typescript
interface SMSConversation {
  id: string;
  phone_number: string;  // user's phone
  user_id?: string;      // linked PCC user if known
  status: 'active' | 'ended' | 'processed';
  project_id?: string;
  messages: ConversationMessage[];
  started_at: string;
  ended_at?: string;
  processed_at?: string;
  global_shift_id?: string;
}

interface SMSConfig {
  twilio_account_sid: string;
  twilio_auth_token: string;
  twilio_phone_number: string;
  monthly_budget_cents: number;
  rate_limit_per_hour: number;
}
```

## Twilio Setup
1. Create Twilio account
2. Buy phone number with SMS capability
3. Configure webhook URL for incoming messages
4. Store credentials in PCC secrets

## Cost Considerations
- Twilio SMS: ~$0.0079/message (US)
- Set monthly budget cap
- Alert when approaching limit
- Prioritize outbound for urgent escalations only
