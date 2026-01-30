---
id: WO-2026-267
title: People directory UI
goal: Build a top-level /people page in the Next.js app for managing project contacts — full CRUD, project associations, Mac Contacts import, and inline conversation history timeline.
context:
  - "app/ directory (Next.js app router)"
  - server/db.ts (people API from WO-2026-260)
  - server/conversation_sync.ts (conversation history from WO-2026-262)
  - server/contacts_import.ts (Mac import from WO-2026-263)
  - "Existing UI patterns: app/projects/[id]/page.tsx, app/work-orders/page.tsx"
  - "Component patterns: components/ directory"
acceptance_criteria:
  - "Top-level /people route accessible from main navigation"
  - "People list page: searchable, filterable by project/tag/starred, sortable by name/last interaction"
  - "Contact detail panel (drawer or page): personal info, identifiers, project associations, conversation timeline"
  - "Add/edit/delete contacts with form validation"
  - "Add/remove identifiers (phone, email) with type and label"
  - "Associate contacts with projects (select project + relationship type)"
  - "Import from Mac Contacts button (calls POST /mac/contacts/import, shows import report)"
  - "Import from legacy iMessage CRM button (calls POST /mac/contacts/import-legacy)"
  - "Star/unstar contacts (starred contacts get background sync)"
  - "Inline conversation history timeline per contact: shows iMessage, email, meeting, call events chronologically"
  - "Conversation timeline filterable by channel"
  - "Responsive layout following existing app design patterns"
non_goals:
  - Real-time message composition from UI (v1 is view-only for conversations)
  - Contact merge UI (dedup is handled by import logic)
  - Bulk operations (multi-select, bulk delete)
  - Contact groups or custom categories beyond tags
stop_conditions:
  - If conversation timeline is too complex for v1, show just a summary card instead of full timeline
  - If import takes too long, show progress indicator and run async
priority: 2
tags:
  - ui
  - people
  - nextjs
  - frontend
estimate_hours: 5
status: ready
created_at: 2026-01-30
updated_at: 2026-01-30
depends_on:
  - WO-2026-260
  - WO-2026-262
  - WO-2026-263
era: v2
---
# People Directory UI

## Goal
Create the user-facing People directory — a top-level page where you can see all your project contacts, manage their information, import from Mac Contacts, and view their full conversation history across channels.

## Context
- The backend (WO-2026-260) provides CRUD APIs
- Conversation history (WO-2026-262) provides the timeline data
- Contacts import (WO-2026-263) provides the import endpoints
- Existing pages (projects, work-orders) provide UI patterns to follow
- This is the primary user-facing feature of the people system

## Page Structure

### /people (List Page)
```
┌─────────────────────────────────────────────────┐
│ People                          [+ Add] [Import]│
├─────────────────────────────────────────────────┤
│ 🔍 Search by name, company, role...             │
│ Filter: [All Projects ▾] [All Tags ▾] [★ Only]  │
├─────────────────────────────────────────────────┤
│ ★ John Smith    CTO, Acme Corp     2h ago       │
│   Jane Doe      Designer           Yesterday    │
│   Bob Wilson    Client              3 days ago   │
│   ...                                           │
└─────────────────────────────────────────────────┘
```

### Contact Detail (Drawer or /people/:id)
```
┌─────────────────────────────────────────────────┐
│ ← John Smith                    [Edit] [Delete] │
│ CTO at Acme Corp                         ★      │
├─────────────────────────────────────────────────┤
│ Identifiers                                     │
│ 📱 +1 (555) 123-4567  mobile        [remove]   │
│ 📧 john@acme.com      work          [remove]   │
│                              [+ Add identifier] │
├─────────────────────────────────────────────────┤
│ Projects                                        │
│ 🔗 Project Alpha    stakeholder      [remove]   │
│ 🔗 Project Beta     client           [remove]   │
│                              [+ Add to project] │
├─────────────────────────────────────────────────┤
│ Conversation History            [All ▾] [Sync]  │
│                                                  │
│ Today                                            │
│ 💬 iMessage (outbound) 2:30 PM                  │
│    "Hey, wanted to follow up on..."              │
│                                                  │
│ Yesterday                                        │
│ 📧 Email (inbound) 4:15 PM                      │
│    Re: Project Alpha timeline                    │
│                                                  │
│ Jan 28                                           │
│ 🎤 Meeting (bidirectional) 10:00 AM             │
│    Weekly sync — discussed milestones            │
│                                                  │
│ 📞 Call (outbound) 9:00 AM                      │
│    FaceTime audio call                           │
└─────────────────────────────────────────────────┘
```

## Components to Build

### PeopleListPage (`app/people/page.tsx`)
- Fetches `GET /people` with search/filter params
- Search input with debounce
- Filter dropdowns for project, tag, starred
- Sort toggle (name, last interaction)
- List items show name, company/role, last interaction time
- Click opens detail view

### PersonDetail (`app/people/[id]/page.tsx` or drawer component)
- Fetches `GET /people/:id` for info + identifiers + projects
- Fetches `GET /people/:id/conversations` for timeline
- Edit mode toggle for personal info fields
- Inline identifier management (add/remove)
- Project association management (add/remove with relationship picker)
- Conversation timeline with channel filter

### PersonForm (component)
- Reusable form for add/edit
- Fields: name, nickname, company, role, notes, tags
- Validation: name required

### ImportDialog (component)
- Triggered by Import button on list page
- Choice: "From Mac Contacts" or "From Legacy iMessage CRM"
- Optional: dry-run preview first
- Shows import report after completion: imported, updated, skipped, errors

### ConversationTimeline (component)
- Receives `conversation_events[]` for a person
- Groups by date
- Channel icons: iMessage, email, meeting, call, note
- Direction indicator (inbound/outbound/bidirectional)
- Shows summary or first line of content
- Channel filter (All, iMessage, Email, Meeting, Call)
- Pagination or infinite scroll for long histories
- Sync button triggers `POST /people/:id/conversations/sync`

## Navigation Integration
- Add "People" to the main navigation sidebar/header (alongside Projects, Work Orders, etc.)
- Badge or count showing total/active contacts (optional)

## Files to Create
1. `app/people/page.tsx` — List page
2. `app/people/[id]/page.tsx` — Detail page (or use drawer)
3. `components/people/PersonForm.tsx` — Add/edit form
4. `components/people/ImportDialog.tsx` — Import flow
5. `components/people/ConversationTimeline.tsx` — Conversation history display
6. `components/people/IdentifierManager.tsx` — Add/remove identifiers
7. `components/people/ProjectAssociations.tsx` — Project link management

## Files to Modify
1. Main navigation component — Add People link
2. Layout/sidebar — Include People in nav items

## Technical Notes
- Follow existing data fetching patterns (likely SWR or React Query based on codebase conventions)
- Use existing UI component library (check components/ for design system)
- Conversation timeline should handle mixed channels gracefully
- Import can be slow for large address books — show loading state with progress
- Star toggle should be instant (optimistic update)
- Search should debounce (300ms) to avoid excessive API calls
- Last interaction time calculated from most recent conversation_event
