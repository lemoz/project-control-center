# WO-2026-143 ElevenLabs Conversational AI Research

Status: Research Complete (sources listed at end)

## 1) Capability Assessment (verified)

ElevenLabs Agents (formerly Conversational AI) provides a full voice agent stack: fine-tuned ASR, LLM selection, low-latency TTS across 5,000+ voices in 31 languages, and a proprietary turn-taking model. The platform includes a workflow builder, knowledge base with RAG, tool calling, and dynamic personalization variables, plus analytics and automated testing. (Sources: https://elevenlabs.io/docs/agents-platform/overview, https://elevenlabs.io/docs/conversational-ai/overview)

Deployment options include a web widget, SDKs (React, Swift, Kotlin, React Native), a WebSocket API for custom clients, and telephony integrations (SIP/Twilio) that we can ignore for web-only scope. (Sources: https://elevenlabs.io/docs/conversational-ai/overview, https://elevenlabs.io/docs/conversational-ai/libraries/react)

## 2) Agent Configuration (system prompt, knowledge base, tools)

### System prompt and workflow
- System prompt customization is supported; use it to define the PCC guide persona and tool-calling rules. (Source: https://elevenlabs.io/docs/agents-platform/overview)
- Workflow builder enables multi-step conversation flows when needed. (Source: https://elevenlabs.io/docs/agents-platform/overview)

### Knowledge base (RAG)
- Agents support a knowledge base with Retrieval-Augmented Generation for grounding responses. (Source: https://elevenlabs.io/docs/agents-platform/overview)
- Proposed PCC docs to seed: README, docs/system-architecture.md, docs/agent_shift_protocol.md, docs/work_orders.md.
- Doc limits and refresh/invalidations are not specified in the docs we have; confirm if we plan to rely heavily on RAG.

### Tools
- Tools can be configured as client tools (in-app), server tools (webhooks), MCP tools, or system tools (end call, transfer, language detection, voicemail). (Source: https://elevenlabs.io/docs/agents-platform/customization/tools)
- Tool guidance should live in the system prompt for reliable invocation.

## 3) LLM Connection (Claude)

### Supported models and BYO
- Native models include GPT-4o/4o mini, Claude Sonnet 4, Claude 3.7 Sonnet, Claude Haiku, and Gemini variants. (Source: https://elevenlabs.io/docs/agents-platform/customization/llm)
- BYO options:
  - Custom OpenAI API key for supported models.
  - Custom LLM server that replicates the OpenAI chat completions API format. (Source: https://elevenlabs.io/docs/agents-platform/customization/llm)

### Configuration controls
- Temperature, backup LLM, reasoning effort (None/Low/Medium/High), and max tokens are configurable. (Source: https://elevenlabs.io/docs/agents-platform/customization/llm)
- Guidance: keep reasoning effort at None for natural conversation. (Source: https://elevenlabs.io/docs/agents-platform/customization/llm)

### PCC recommendation
- Use Claude Sonnet 4 for higher-quality answers and tool calling, either via ElevenLabs native model selection or BYO key.
- If BYO keys are used, keep keys server-side and mint short-lived session tokens for the client.

## 4) Tool Calling (PCC API integration)

### Tool types
1) Client tools: run in the browser/app for UI updates and local actions.
2) Server tools: webhooks to your backend APIs.
3) MCP tools: connect to Model Context Protocol servers.
4) System tools: built-in actions (end call, transfer, language detection, voicemail). (Source: https://elevenlabs.io/docs/agents-platform/customization/tools)

### Server tool mechanics
- Configure a webhook tool in the agent settings: endpoint URL + parameter schema (name, type, description, required). (Source: https://elevenlabs.io/docs/agents-platform/customization/tools)
- The agent extracts parameters from conversation and calls your webhook with a JSON body.
- HMAC authentication is supported for webhook verification. (Source: https://elevenlabs.io/docs/agents-platform/customization/tools)
- If "Wait for response" is enabled, the tool result is appended to the conversation context before the agent responds. (Source: https://elevenlabs.io/docs/agents-platform/customization/tools)

### Client tool mechanics
- Define tools in the dashboard and register implementations in the React SDK via `clientTools`. (Source: https://elevenlabs.io/docs/conversational-ai/libraries/react)
- Tool implementations return a string or JSON string; returned data can be added to context when "Wait for response" is enabled.

### PCC tool set (server + client)
Server tools (webhooks):
- getShiftContext(projectId)
- getWorkOrder(workOrderId)
- getRunStatus(runId)
- getGlobalContext()

Client tools:
- focusNode({ nodeId })
- highlightWorkOrder({ workOrderId })
- toggleDetailPanel({ open })

## 5) React SDK Evaluation (landing page integration)

### SDK surface (verified)
Install:
```bash
npm install @elevenlabs/react
```

Core hook:
```tsx
import { useConversation } from '@elevenlabs/react';

const conversation = useConversation({
  onConnect: () => console.log('Connected'),
  onDisconnect: () => console.log('Disconnected'),
  onMessage: (message) => console.log('Message:', message),
  onError: (error) => console.error('Error:', error),
  clientTools: {
    focusNode: async ({ nodeId }) => {
      focusCanvas(nodeId);
      return 'focused';
    }
  }
});

await conversation.startConversation({
  agentId: 'your-agent-id' // public agents
  // or signedUrl / conversationToken for authenticated agents
});

await conversation.endConversation();
```
(Source: https://elevenlabs.io/docs/conversational-ai/libraries/react)

### Runtime configuration
- `agentId` for public agents, or `signedUrl` (signed WebSocket URL) / `conversationToken` (WebRTC token) for authenticated agents. (Source: https://elevenlabs.io/docs/conversational-ai/libraries/react)
- `overrides` to adjust conversation settings at runtime. (Source: https://elevenlabs.io/docs/conversational-ai/libraries/react)
- `textOnly` for text-only mode fallback. (Source: https://elevenlabs.io/docs/conversational-ai/libraries/react)
- `serverLocation` for data residency: "us", "eu-residency", "in-residency", "global". (Source: https://elevenlabs.io/docs/conversational-ai/libraries/react)

### Conversation state + events
- Hook state: `status`, `isSpeaking`. (Source: https://elevenlabs.io/docs/conversational-ai/libraries/react)
- Methods: `sendMessage(text)`, `sendContextualUpdate(text)`, `setVolume({ volume: 0-1 })`. (Source: https://elevenlabs.io/docs/conversational-ai/libraries/react)
- Event callbacks: `onConnect`, `onDisconnect`, `onMessage`, `onError`. (Source: https://elevenlabs.io/docs/conversational-ai/libraries/react)

### Integration takeaways
- The SDK is sufficient for a custom UI (mic button, transcript panel, speaking indicator). It does not provide a UI component out of the box.
- `sendContextualUpdate` is a clean path for feeding live canvas state without forcing a response.
- `agentId` + public agents are simplest; production should use `signedUrl` or `conversationToken` to avoid exposing API keys.

### Alternative: Web widget
Simple embed if we do not want to build custom UI:
```html
<elevenlabs-convai agent-id="your-agent-id"></elevenlabs-convai>
<script src="https://unpkg.com/@elevenlabs/convai-widget-embed" async></script>
```
(Source: https://elevenlabs.io/docs/conversational-ai/libraries/react)

## 6) Turn-Taking and UX

- Docs state a proprietary turn-taking model and end-to-end optimization; explicit barge-in behavior is not documented and should be tested. (Source: https://elevenlabs.io/docs/conversational-ai/overview)
- Recommended landing page UX:
  - Push-to-talk default (explicit user gesture).
  - Visible listening and speaking indicators using `status` and `isSpeaking`.
  - Transcript + short text responses for accessibility.
  - Text-only fallback using `textOnly` if mic permissions fail.

## 7) Latency, Reliability, and Monitoring

- ElevenLabs emphasizes end-to-end latency optimization and provides analytics plus conversation analysis/testing tooling. (Source: https://elevenlabs.io/docs/conversational-ai/overview)
- There is no SLA or numeric latency guarantee in the docs bundle; we should measure in prototype.

Measurement targets (prototype):
- Time to first transcript chunk.
- Time to first audio byte.
- End-to-end round trip for short vs long queries.
- Tool call latency (webhook round-trip).

## 8) Compliance & Security

- SOC 2, HIPAA, and GDPR compliance are available. (Source: https://elevenlabs.io/docs/agents-platform/overview)
- Data is encrypted in transit and at rest. (Source: https://elevenlabs.io/docs/agents-platform/overview)
- Data residency options include US, EU, India, and Global. (Source: https://elevenlabs.io/docs/conversational-ai/libraries/react)
- Zero-retention mode is available for privacy-sensitive deployments. (Source: https://elevenlabs.io/docs/agents-platform/overview)

## 9) Cost Comparison

### ElevenLabs pricing (verified)
- Free tier: 15 minutes (10k credits ~ 15 minutes). (Source: https://elevenlabs.io/pricing)
- Creator/Pro: $0.10 per minute. (Sources: https://elevenlabs.io/pricing, https://elevenlabs.io/blog/we-cut-our-pricing-for-conversational-ai)
- Business (annual): $0.08 per minute, includes 13,750 minutes. (Source: https://elevenlabs.io/pricing)
- Enterprise: lower rates available. (Source: https://elevenlabs.io/pricing)

Billing notes:
- Billed by minute (not by character). (Source: https://elevenlabs.io/pricing)
- Testing/setup calls billed at half cost. (Source: https://elevenlabs.io/pricing)
- LLM costs are currently absorbed by ElevenLabs. (Source: https://elevenlabs.io/pricing)
- No limit on number of agents; usage constrained by concurrent calls and monthly credits. (Source: https://elevenlabs.io/pricing)

### Rough monthly example (assumptions shown)
Assume 1,000 minutes of conversation per month:
- ElevenLabs Creator/Pro: 1,000 min * $0.10 = $100/month.
- ElevenLabs Business annual (effective): 1,000 min * $0.08 = $80/month.

Build-your-own comparison requires assumptions. Example assumptions for scale only (replace with actual vendor rates):
- STT: Web Speech API (free, browser-dependent).
- LLM: external provider (rate varies) with ~300k tokens/month for 1,000 minutes (assumes ~150 wpm input, 50% response length).
- TTS: external provider (rate varies) with ~1.1M characters/month for 1,000 minutes (assumes ~5 chars/word).

Under these assumptions, build-your-own variable cost is:
```
(stt_rate_per_min * 1,000) + (llm_rate_per_million_tokens * 0.30)
+ (tts_rate_per_million_chars * 1.10)
```
Even at low token/character rates, build-your-own plus engineering/ops is likely in the same order of magnitude as $0.08-$0.10/min unless we accept lower quality (text-only, no TTS) or use local models.

## 10) Integration Architecture (recommended)

```
Landing Page (React)
  -> useConversation hook (@elevenlabs/react)
     - startConversation({ agentId | signedUrl | conversationToken })
     - status/isSpeaking for UI
     - sendContextualUpdate() for live canvas context
     - clientTools for UI actions
  -> PCC API tool endpoints (server)
     - /projects/:id/shift-context
     - /repos/:id/work-orders/:id
     - /runs/:id

ElevenLabs Agents
  -> Agent config (system prompt, voice, LLM, tools)
  -> Server tools (webhooks) -> PCC API -> tool results -> response
```

## 11) Limitations / Blockers

- Token/context limits and knowledge base size limits are not documented in the bundle; confirm before relying heavily on RAG.
- Turn-taking details (barge-in, interruption behavior) are not specified; needs prototype verification.
- API key exposure: public agentId is easy, but production should rely on signedUrl or conversationToken minted server-side.
- Docs list self-serve tiers for Agents, with Enterprise offering lower rates; confirm if any compliance features require Enterprise before launch.
- If HIPAA/zero-retention/data residency are required for launch, confirm whether they require Enterprise contract.

Fallback if blocked: use WO-2026-141 path (Web Speech API + LLM + optional TTS) with a custom UI and in-house tool routing.

## 12) Prototype Plan (no implementation)

1) Create an ElevenLabs agent with PCC system prompt and selected voice.
2) Set LLM to Claude Sonnet 4 (native) or BYO key via OpenAI-compatible config.
3) Define server tools (webhooks) for PCC endpoints with HMAC verification.
4) Implement a minimal React widget:
   - Mic button, transcript panel, speaking indicator.
   - Use `sendContextualUpdate` for live canvas state.
5) Measure latency + tool call impact using analytics.

## 13) Go / No-Go Recommendation

GO for a landing-page prototype using ElevenLabs Agents.

Rationale:
- React SDK + web widget provide a clear integration path with event hooks and `sendContextualUpdate`.
- Tool calling (webhooks + client tools) maps cleanly to PCC APIs and UI actions.
- Claude Sonnet 4 is supported directly and via BYO keys.
- Data residency, zero-retention mode, and compliance options are documented.
- Pricing is transparent and competitive for a voice demo compared to assembling STT + LLM + TTS.

Revisit if:
- Measured latency is not acceptable for interactive UI.
- Required compliance features are enterprise-only and not available on our tier.
- Turn-taking behavior does not support barge-in or feels unnatural in tests.

## Open Questions
- Knowledge base limits (file types, size, refresh behavior).
- SLA/uptime commitments beyond analytics and testing tooling.
- Concrete barge-in/interrupt semantics for the turn-taking model.

## Sources
- https://elevenlabs.io/docs/conversational-ai/overview
- https://elevenlabs.io/docs/agents-platform/overview
- https://elevenlabs.io/docs/conversational-ai/libraries/react
- https://elevenlabs.io/docs/agents-platform/customization/tools
- https://elevenlabs.io/docs/agents-platform/customization/llm
- https://elevenlabs.io/pricing
- https://elevenlabs.io/blog/we-cut-our-pricing-for-conversational-ai
- https://elevenlabs.io/blog/claude-sonnet-4-is-now-available-in-conversational-ai
