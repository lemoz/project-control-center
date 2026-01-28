---
id: WO-2026-223
title: "Migrate voice features to cloud-only"
goal: "Remove voice functionality from PCC core and replace with CTA to pcc-cloud for voice support"
context:
  - Voice features (ElevenLabs integration, narration, voice commands) are moving to pcc-cloud
  - PCC core keeps chat functionality
  - Voice widgets in core should become promotional CTAs pointing users to cloud
  - Surfaced during WO-2026-221 landing page migration review
acceptance_criteria:
  - Remove ElevenLabs voice integration from PCC core
  - Replace VoiceWidget components with a "Voice available in Cloud" CTA component
  - CTA links to pcc-cloud signup/voice feature page
  - Remove voice command integration from CanvasShell
  - Keep all chat-related functionality intact
  - Update any voice-related imports/dependencies
  - Clean up unused voice utilities and hooks
non_goals:
  - Implementing voice in pcc-cloud (separate WO)
  - Modifying chat functionality
  - Removing voice code from pcc-cloud
stop_conditions:
  - If voice and chat are tightly coupled, document and escalate
priority: 2
tags:
  - voice
  - migration
  - cloud
estimate_hours: 3
status: backlog
created_at: 2026-01-27
updated_at: 2026-01-28
depends_on: []
era: v2
---
## Notes
- Voice files to update/remove:
  - app/landing/components/VoiceWidget/*
  - app/landing/NarrationPanel.tsx
  - app/live/CollapsibleVoiceWidget.tsx
  - app/playground/canvas/CanvasShell.tsx (voice command integration)
- Keep: All chat components and functionality
