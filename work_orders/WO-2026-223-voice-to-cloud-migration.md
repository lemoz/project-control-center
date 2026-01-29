---
id: WO-2026-223
title: "Voice feature gating: cloud or BYOK"
goal: "Voice features require either a pcc-cloud subscription or a user-provided ElevenLabs API key. Graceful degradation when neither is configured."
context:
  - Voice is integral to the global canvas home page experience (WO-2026-235, WO-2026-236)
  - "ElevenLabs keys configured via env vars in server/config.ts (getElevenLabsApiKey, getElevenLabsAgentId)"
  - "Voice session endpoint: POST /api/voice/session in server/index.ts"
  - "VoiceWidget in app/landing/components/VoiceWidget/"
  - Cloud users get voice included; local users must provide their own ElevenLabs key
acceptance_criteria:
  - Voice availability check endpoint or flag in settings/health response
  - VoiceWidget checks voice availability before rendering controls
  - When no key configured: show "Configure ElevenLabs key" prompt with link to settings, or "Upgrade to Cloud" CTA
  - When key is configured (env var or user-provided): voice works as normal
  - Settings UI allows entering ElevenLabs API key and Agent ID for BYOK
  - Key validation on save (test against ElevenLabs API)
  - Canvas and session onboarding work without voice (text chat fallback)
non_goals:
  - Removing voice code from core
  - Changing ElevenLabs integration architecture
  - Billing integration for cloud voice
stop_conditions:
  - If ElevenLabs requires per-agent provisioning that can't work with BYOK, document limitations
priority: 2
tags:
  - voice
  - settings
  - gating
estimate_hours: 4
status: ready
created_at: 2026-01-27
updated_at: 2026-01-28
depends_on: []
era: v2
---
## Notes
- Voice files affected:
  - `server/config.ts` — getElevenLabsApiKey(), getElevenLabsAgentId()
  - `server/index.ts` — POST /api/voice/session
  - `app/landing/components/VoiceWidget/*` — gating UI
  - `app/settings/page.tsx` — BYOK input fields
- Cloud path: pcc-cloud provides keys via workspace env, no user action needed
- Local path: user enters own ElevenLabs API key + Agent ID in settings
