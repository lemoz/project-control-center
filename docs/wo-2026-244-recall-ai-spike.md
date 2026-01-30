# WO-2026-244 Recall.ai Integration Spike

**Status:** Complete (spike validated — two-way audio confirmed with quality issues noted)

## Goal
Validate Recall.ai bot join flow with two-way audio using ElevenLabs Conversation API via Output Media.

## What is implemented
- Output Media page at `/recall/output-media` (`app/recall/output-media/page.tsx`).
  - Auto-connects to ElevenLabs Conversation API via `/api/voice/session`.
  - Sends a greeting prompt on connect.
  - Displays transcript + transcript->TTS start latency estimates (user transcript -> `isSpeaking` true).

## API Auth Validation
- Recall.ai create endpoint responded `201` to bot creation.
- Recall.ai bot status fetch (`GET /api/v1/bot/{id}/`) responded `200`.
- ElevenLabs signed URL endpoint responded `200`.

## Configuration notes
- `CONTROL_CENTER_RECALL_CREATE_BODY` uses `{audio_ws_url}` as the Output Media URL placeholder.
- Output Media was exposed via a temporary Cloudflare tunnel for this run.
- Telemetry is disabled by default. Enable with `RECALL_TELEMETRY_ENABLED=true`.
- Telemetry writes require `RECALL_TELEMETRY_TOKEN`; the Output Media page sends `NEXT_PUBLIC_RECALL_TELEMETRY_TOKEN`.
- Optional: set `RECALL_TELEMETRY_LOG_PATH` to override `/tmp/recall-output-media.jsonl`.

## Run steps (latest)
1. Start PCC server and web app with `CONTROL_CENTER_PORT=4100` + Next.js on `3020`.
2. Expose the web app publicly (Cloudflare tunnel) so Recall can fetch `/recall/output-media`.
3. Create the bot via Recall API with `output_media.camera.config.url` pointing to:
   - `https://increased-actor-left-visibility.trycloudflare.com/recall/output-media`
4. Bot joined meeting `hoa-eykx-wve` and reached `in_call_recording`.
5. Ended session via `POST /api/v1/bot/{bot_id}/leave_call/`.
6. Pulled transcript + speaker timelines via `GET /api/v1/recording/`.

## Latency measurement (partial)
- Source: Output Media telemetry in `/tmp/recall-output-media.jsonl` (requires `RECALL_TELEMETRY_ENABLED=true`).
- Metric: time from user transcript to `conversation.isSpeaking` turning true (TTS start in Output Media).
- This captures TTS start inside the Output Media page; Recall transport/playback latency is not included in the numbers above.
- Latest samples (2026-01-30): **14 ms**, **191 ms**, **3495 ms** (avg: **1233 ms**).
- Recall recording transcript for `recording_id=d82d6e5e-d5c3-4980-87f3-8956cdeb4ae7` only includes the host participant; bot audio is not represented, so full participant -> bot -> participant latency cannot be computed from recording yet.
- Prior baseline (text-only user message -> agent message): **889 ms** (kept for reference).

## Known issues
- **Audio quality:** Bot audio is choppy when heard by participants — likely Recall Output Media transport or ElevenLabs streaming latency.
- **Latency:** Noticeable delay between participant speech and bot response. Transcript→TTS start averages 1233ms, but perceived end-to-end latency is higher due to Recall transport.
- **Latency measurement gap:** Full participant→bot→participant round-trip cannot be measured programmatically — Recall recordings omit the bot audio track. Manual observation confirms it works but is slow.

## Verification evidence
- **Bot audio heard by participants:** Confirmed by human tester (2026-01-30). Audio is audible but choppy with noticeable latency.
- Greeting TTS triggered: agent transcript shows "Hello everyone... I am the voice guide for the Project Control Center..." at `2026-01-30T15:55:32Z`.
- Participant speech transcribed: user transcript shows "It looks like a cool piece of feedback from Potter..." at `2026-01-30T16:00:08Z`.
- Agent responses followed (e.g., `2026-01-30T16:00:10Z`), confirming the two-way conversation loop.

## Notes
- Telemetry records only message previews (first 160 chars) + message lengths.
- Transcript->TTS latency is computed from the ElevenLabs Conversation `isSpeaking` signal in the Output Media page.
