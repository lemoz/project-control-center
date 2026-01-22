---
id: WO-2026-139
title: Ambient Audio Narration Research
goal: Explore how to add periodic voice narration that describes what the agent is doing, for the landing page experience.
context:
  - Landing page shows live PCC agent shift
  - Want ambient narration like a tour guide
  - Not constant - triggered by events or periodic intervals
  - Should feel natural, not robotic or overwhelming
acceptance_criteria:
  - Survey TTS options (browser, ElevenLabs, OpenAI, etc.)
  - Define narration triggers (events, intervals, idle)
  - Propose content templates (what does it say?)
  - Consider pacing and frequency
  - Address visitor control (mute, volume, disable)
  - Identify data sources for narration content
  - Sketch narration state machine
non_goals:
  - Voice INPUT (separate research)
  - Implementation
  - Detailed audio engineering
stop_conditions:
  - Focus on the narration experience design
  - Don't over-engineer audio pipeline
priority: 3
tags:
  - research
  - ui
  - audio
  - ux
estimate_hours: 2
status: done
created_at: 2026-01-22
updated_at: 2026-01-22
depends_on: []
era: v2
---
## Research Questions

1. **TTS Options**:
   - Browser Web Speech API (free, variable quality)
   - ElevenLabs (high quality, cost per char)
   - OpenAI TTS (good quality, cost per char)
   - Google Cloud TTS (quality, cost)
   - Pre-recorded snippets + dynamic assembly?

2. **Narration Triggers**:
   - **Event-driven**: Run started, run completed, escalation, agent decision
   - **Periodic**: Every 30-60s, summarize current state
   - **Idle-driven**: User hasn't interacted in X seconds, re-engage
   - **Threshold**: Something notable happened (success rate changed, etc.)

3. **Content Templates**:
   - "The agent just started working on [WO title]..."
   - "[N] work orders are currently in progress..."
   - "Success rate is now [X]%, trending toward our [Y]% goal..."
   - "This work order is about [goal summary]..."
   - "The system is waiting for [blocker]..."

4. **Pacing & Frequency**:
   - Too frequent = annoying
   - Too sparse = feels dead
   - Sweet spot: 30-60s between narrations?
   - Events can interrupt/reset timer

5. **Visitor Controls**:
   - Mute button (obvious, persistent)
   - Volume slider?
   - "Narration: On/Off" toggle
   - Default: on? off? Ask on first visit?

## Narration State Machine

```
                    ┌──────────────┐
                    │    IDLE      │
                    │  (silent)    │
                    └──────┬───────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
            ▼              ▼              ▼
      ┌──────────┐  ┌──────────┐  ┌──────────┐
      │  EVENT   │  │  TIMER   │  │  NUDGE   │
      │ triggered│  │ elapsed  │  │ (idle)   │
      └────┬─────┘  └────┬─────┘  └────┬─────┘
           │             │             │
           └─────────────┼─────────────┘
                         ▼
                  ┌──────────────┐
                  │  SPEAKING    │
                  │  (TTS play)  │
                  └──────┬───────┘
                         │
                         ▼
                  ┌──────────────┐
                  │  COOLDOWN    │
                  │  (min gap)   │
                  └──────┬───────┘
                         │
                         ▼
                    back to IDLE
```

## Voice Character

- Tone: Calm, professional, slightly warm
- Not overly enthusiastic or robotic
- Like a museum audio guide or documentary narrator
- Short sentences, clear language
- Avoid jargon for visitors
