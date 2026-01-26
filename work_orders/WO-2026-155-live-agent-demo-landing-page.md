---
id: WO-2026-155
title: Live Agent Demo Landing Page
goal: Compose orbital canvas, narration, and voice widget into a unified landing page that shows PCC building itself in real-time.
context:
  - WO-2026-145 Single-Project Orbital Canvas (done)
  - WO-2026-146 Ambient Audio Narration (done)
  - WO-2026-147 Agent-Canvas Focus Sync (done)
  - WO-2026-149 ElevenLabs Voice Agent Setup (done)
  - WO-2026-150 ElevenLabs Voice Widget (ready)
  - WO-2026-154 Podcast-Style Narration (done)
  - Visitors land on page and see PCC working on itself
  - The view follows the active agent shift
  - Narration explains what's happening and why it matters
  - Voice agent available for interactive Q&A (separate from the working agent)
acceptance_criteria:
  - Landing page route (/ or /live) with unified layout
  - Orbital canvas as the main visual, taking most of viewport
  - Canvas follows active shift focus (from WO-2026-147)
  - Ambient podcast narration plays (muted by default, enable prompt)
  - Voice widget accessible for visitor Q&A
  - Clear visual hierarchy - canvas is hero, controls are subtle
  - Shows shift status indicator (active shift info, or "no active shift")
  - Graceful fallback when no shift is active (static view, invite to explore)
  - Mobile responsive layout
non_goals:
  - Replacing the portfolio view entirely (keep as separate route if needed)
  - Admin/management features on this page
  - Multiple simultaneous shift views
stop_conditions:
  - Keep layout simple - don't over-design
  - If performance suffers with all components, lazy-load voice widget
priority: 2
tags:
  - landing-page
  - implementation
  - ui
  - voice
  - visualization
estimate_hours: 4
status: you_review
created_at: 2026-01-23
updated_at: 2026-01-26
depends_on:
  - WO-2026-150
era: v2
---
## Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [PCC Logo]                    [Shift: WO-2026-152] [🔊 🎤] │  <- Header: minimal, status + controls
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                                                             │
│                    ORBITAL CANVAS                           │
│              (follows active shift focus)                   │
│                                                             │
│                                                             │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  "The system is testing iteration 3 of the mobile fix..."  │  <- Narration transcript (collapsible)
└─────────────────────────────────────────────────────────────┘
```

## Components to Compose

1. **OrbitalCanvas** (from WO-2026-145)
   - Mode: single-project (PCC)
   - Focus sync enabled (WO-2026-147)

2. **NarrationPanel** (from WO-2026-146 + WO-2026-154)
   - Positioned as overlay or bottom bar
   - Muted by default, prompt to enable
   - Shows transcript

3. **VoiceWidget** (from WO-2026-150)
   - Floating button or header integration
   - Has shift context for Q&A

4. **ShiftStatusBar**
   - Shows current active shift info
   - Links to the WO being worked on

## State Flow

```
Active Shift
    ↓
┌───────────────────┐
│ Shift Context API │ ← polls every 5-10s
└───────────────────┘
    ↓
┌─────────────┬─────────────┬─────────────┐
│ Canvas      │ Narration   │ Voice Agent │
│ (focus)     │ (content)   │ (context)   │
└─────────────┴─────────────┴─────────────┘
```

## No Active Shift State

When no shift is running:
- Canvas shows static view of PCC WOs
- Narration says "No active work right now. Explore the project structure."
- Voice agent still available to explain the system
- Consider: "Start a shift" CTA for owner (auth-gated)

## Route Decision

Options:
1. `/` - Replace current portfolio as the main landing
2. `/live` - Separate route, portfolio stays at `/`
3. `/demo` - Public demo page

Recommend: `/live` initially, evaluate replacing `/` later.
