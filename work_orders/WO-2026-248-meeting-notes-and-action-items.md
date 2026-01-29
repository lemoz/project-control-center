---
id: WO-2026-248
title: "Meeting notes and action items"
goal: "Meeting-specific tools for notes and action tracking, stored in PCC"
context:
  - "Communications API: POST /projects/{id}/communications"
  - "Work order creation: POST /repos/{id}/work-orders"
  - "Meeting agent tools from WO-2026-245"
acceptance_criteria:
  - "save_meeting_notes tool — timestamped notes during meeting"
  - "create_action_item tool — creates WO or communication from discussion"
  - "Post-meeting summary generated automatically (communication with intent 'status')"
  - "Notes accessible via PCC API after meeting ends"
  - "Action items link back to the meeting they originated from"
non_goals:
  - "Full meeting transcription storage"
  - "Video recording"
stop_conditions: []
priority: 2
tags:
  - meeting-integration
  - notes
estimate_hours: 3
status: backlog
created_at: 2026-01-29
updated_at: 2026-01-29
depends_on:
  - WO-2026-245
era: v2
---
## Notes

The meeting agent should be able to:
1. Save notes on-demand ("note that we decided to prioritize the voice module")
2. Create action items from discussion ("create a work order for the API refactor")
3. Auto-generate a post-meeting summary when the meeting ends

Notes and action items should be stored as PCC communications or WOs so they're visible in the existing UI.
