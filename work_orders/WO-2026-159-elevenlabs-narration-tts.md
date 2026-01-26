---
id: WO-2026-159
title: ElevenLabs Narration TTS
goal: Replace Web Speech API with ElevenLabs for ambient narration, providing higher quality and consistent voice.
context:
  - WO-2026-146 implemented narration with Web Speech API (done)
  - WO-2026-154 added LLM-generated content (done)
  - WO-2026-158 adds chief of staff context (in progress)
  - Web Speech API voice is robotic and varies by browser
  - ElevenLabs provides consistent, high-quality voices
  - Narration remains separate from voice widget (different context needs)
acceptance_criteria:
  - Replace Web Speech API calls with ElevenLabs TTS API
  - Select/configure voice that matches chief of staff persona
  - Handle API errors gracefully (fallback to Web Speech or silent)
  - Respect rate limits and manage costs
  - Audio playback in browser (stream or fetch+play)
  - Maintain existing narration service interface (speak method)
  - Cache audio for repeated phrases if beneficial
non_goals:
  - Changing narration content/context (that's WO-2026-158)
  - Two-way conversation (that's the voice widget)
  - Real-time streaming narration
stop_conditions:
  - If latency is too high (>3s), consider pre-generating common phrases
  - Keep costs reasonable - narration is frequent
priority: 3
tags:
  - narration
  - elevenlabs
  - tts
  - audio
estimate_hours: 3
status: ready
created_at: 2026-01-25
updated_at: 2026-01-26
depends_on:
  - WO-2026-158
era: v2
---
## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Narration       │────►│ ElevenLabs TTS  │────►│ Browser Audio   │
│ Service         │     │ API             │     │ Playback        │
│ (text)          │     │ (audio)         │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Implementation

### Server Endpoint
```typescript
// POST /api/narration/speak
// Takes text, returns audio stream or URL
app.post('/api/narration/speak', async (req, res) => {
  const { text } = req.body;
  const audio = await elevenLabs.textToSpeech({
    text,
    voice_id: process.env.ELEVENLABS_NARRATION_VOICE_ID,
    model_id: 'eleven_turbo_v2', // Fast, good quality
  });
  res.set('Content-Type', 'audio/mpeg');
  res.send(audio);
});
```

### Client Update
```typescript
// In narration service, replace:
window.speechSynthesis.speak(utterance);

// With:
const audio = await fetch('/api/narration/speak', {
  method: 'POST',
  body: JSON.stringify({ text }),
});
const blob = await audio.blob();
const url = URL.createObjectURL(blob);
new Audio(url).play();
```

## Voice Selection

Choose a voice that fits "chief of staff" persona:
- Professional, calm
- Clear enunciation
- Not overly enthusiastic
- Consistent across narrations

## Cost Considerations

ElevenLabs pricing is per character. For frequent narration:
- Keep messages concise (already enforced by MAX_NARRATION_CHARS)
- Consider caching common phrases
- Set daily/monthly budget limits
- Monitor usage
