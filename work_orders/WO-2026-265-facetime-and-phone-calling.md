---
id: WO-2026-265
title: FaceTime and phone calling
goal: Enable PCC agents to initiate FaceTime audio/video calls and phone calls on your behalf, with an approval flow where the agent proposes calls and you confirm before execution.
context:
  - server/mac_connector.ts (AppleScript execution, from WO-2026-261)
  - server/db.ts (people tables from WO-2026-260, conversation_events from WO-2026-262)
  - FaceTime.app supports AppleScript for initiating calls
  - "tel: URL scheme for phone calls via FaceTime PSTN"
  - "Agent-initiated with approval: agent proposes, user confirms"
acceptance_criteria:
  - Initiate FaceTime audio call via AppleScript
  - Initiate FaceTime video call via AppleScript
  - "Initiate phone call via tel: URL scheme (opens FaceTime for PSTN)"
  - "Agent approval flow: POST /mac/call returns { needs_approval, call_details } for user to confirm"
  - POST /mac/call/confirm/:id executes the approved call
  - Call log entries written to conversation_events (channel = 'call')
  - "API: POST /mac/call (body: { person_id, type: audio|video|phone })"
  - "API: POST /mac/call/confirm/:id"
  - "API: GET /mac/call/pending — list pending call proposals"
  - Resolve person_id to best phone number or FaceTime identifier
non_goals:
  - Call recording or transcription
  - Conference calls or multi-party
  - Automated call scheduling (agent suggests, user initiates)
  - Call duration tracking (just log that call was placed)
stop_conditions:
  - If FaceTime AppleScript is too restricted in current macOS, fall back to open URL scheme only
  - If PSTN calling via FaceTime is unavailable, document and skip phone calls
priority: 2
tags:
  - calling
  - facetime
  - mac
  - communication
estimate_hours: 3
status: you_review
created_at: 2026-01-30
updated_at: 2026-01-30
depends_on:
  - WO-2026-260
  - WO-2026-261
era: v2
---
# FaceTime and Phone Calling

## Goal
Let PCC agents initiate calls to project stakeholders. The key design decision: calls are always **agent-proposed, user-confirmed**. The agent can say "I think we should call John about the deadline" and prepare the call, but you always click confirm before it dials.

## Context
- Mac connector (WO-2026-261) provides AppleScript execution infrastructure
- People model (WO-2026-260) provides person records with phone identifiers
- FaceTime supports AppleScript for call initiation
- The `tel:` URL scheme triggers FaceTime for PSTN calls on macOS
- All calls get logged as conversation_events for history tracking

## Architecture

### Call Proposal Flow
```
1. Agent decides a call would be useful (e.g., during shift planning)
2. POST /mac/call { person_id: "abc", type: "audio" }
3. Server resolves person → best identifier for call type:
   - audio/video: prefer email (FaceTime ID), fall back to phone
   - phone: use phone number
4. Server creates pending call proposal:
   { id, person_name, identifier, type, reason, created_at }
5. Returns { needs_approval: true, proposal_id, details }
6. Agent presents to user: "I'd like to call John Smith (FaceTime audio) about X"
7. User confirms → POST /mac/call/confirm/:id
8. Server executes call via AppleScript/URL scheme
9. Log conversation_event (channel='call', direction='outbound')
```

### Call Execution

#### FaceTime Audio/Video
```applescript
tell application "FaceTime"
  activate
end tell
-- Then open facetime:// URL
do shell script "open facetime://{identifier}?audio=true"
-- For video: "open facetime://{identifier}"
```

#### Phone Call (PSTN)
```applescript
do shell script "open tel://{phoneNumber}"
```

### Call Proposal Type
```typescript
type CallProposal = {
  id: string;
  person_id: string;
  person_name: string;
  identifier: string;  // Phone or email to call
  type: "audio" | "video" | "phone";
  reason: string | null;  // Why the agent wants to call
  status: "pending" | "confirmed" | "cancelled" | "expired";
  created_at: string;
  expires_at: string;  // Proposals expire after 30 minutes
};

type CallResult =
  | { ok: true; needs_approval: true; proposal: CallProposal }
  | { ok: true; needs_approval: false; initiated: true; event_id: string }
  | { ok: false; error: string };
```

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | /mac/call | Propose a call (returns proposal for approval) |
| POST | /mac/call/confirm/:id | Confirm and execute a pending call |
| POST | /mac/call/cancel/:id | Cancel a pending call proposal |
| GET | /mac/call/pending | List all pending call proposals |

## Identifier Resolution for Calls

| Call Type | Preferred Identifier | Fallback |
|-----------|---------------------|----------|
| audio | Email (Apple ID/FaceTime) | Phone number |
| video | Email (Apple ID/FaceTime) | Phone number |
| phone | Phone number | None (error if no phone) |

## Files to Create/Modify
1. `server/calling.ts` — New file: call proposal management, execution, logging
2. `server/index.ts` — Register /mac/call/* routes

## Technical Notes
- Pending proposals stored in memory (Map<id, CallProposal>) — fine for v1
- Proposals auto-expire after 30 minutes (cleanup on access)
- FaceTime URL schemes: `facetime://` (video), `facetime-audio://` (audio), `tel://` (phone)
- Use `child_process.execFile('open', [url])` for URL scheme calls
- Conversation event metadata: `{ "call_type": "audio", "duration": null }` (duration unknown)
- Log the call as soon as it's initiated — we can't track if the other party answered
