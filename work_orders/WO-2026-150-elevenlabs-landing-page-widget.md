---
id: WO-2026-150
title: ElevenLabs Landing Page Voice Widget
goal: Integrate ElevenLabs voice agent into the landing page with React SDK, connecting to the orbital canvas.
context:
  - WO-2026-143 research (docs/wo-2026-143-elevenlabs-conversational-ai-research.md)
  - WO-2026-149 agent setup (agent ID, tool definitions)
  - WO-2026-145 orbital canvas implementation
  - WO-2026-147 agent-canvas focus sync
  - Uses @elevenlabs/react SDK with useConversation hook
acceptance_criteria:
  - Install @elevenlabs/react SDK
  - Create VoiceWidget component with mic button and speaking indicator
  - Implement useConversation hook integration
    - Connect to agent via signedUrl (not public agentId)
    - Handle onConnect, onDisconnect, onMessage, onError
    - Show status and isSpeaking state in UI
  - Implement client tools that interact with canvas
    - focusNode -> call canvas focus function
    - highlightWorkOrder -> highlight WO node
    - toggleDetailPanel -> show/hide detail panel
  - Use sendContextualUpdate to feed live canvas state to agent
    - Current focused node
    - Visible projects/WOs
    - Any selected items
  - Create server endpoint to mint signed URLs
    - POST /api/voice/session -> returns signedUrl
    - Short-lived tokens (e.g., 5 minutes)
  - Add visual indicators
    - Listening state (pulsing mic)
    - Speaking state (waveform or animation)
    - Transcript display (optional, for accessibility)
  - Handle errors gracefully (mic permission denied, connection failed)
  - Add text-only fallback for users who can't use voice
non_goals:
  - Transcript history/chat log
  - Voice command shortcuts (just natural conversation)
  - Mobile-specific optimizations
stop_conditions:
  - If latency is unacceptable (>2s response), document and consider alternatives
  - Keep UI minimal, focus on voice experience
priority: 2
tags:
  - implementation
  - voice
  - ui
  - landing-page
  - react
estimate_hours: 6
status: blocked
created_at: 2026-01-22
updated_at: 2026-01-22
depends_on:
  - WO-2026-149
  - WO-2026-145
  - WO-2026-147
era: v2
---
## Component Structure

```
app/landing/
  components/
    VoiceWidget/
      VoiceWidget.tsx       # Main component
      VoiceButton.tsx       # Mic button with states
      SpeakingIndicator.tsx # Visual feedback when agent speaks
      useVoiceAgent.ts      # Custom hook wrapping useConversation
      voiceClientTools.ts   # Client tool implementations
```

## useVoiceAgent Hook

```typescript
import { useConversation } from '@elevenlabs/react';
import { useCallback, useEffect, useState } from 'react';
import { useCanvasFocus } from '../canvas/useCanvasFocus';

export function useVoiceAgent() {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const { focusNode, highlightWorkOrder } = useCanvasFocus();

  const conversation = useConversation({
    onConnect: () => console.log('Voice agent connected'),
    onDisconnect: () => console.log('Voice agent disconnected'),
    onError: (error) => console.error('Voice agent error:', error),
    clientTools: {
      focusNode: async ({ nodeId }) => {
        focusNode(nodeId);
        return 'focused';
      },
      highlightWorkOrder: async ({ workOrderId }) => {
        highlightWorkOrder(workOrderId);
        return 'highlighted';
      },
      toggleDetailPanel: async ({ open }) => {
        // dispatch to detail panel state
        return open ? 'opened' : 'closed';
      },
    },
  });

  const start = useCallback(async () => {
    // Fetch signed URL from server
    const res = await fetch('/api/voice/session', { method: 'POST' });
    const { signedUrl } = await res.json();
    await conversation.startConversation({ signedUrl });
  }, [conversation]);

  const stop = useCallback(async () => {
    await conversation.endConversation();
  }, [conversation]);

  return {
    status: conversation.status,
    isSpeaking: conversation.isSpeaking,
    start,
    stop,
    sendContextualUpdate: conversation.sendContextualUpdate,
  };
}
```

## Canvas Context Updates

When canvas state changes, send contextual updates:

```typescript
useEffect(() => {
  if (status === 'connected' && focusedNode) {
    sendContextualUpdate(
      `User is now viewing: ${focusedNode.type} "${focusedNode.name}"`
    );
  }
}, [focusedNode, status, sendContextualUpdate]);
```

## Server Endpoint

```typescript
// server/index.ts
app.post('/api/voice/session', async (req, res) => {
  // Call ElevenLabs API to get signed URL
  const signedUrl = await getElevenLabsSignedUrl({
    agentId: process.env.ELEVENLABS_AGENT_ID,
    apiKey: process.env.ELEVENLABS_API_KEY,
  });
  res.json({ signedUrl });
});
```

## UI States

1. **Idle**: Mic button visible, muted appearance
2. **Connecting**: Mic button with loading spinner
3. **Listening**: Mic button pulsing, ready for input
4. **Processing**: Brief transition state
5. **Speaking**: Waveform animation, mic muted
6. **Error**: Error message, retry button

## Accessibility

- Keyboard accessible (Enter to toggle, Escape to stop)
- Screen reader announcements for state changes
- Text-only mode toggle for users without mic access
- Visible transcript option for hearing-impaired users
