---
id: WO-2026-250
title: "Phone dial-in fallback"
goal: "ElevenLabs outbound calling via Twilio for meetings with PSTN dial-in"
context:
  - "ElevenLabs has outbound calling support via Twilio"
  - "Google Meet PSTN dial-in only available for paid Google Workspace meetings"
  - "Same communications-based architecture as the browser agent (WO-2026-245)"
acceptance_criteria:
  - "Agent dials a phone number and participates in voice conversation"
  - "Same comms-based architecture — actions route through global session"
  - "Works with Google Meet phone numbers (Workspace only)"
  - "Fallback detection: if browser join fails, offer phone dial-in"
non_goals:
  - "Video or screen sharing via phone"
  - "Speaker diarization from phone audio"
stop_conditions:
  - "ElevenLabs outbound calling not available"
  - "Twilio integration blocked"
priority: 3
tags:
  - meeting-integration
  - fallback
  - phone
estimate_hours: 3
status: backlog
created_at: 2026-01-29
updated_at: 2026-01-29
depends_on:
  - WO-2026-245
era: v2
---
## Notes

This is a fallback path for when browser-based meeting join isn't available. Audio-only, no video/chat/visual context. Limited to paid Google Workspace meetings that provide PSTN dial-in numbers.
