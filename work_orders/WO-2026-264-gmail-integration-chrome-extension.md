---
id: WO-2026-264
title: Gmail integration via Chrome extension
goal: Enable reading and sending Gmail messages for project contacts via Chrome browser automation, with email threads linked to conversation history and an approval flow for new contacts.
context:
  - server/db.ts (people tables from WO-2026-260)
  - server/conversation_sync.ts (conversation_events from WO-2026-262, if available)
  - "Chrome extension: Claude-in-Chrome MCP tools for browser automation"
  - "People identifier resolution for matching email addresses"
  - "Approval flow: auto-send to known project contacts, ask for unknown"
acceptance_criteria:
  - "Read email threads for a contact by searching Gmail for their email address"
  - "Compose and send emails via Chrome Gmail automation"
  - Link email threads to conversation_events table (channel = 'email')
  - "Auto-send approval: messages to known project contacts send automatically"
  - "New contact approval: agent proposes send, user confirms before execution"
  - "API: POST /gmail/send (body: { to, subject, body, person_id? })"
  - "API: GET /gmail/threads (query: ?email=X&limit=N)"
  - "API: POST /gmail/sync (body: { person_id }) — sync email history for a person"
  - Email thread dedup via external_id (gmail:thread_id)
non_goals:
  - Gmail API OAuth integration (v1 uses Chrome automation, not API)
  - Email attachment handling
  - Multiple Gmail account support
  - Email templates or auto-responses
stop_conditions:
  - If Chrome automation is unreliable for Gmail, document limitations and fall back to compose-only (open draft, user clicks send)
  - If Gmail UI changes break automation, provide manual fallback instructions
priority: 2
tags:
  - gmail
  - email
  - chrome
  - communication
estimate_hours: 4
status: ready
created_at: 2026-01-30
updated_at: 2026-01-30
depends_on:
  - WO-2026-260
era: v2
---
# Gmail Integration via Chrome Extension

## Goal
Add Gmail read and send capabilities to PCC using the Chrome extension's browser automation tools. This lets the agent read email context about a person and send emails on your behalf, with appropriate approval gates.

## Context
- PCC already has Chrome extension integration (Claude-in-Chrome MCP)
- People model (WO-2026-260) provides identifier resolution for email matching
- Conversation events (WO-2026-262) provides the table for email thread storage (but Gmail can work independently)
- Gmail is accessed via browser automation, not OAuth API (simpler, no token management)

## Architecture

### Email Read Flow
```
1. Get person's email identifiers from people_identifiers
2. Navigate Chrome to Gmail search: "from:{email} OR to:{email}"
3. Extract thread summaries (subject, date, snippet) from search results
4. For detailed view: open thread and extract messages
5. Store in conversation_events with channel='email', external_id='gmail:{thread_id}'
```

### Email Send Flow
```
1. Receive send request with recipient, subject, body
2. Check approval:
   a. Resolve recipient email to person via identifier resolution
   b. If person exists AND has active project association → auto-send
   c. If person unknown or no project association → return { needs_approval: true, draft }
3. If approved:
   a. Navigate Chrome to Gmail compose
   b. Fill in To, Subject, Body
   c. Click Send
   d. Record in conversation_events as outbound email
```

### Approval Flow
```typescript
type EmailSendRequest = {
  to: string;
  subject: string;
  body: string;
  person_id?: string;  // Optional, resolved from 'to' if not provided
};

type EmailSendResult =
  | { ok: true; sent: true; event_id: string }
  | { ok: true; sent: false; needs_approval: true; draft_id: string; reason: string }
  | { ok: false; error: string };
```

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | /gmail/send | Send email (with approval flow) |
| POST | /gmail/send/:draft_id/approve | Approve and send a pending draft |
| GET | /gmail/threads | Search email threads for a contact |
| POST | /gmail/sync | Sync email history for a person to conversation_events |

## Chrome Automation Details

### Reading Emails
- Use `mcp__claude-in-chrome__navigate` to go to Gmail search URL
- Use `mcp__claude-in-chrome__get_page_text` or `read_page` to extract thread list
- Parse thread subjects, dates, and snippets from page content

### Sending Emails
- Navigate to `https://mail.google.com/mail/?view=cm&to={email}&su={subject}`
- Use `form_input` to fill the body
- Use `find` + `left_click` to click Send button
- Verify send confirmation appears

## Files to Create/Modify
1. `server/gmail_connector.ts` — New file: Gmail automation logic, approval flow
2. `server/index.ts` — Register /gmail/* routes

## Technical Notes
- Gmail compose URL supports pre-filling: `?view=cm&to=X&su=Y&body=Z`
- Thread IDs can be extracted from Gmail URLs (the hex string in the URL)
- Chrome tab management: use a dedicated tab for Gmail operations, don't interfere with user's tabs
- Rate limiting: respect Gmail's sending limits (500/day for consumer, 2000/day for Workspace)
- Approval state stored in memory (pending drafts map) — cleared on restart is fine
