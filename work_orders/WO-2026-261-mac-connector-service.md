---
id: WO-2026-261
title: Mac connector service
goal: Create a Mac-native communication layer for PCC that enables iMessage send/read, Mac Contacts access, and calendar reading via AppleScript and direct SQLite — following the meeting_connector.ts service pattern.
context:
  - server/meeting_connector.ts (service pattern to follow)
  - server/index.ts (route registration)
  - Auto_SMS_mac/src/messaging/message_sender.py (AppleScript send templates to port)
  - Auto_SMS_mac/src/messaging/message_reader.py (chat.db query patterns to port)
  - Auto_SMS_mac/src/contacts/contact.py (contact data model reference)
  - "~/Library/Messages/chat.db (macOS Messages database, read-only)"
  - "Foundation for: WO-2026-262 (conversations), WO-2026-263 (contacts import), WO-2026-265 (calling)"
acceptance_criteria:
  - "server/mac_connector.ts created following meeting_connector.ts pattern (typed state, result types, exported functions)"
  - "iMessage send: AppleScript-based, ported from message_sender.py, with proper escaping"
  - "iMessage read: Direct SQLite query of ~/Library/Messages/chat.db, ported from message_reader.py"
  - "Mac Contacts read: AppleScript to fetch contacts from Contacts.app (name, phones, emails)"
  - "Calendar read: AppleScript to fetch upcoming events from Calendar.app"
  - Rate limiting on message sends (configurable, default 10/min, 1s minimum delay)
  - "Health check endpoint returning permissions status (Full Disk Access, Contacts, Calendar)"
  - "API routes: POST /mac/messages/send, GET /mac/messages/recent, GET /mac/contacts, GET /mac/calendar/upcoming, GET /mac/status"
  - Error handling for missing permissions (Full Disk Access required for chat.db)
  - All AppleScript execution via child_process.execFile with proper error capture
non_goals:
  - Group chat management (v1 is individual messages only)
  - Message attachments/media
  - Calendar event creation (read-only for v1)
  - Conversation history aggregation (WO-2026-262)
  - Contact import/dedup (WO-2026-263)
stop_conditions:
  - If AppleScript access is blocked by macOS security, document the required permissions and provide setup instructions
  - If chat.db schema has changed in newer macOS versions, adapt queries or fall back to AppleScript read
priority: 1
tags:
  - mac
  - imessage
  - applescript
  - connector
  - foundation
estimate_hours: 5
status: ready
created_at: 2026-01-30
updated_at: 2026-01-30
depends_on: []
era: v2
---
# Mac Connector Service

## Goal
Create a Mac-native communication layer for PCC. This service wraps macOS AppleScript capabilities and direct SQLite access to the Messages database, providing a clean TypeScript API that other PCC services can use for messaging, contact lookup, and calendar integration.

## Context
- The meeting_connector.ts pattern provides the service structure: typed state, result types, exported functions
- Auto_SMS_mac has battle-tested AppleScript templates and chat.db queries to port from Python to TypeScript
- macOS requires Full Disk Access for reading ~/Library/Messages/chat.db
- Contacts.app and Calendar.app access requires user permission grants

## Architecture

### Service State
```typescript
export type MacConnectorState = {
  status: "ready" | "degraded" | "unavailable";
  permissions: {
    full_disk_access: boolean;  // Required for chat.db
    contacts: boolean;          // Required for Contacts.app
    calendar: boolean;          // Required for Calendar.app
  };
  rate_limit: {
    messages_per_minute: number;
    minimum_delay_ms: number;
    last_send_at: string | null;
    sends_this_minute: number;
  };
  last_error: string | null;
  updated_at: string;
};
```

### Result Types
```typescript
export type MacActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

export type MacMessage = {
  id: string;
  handle_id: string;  // phone or email
  text: string;
  is_from_me: boolean;
  date: string;  // ISO timestamp
  service: "iMessage" | "SMS";
  chat_id: string | null;
};

export type MacContact = {
  name: string;
  phones: Array<{ label: string; value: string }>;
  emails: Array<{ label: string; value: string }>;
};

export type MacCalendarEvent = {
  title: string;
  start: string;
  end: string;
  location: string | null;
  notes: string | null;
  calendar: string;
};
```

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | /mac/messages/send | Send iMessage (body: `{ recipient, message }`) |
| GET | /mac/messages/recent | Recent messages (query: `?handle=X&limit=50&since=ISO`) |
| GET | /mac/contacts | All contacts from Contacts.app |
| GET | /mac/calendar/upcoming | Upcoming calendar events (query: `?days=7`) |
| GET | /mac/status | Health check with permissions status |

## Implementation Details

### iMessage Send (port from message_sender.py)
```typescript
// AppleScript template for sending
const script = `
tell application "Messages"
  set targetService to 1st account whose service type = iMessage
  set targetBuddy to participant "${escapedRecipient}" of targetService
  send "${escapedMessage}" to targetBuddy
end tell
`;
// Execute via: execFile('osascript', ['-e', script])
```

Key porting notes from message_sender.py:
- Escape double quotes and backslashes in message text
- Validate phone numbers before sending (10 or 11 digits)
- Rate limit: track sends per minute window, enforce minimum delay
- Return success/failure with error details

### iMessage Read (port from message_reader.py)
```typescript
// Direct SQLite read of ~/Library/Messages/chat.db
// Key query pattern:
const query = `
  SELECT m.ROWID, m.text, m.is_from_me, m.date, m.service,
         h.id as handle_id, c.chat_identifier
  FROM message m
  LEFT JOIN handle h ON m.handle_id = h.ROWID
  LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
  LEFT JOIN chat c ON cmj.chat_id = c.ROWID
  WHERE h.id = ?
  ORDER BY m.date DESC
  LIMIT ?
`;
```

Key porting notes from message_reader.py:
- chat.db dates are in Apple epoch (seconds since 2001-01-01), convert to ISO
- Full Disk Access required — detect and report clearly if missing
- Open as read-only: `new Database(path, { readonly: true })`
- Handle both iMessage and SMS service types

### Mac Contacts Read
```applescript
tell application "Contacts"
  set contactList to {}
  repeat with p in people
    set contactName to name of p
    set phoneList to value of phones of p
    set emailList to value of emails of p
    -- build JSON output
  end repeat
end tell
```

### Calendar Read
```applescript
tell application "Calendar"
  set startDate to current date
  set endDate to startDate + (7 * days)
  set eventList to {}
  repeat with cal in calendars
    repeat with evt in (events of cal whose start date >= startDate and start date <= endDate)
      -- extract title, start, end, location, notes
    end repeat
  end repeat
end tell
```

## Files to Create/Modify
1. `server/mac_connector.ts` — New service file (main implementation)
2. `server/index.ts` — Register /mac/* routes

## Technical Notes
- Use `child_process.execFile` for AppleScript (not exec — avoids shell injection)
- Use `better-sqlite3` for chat.db reads (same library as control-center.db)
- AppleScript output parsing: use JSON-formatted output where possible, fall back to delimited text
- Rate limiting state kept in memory (resets on server restart, which is fine)
- Permission detection: try the operation, catch specific error codes
