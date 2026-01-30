---
id: WO-2026-263
title: Mac Contacts import and sync
goal: Import contacts from macOS Contacts.app and the legacy Auto_SMS_mac contacts database into the PCC people directory, with deduplication and merge logic.
context:
  - server/mac_connector.ts (Contacts.app read via AppleScript, from WO-2026-261)
  - server/db.ts (people tables from WO-2026-260)
  - "~/.imessage_crm/contacts.db (legacy Auto_SMS_mac contact data)"
  - Auto_SMS_mac/src/contacts/contact.py (contact data model)
  - Auto_SMS_mac/src/database/contacts_db.py (legacy DB schema)
acceptance_criteria:
  - "POST /mac/contacts/import — bulk import from Contacts.app via mac_connector"
  - "POST /mac/contacts/import-legacy — import from ~/.imessage_crm/contacts.db"
  - Dedup by normalized phone and email (uses identifier resolution from WO-2026-260)
  - "Merge strategy: PCC data wins for existing fields, Mac/legacy fills gaps"
  - "Import report returned: { imported: number, updated: number, skipped: number, errors: Array<{ name, reason }> }"
  - Dry-run mode (preview what would be imported without writing)
  - Imported contacts get source tag (mac-contacts or legacy-imessage-crm)
non_goals:
  - Two-way sync back to Contacts.app (PCC is the source of truth)
  - Continuous background sync of Contacts.app changes
  - Contact photo import
stop_conditions:
  - If Contacts.app AppleScript is too slow for large address books (1000+), implement pagination or batch
  - If legacy contacts.db schema is too different from expected, skip fields that don't map
priority: 2
tags:
  - people
  - import
  - mac
  - contacts
estimate_hours: 3
status: ready
created_at: 2026-01-30
updated_at: 2026-01-30
depends_on:
  - WO-2026-260
  - WO-2026-261
era: v2
---
# Mac Contacts Import and Sync

## Goal
Provide one-click import of contacts from macOS Contacts.app and the legacy Auto_SMS_mac database into the PCC people directory. Users shouldn't have to re-enter contact info that already exists elsewhere.

## Context
- Mac connector (WO-2026-261) provides the `GET /mac/contacts` endpoint that reads from Contacts.app
- People model (WO-2026-260) provides the people tables and identifier resolution
- Legacy contact data lives in `~/.imessage_crm/contacts.db` from the Auto_SMS_mac project
- Import is user-triggered (not automatic), but should be fast and safe to re-run

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | /mac/contacts/import | Import from Contacts.app (body: `{ dry_run?: boolean }`) |
| POST | /mac/contacts/import-legacy | Import from legacy DB (body: `{ dry_run?: boolean }`) |

## Import Flow

### From Contacts.app
```
1. Call mac_connector.getContacts() to get all MacContact records
2. For each contact:
   a. Normalize all phone numbers and emails
   b. Check identifier resolution: does any phone/email match an existing person?
   c. If match found:
      - Merge: fill empty fields (nickname, company, role) from Mac data
      - Add any new identifiers not already present
      - Result: "updated"
   d. If no match:
      - Create new person with all available data
      - Add all identifiers
      - Tag with "mac-contacts"
      - Result: "imported"
   e. If error (e.g., no name):
      - Skip and record error
      - Result: "skipped" with reason
3. Return import report
```

### From Legacy Database (~/.imessage_crm/contacts.db)
```
1. Open ~/.imessage_crm/contacts.db with better-sqlite3 (read-only)
2. Query contacts with their phone numbers, emails, and metadata
3. Same merge flow as Contacts.app import
4. Tag with "legacy-imessage-crm"
5. Port any message stats or metadata as notes
6. Return import report
```

## Merge Strategy

**PCC data wins** — existing PCC fields are never overwritten. Mac/legacy data only fills gaps:

| Field | Behavior |
|-------|----------|
| name | Keep PCC if set, use Mac if PCC empty |
| nickname | Fill if empty |
| company | Fill if empty |
| role | Fill if empty |
| notes | Append Mac notes with "[Imported from Mac Contacts]" prefix |
| identifiers | Add new ones, skip duplicates (by normalized value) |
| tags | Merge (add source tag, keep existing) |

## Import Report Format
```typescript
type ImportReport = {
  source: "mac-contacts" | "legacy-imessage-crm";
  dry_run: boolean;
  imported: number;    // New people created
  updated: number;     // Existing people updated with new data
  skipped: number;     // Skipped (no name, invalid data, etc.)
  errors: Array<{
    name: string | null;
    reason: string;
  }>;
  total_processed: number;
};
```

## Files to Create/Modify
1. `server/contacts_import.ts` — New file: import logic, merge strategy, legacy DB reading
2. `server/index.ts` — Register import routes

## Technical Notes
- Legacy DB path: `~/.imessage_crm/contacts.db` — check existence before attempting import
- Use transactions for bulk import (all-or-nothing per import run)
- Dry-run should return the same report structure but with `dry_run: true` and no DB writes
- Phone normalization reuses the function from WO-2026-260
- Large address books: process in batches of 100 to avoid memory issues with AppleScript output
