---
id: WO-2026-146
title: Ambient Audio Narration Implementation
goal: Add periodic voice narration to the landing page that describes what the agent is doing using Web Speech API.
context:
  - WO-2026-139 research doc (docs/ambient-narration-research-wo-2026-139.md)
  - Landing page shows live PCC agent working
  - Web Speech API for v0 (no infra, free)
  - Default OFF until user enables
  - Tier 3 priority (engagement layer)
acceptance_criteria:
  - Narration service using Web Speech API
  - Event-driven triggers (run started, phase change, completed, escalation)
  - Periodic summaries every 45-75s during active work
  - Pacing rules (min 25-35s gap, collapse event bursts)
  - State machine (Idle, Speaking, Cooldown, Muted, Disabled)
  - Mute toggle visible on landing page
  - Default OFF with soft prompt to enable
  - Text transcript/captions for accessibility
  - Content templates for each event type
non_goals:
  - Premium TTS integration (ElevenLabs/OpenAI) - future enhancement
  - Pre-recorded audio stingers - future enhancement
  - Multiple voice personas
stop_conditions:
  - Keep implementation simple for v0
  - If Web Speech API quality is too poor, document and revisit
priority: 3
tags:
  - implementation
  - ui
  - audio
  - landing-page
  - accessibility
estimate_hours: 6
status: done
created_at: 2026-01-22
updated_at: 2026-01-23
depends_on:
  - WO-2026-139
era: v2
---
## Implementation Plan

### 1. Narration Service

```ts
// app/landing/services/narration.ts
type NarrationState = 'idle' | 'speaking' | 'cooldown' | 'muted' | 'disabled';

class NarrationService {
  private state: NarrationState = 'disabled';
  private cooldownMs = 30000; // 30s min gap
  private periodicMs = 60000; // 60s between summaries
  private utterance: SpeechSynthesisUtterance | null = null;
  
  speak(text: string, priority: 'high' | 'normal' = 'normal'): void;
  mute(): void;
  unmute(): void;
  enable(): void;
  disable(): void;
}
```

### 2. Event Triggers

Subscribe to run/shift events via SSE or polling:

| Event | Template |
|-------|----------|
| run_started | "Starting work on {wo_title}." |
| phase_change | "Now {phase} for {wo_title}." |
| run_completed | "Run complete for {wo_title}. {status}." |
| escalation | "Waiting for input: {summary}." |
| periodic | "{active_count} work orders active." |

### 3. React Hook

```tsx
// app/landing/hooks/useNarration.ts
function useNarration() {
  const [enabled, setEnabled] = useLocalStorage('narration-enabled', false);
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState<string[]>([]);
  
  // Subscribe to events, trigger narration
  // Return controls and transcript
}
```

### 4. UI Components

```tsx
// Mute toggle (always visible when enabled)
<NarrationToggle enabled={enabled} muted={muted} onToggle={...} />

// Transcript panel (collapsible)
<NarrationTranscript lines={transcript} />

// Enable prompt (shown once)
<NarrationPrompt onEnable={...} onDismiss={...} />
```

### 5. Pacing Logic

- Event narration resets periodic timer
- Drop low-priority if high-priority queued
- Collapse rapid events into single summary
- Max 1 idle nudge per inactivity period
