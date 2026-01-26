---
id: WO-2026-160
title: Start Shift Button on Live Page
status: done
priority: 2
track: live-demo
estimate_hours: 2
updated_at: 2026-01-26
---
## Goal

Add a "Start Shift" button to the `/live` page that allows users to launch an agent shift directly from the live demo interface.

## Context

- The live page (`/app/live/`) shows the orbital canvas visualization
- When no shift is active, users should be able to start one
- The backend has `POST /projects/:id/shifts/spawn` endpoint that starts a shift and spawns an agent
- Need to figure out API routing between Next.js (port 3010) and Express server (port 4010)
- Other components use `/api/projects/...` URLs but there's no obvious proxy setup

## Acceptance Criteria

- [ ] "Start Shift" button appears in ShiftStatusBar when no active shift
- [ ] Clicking button calls the spawn endpoint and starts an agent shift
- [ ] Button shows loading state while starting
- [ ] Error state displayed if spawn fails
- [ ] Once started, the status bar updates to show active shift

## Technical Notes

- ShiftStatusBar component already has button UI scaffolded (needs API fix)
- May need to create Next.js API route to proxy to backend, or configure rewrites
- Check how other `/api/projects/...` calls are working (costs, shift-context, etc.)
- Server endpoint: `POST /projects/:id/shifts/spawn`

## Files to Modify

- `app/live/ShiftStatusBar.tsx` - Fix API call
- Possibly `next.config.js` - Add rewrites
- Or `app/api/projects/[id]/shifts/spawn/route.ts` - Create proxy route
