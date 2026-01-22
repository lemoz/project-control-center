# ElevenLabs Voice Agent Setup (PCC)

Use this to configure the ElevenLabs agent for the PCC landing page voice guide.

## Agent configuration (dashboard)

- Name: `PCC Guide`
- System prompt:
```
You are a guide for the Project Control Center (PCC), an autonomous software development orchestration system. You help users understand what's happening across their projects.

Your personality:
- Concise and informative
- Technical but accessible
- Proactive about highlighting important items

When users ask about projects, work orders, or runs, use the available tools to fetch current data. When discussing specific items, use the focus tools to highlight them on the canvas.

Available context:
- The user is viewing an orbital canvas showing projects as orbiting nodes
- Each project contains work orders (WOs) and runs
- Runs can be in various states: running, waiting_for_input, you_review, merged, etc.

Keep responses brief (1-2 sentences when possible) since you're speaking, not writing.
```
- Voice: `Rachel` (professional, clear, friendly). Adjust if another voice is clearer in your tests.
- LLM: `Claude Sonnet 4` (reasoning effort: None; temperature default).
- Data residency: `us` (map to `serverLocation: "us"` in the client).

## Server tools (webhooks)

Each tool is a `POST` webhook that expects JSON and returns JSON.

1. `getGlobalContext`
   - Endpoint: `POST /api/voice/global-context`
   - Parameters: none
2. `getShiftContext`
   - Endpoint: `POST /api/voice/shift-context`
   - Parameters: `projectId` (string, required)
3. `getWorkOrder`
   - Endpoint: `POST /api/voice/work-order`
   - Parameters: `workOrderId` (string, required), `projectId` (string, optional, recommended)
4. `getRunStatus`
   - Endpoint: `POST /api/voice/run-status`
   - Parameters: `runId` (string, required)

## Client tools (UI actions)

Register these in the ElevenLabs React SDK `clientTools` map:

1. `focusNode({ nodeId })` (string, required)
2. `highlightWorkOrder({ workOrderId })` (string, required)
3. `toggleDetailPanel({ open })` (boolean, required)

## HMAC webhook verification

Set `CONTROL_CENTER_ELEVENLABS_WEBHOOK_SECRET` in the server env. The PCC server
verifies HMAC SHA256 signatures for all `/api/voice/*` endpoints.

- Accepted signature headers: `x-elevenlabs-signature`, `x-elevenlabs-hmac`,
  `x-webhook-signature`, `x-signature`
- Signature payload: raw request body bytes
- Signature format: hex or base64; values can be wrapped as `v1=<sig>` or `sha256=<sig>`

## React integration notes

- Store the agent ID in `.env.local`:
  - `NEXT_PUBLIC_ELEVENLABS_AGENT_ID=your-agent-id`
- Set data residency in `.env.local`:
  - `NEXT_PUBLIC_ELEVENLABS_SERVER_LOCATION=us`
- Production: use signed URLs or conversation tokens instead of a public agent ID.

## Network access

If ElevenLabs is calling your local PCC server directly, set
`CONTROL_CENTER_ALLOW_LAN=1` and expose the server via an HTTPS tunnel (ngrok or
similar) so the webhook URLs are reachable.
