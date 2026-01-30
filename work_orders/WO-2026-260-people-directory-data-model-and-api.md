---
id: WO-2026-260
title: People directory data model and API
goal: Create the foundational data model and CRUD API for tracking project stakeholders — the people you work with across projects. Supports multiple identifiers (phone, email) per person, project associations, and identifier resolution for matching incoming messages/emails to known contacts.
context:
  - server/db.ts (schema pattern for new tables)
  - server/index.ts (API route registration)
  - Auto_SMS_mac/src/contacts/contact.py (phone normalization logic to port)
  - Auto_SMS_mac/src/contacts/contact_manager.py (contact matching patterns)
  - "Foundation for: WO-2026-262 (conversations), WO-2026-263 (import), WO-2026-264 (Gmail), WO-2026-265 (calling), WO-2026-266 (context), WO-2026-267 (UI)"
acceptance_criteria:
  - "people table: id, name, nickname, company, role, notes, tags (JSON), starred (0|1), created_at, updated_at"
  - "people_identifiers table: id, person_id, type (phone|email|imessage|other), value, normalized_value, label, created_at"
  - "people_projects table: id, person_id, project_id, relationship (stakeholder|collaborator|client|vendor|other), notes, created_at"
  - Phone normalization function ported from Auto_SMS_mac contact.py (strip formatting, handle +1, 10/11 digit)
  - Email normalization (lowercase, trim)
  - "Identifier resolution: given a phone or email, return the matching person record"
  - "CRUD routes: GET /people, GET /people/:id, POST /people, PUT /people/:id, DELETE /people/:id"
  - "Identifier routes: POST /people/:id/identifiers, DELETE /people/:id/identifiers/:iid"
  - "Project association routes: POST /people/:id/projects, DELETE /people/:id/projects/:pid"
  - "Search/filter: GET /people?q=name&project=id&tag=tag"
  - "Resolution route: GET /people/resolve?phone=X or GET /people/resolve?email=X"
  - All responses follow existing API patterns (JSON, proper status codes)
non_goals:
  - Conversation history (WO-2026-262)
  - Mac Contacts import (WO-2026-263)
  - Gmail integration (WO-2026-264)
  - UI (WO-2026-267)
stop_conditions:
  - If the schema gets too complex, simplify — v1 needs name + identifiers + project links, everything else is optional
  - If phone normalization edge cases pile up, handle the 80% case and log the rest
priority: 1
tags:
  - people
  - data-model
  - api
  - foundation
estimate_hours: 4
status: you_review
created_at: 2026-01-30
updated_at: 2026-01-30
depends_on: []
era: v2
---
# People Directory Data Model and API

## Goal
Create the foundational data model and CRUD API for tracking project stakeholders. This is the base layer that all other people-related features build on — conversations, import, Gmail, calling, context integration, and UI all depend on this.

## Context
- PCC needs to know *who* you're working with across projects, not just what work orders exist
- People have multiple identifiers (phone numbers, emails) that need normalization for matching
- The Auto_SMS_mac project already has phone normalization and contact matching logic to port
- This follows the existing db.ts schema pattern and index.ts route pattern

## Schema

### people
```sql
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  nickname TEXT,
  company TEXT,
  role TEXT,
  notes TEXT,
  tags TEXT DEFAULT '[]',  -- JSON array
  starred INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### people_identifiers
```sql
CREATE TABLE IF NOT EXISTS people_identifiers (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  type TEXT NOT NULL,  -- 'phone' | 'email' | 'imessage' | 'other'
  value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  label TEXT,  -- 'mobile', 'work', 'home', etc.
  created_at TEXT NOT NULL
);
CREATE INDEX idx_people_identifiers_normalized ON people_identifiers(type, normalized_value);
CREATE INDEX idx_people_identifiers_person ON people_identifiers(person_id);
```

### people_projects
```sql
CREATE TABLE IF NOT EXISTS people_projects (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  relationship TEXT DEFAULT 'stakeholder',  -- 'stakeholder' | 'collaborator' | 'client' | 'vendor' | 'other'
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_people_projects_unique ON people_projects(person_id, project_id);
```

## Phone Normalization (port from Auto_SMS_mac)
```typescript
function normalizePhone(raw: string): string {
  // Strip all non-digit characters
  // Handle +1 prefix
  // Validate 10 or 11 digits
  // Return consistent format: +1XXXXXXXXXX
}
```

## API Routes

All under the existing Express app in server/index.ts:

| Method | Path | Description |
|--------|------|-------------|
| GET | /people | List all people (supports ?q, ?project, ?tag, ?starred filters) |
| GET | /people/:id | Get person with identifiers and project associations |
| POST | /people | Create person |
| PUT | /people/:id | Update person |
| DELETE | /people/:id | Delete person and cascade |
| POST | /people/:id/identifiers | Add identifier to person |
| DELETE | /people/:id/identifiers/:iid | Remove identifier |
| POST | /people/:id/projects | Associate person with project |
| DELETE | /people/:id/projects/:pid | Remove association |
| GET | /people/resolve | Resolve phone or email to person |

## Files to Modify
1. `server/db.ts` — Add tables, types, CRUD functions
2. `server/index.ts` — Register API routes

## Technical Notes
- Use `crypto.randomUUID()` for IDs (matches existing pattern)
- Store tags as JSON TEXT (matches projects table pattern)
- Phone normalization should handle: `(555) 123-4567`, `+15551234567`, `5551234567`, `1-555-123-4567`
- Email normalization: lowercase + trim
- Resolution endpoint is the key integration point — other services use it to match incoming messages to people
