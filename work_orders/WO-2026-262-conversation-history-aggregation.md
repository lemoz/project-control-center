---
id: WO-2026-262
title: Conversation history aggregation
goal: Aggregate conversation history across iMessage, meetings, and future channels into a unified timeline per person — enabling agents and UI to see the full communication picture with any stakeholder.
context:
  - server/db.ts (schema pattern)
  - server/mac_connector.ts (iMessage read, from WO-2026-261)
  - "People model: WO-2026-260"
  - server/index.ts (route registration)
  - meeting notes already stored in PCC (meeting_connector.ts)
  - "Hybrid sync: background for starred/active project contacts, on-demand for rest"
acceptance_criteria:
  - "conversation_events table: id, person_id, channel (imessage|email|meeting|call|note), direction (inbound|outbound|bidirectional), summary, content, external_id, metadata (JSON), occurred_at, synced_at"
  - iMessage sync pulls from chat.db via mac_connector, matched to people via identifier resolution
  - Meeting note linkage — existing meeting notes linked to people who attended
  - Dedup via external_id per channel (e.g., imessage:rowid, meeting:id)
  - "Hybrid sync strategy: background polling for starred contacts every 5 min, on-demand for others"
  - "API: GET /people/:id/conversations (paginated, filterable by channel and date range)"
  - "API: GET /people/:id/conversations/summary (recent activity count, last interaction per channel)"
  - Sync status tracking per person (last_synced_at per channel)
non_goals:
  - Real-time message streaming (polling is fine for v1)
  - Email thread sync (WO-2026-264 handles Gmail)
  - Full-text search across conversations (v1 is per-person only)
stop_conditions:
  - If chat.db sync is too slow for background polling, increase interval or limit to last 24h per poll
  - If meeting note linkage is ambiguous (can't match attendees to people), skip and log
priority: 2
tags:
  - people
  - conversations
  - sync
  - aggregation
estimate_hours: 5
status: you_review
created_at: 2026-01-30
updated_at: 2026-01-30
depends_on:
  - WO-2026-260
  - WO-2026-261
era: v2
---
# Conversation History Aggregation

## Goal
Build a unified conversation timeline per person that aggregates interactions across all communication channels. This is the data layer that makes the People directory actually useful — without conversation history, contacts are just address book entries.

## Context
- People model (WO-2026-260) provides the person records and identifier resolution
- Mac connector (WO-2026-261) provides iMessage read capability
- Meeting notes already exist in PCC from the meeting integration
- Future channels (Gmail via WO-2026-264, calls via WO-2026-265) will also write to this table
- Hybrid sync balances freshness with performance

## Schema

### conversation_events
```sql
CREATE TABLE IF NOT EXISTS conversation_events (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,  -- 'imessage' | 'email' | 'meeting' | 'call' | 'note'
  direction TEXT NOT NULL,  -- 'inbound' | 'outbound' | 'bidirectional'
  summary TEXT,  -- Short description or first line
  content TEXT,  -- Full content (message text, meeting notes, etc.)
  external_id TEXT,  -- Channel-specific unique ID for dedup
  metadata TEXT DEFAULT '{}',  -- JSON: channel-specific extra data
  occurred_at TEXT NOT NULL,  -- When the interaction happened
  synced_at TEXT NOT NULL  -- When we recorded it
);
CREATE INDEX idx_conversation_events_person ON conversation_events(person_id, occurred_at DESC);
CREATE UNIQUE INDEX idx_conversation_events_dedup ON conversation_events(channel, external_id);
CREATE INDEX idx_conversation_events_channel ON conversation_events(person_id, channel);
```

### people_sync_status
```sql
CREATE TABLE IF NOT EXISTS people_sync_status (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  last_synced_at TEXT NOT NULL,
  last_external_id TEXT,  -- Bookmark for incremental sync
  PRIMARY KEY (person_id, channel)
);
```

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | /people/:id/conversations | Paginated conversation timeline (?channel, ?since, ?until, ?limit, ?offset) |
| GET | /people/:id/conversations/summary | Activity summary (counts, last interaction per channel) |
| POST | /people/:id/conversations/sync | Trigger on-demand sync for a person |

## Sync Strategy

### Background Sync (starred/active project contacts)
- Runs every 5 minutes via `setInterval`
- Queries all people where `starred = 1` or who have active project associations
- For each: pull new iMessage messages since `last_synced_at`
- Match messages to people via phone/email identifier resolution (WO-2026-260)
- Insert new conversation_events with dedup on `(channel, external_id)`

### On-Demand Sync
- Triggered when viewing a person's conversation history
- `POST /people/:id/conversations/sync` pulls all channels for that person
- Returns sync results: `{ channels_synced, events_added, errors }`

### iMessage Sync Flow
```
1. Get person's phone/email identifiers
2. For each identifier, query mac_connector for recent messages
3. Convert MacMessage -> conversation_event
4. external_id = "imessage:{message.id}"
5. direction = message.is_from_me ? "outbound" : "inbound"
6. Insert with dedup (ON CONFLICT DO NOTHING)
7. Update people_sync_status
```

### Meeting Note Linkage
```
1. Get person's identifiers (email is primary match)
2. Query meeting notes where attendees include the person's email
3. Convert meeting note -> conversation_event
4. external_id = "meeting:{meeting_id}"
5. direction = "bidirectional"
6. summary = meeting title, content = meeting notes
```

## Files to Create/Modify
1. `server/db.ts` — Add conversation_events and people_sync_status tables, types, query functions
2. `server/conversation_sync.ts` — New file: sync logic, background polling, channel adapters
3. `server/index.ts` — Register conversation API routes

## Technical Notes
- Use `ON CONFLICT(channel, external_id) DO NOTHING` for idempotent sync
- Apple epoch conversion: `new Date((appleTimestamp / 1e9 + 978307200) * 1000).toISOString()`
- Background sync should be staggered (not all contacts at once) to avoid chat.db lock contention
- Metadata JSON examples: `{ "service": "iMessage" }`, `{ "meeting_url": "..." }`, `{ "email_thread_id": "..." }`
