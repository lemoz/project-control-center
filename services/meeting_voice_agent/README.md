# Meeting Voice Agent (Pipecat skeleton)

Minimal Python service skeleton for the meeting voice agent. It loads
configuration from the environment, logs startup, and exits cleanly until the
Pipecat pipeline is implemented in later work orders.

## Setup
```
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run
```
python main.py
```

## Environment
Required for the pipeline (not enforced yet):
- `CONTROL_CENTER_ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `ANTHROPIC_API_KEY`

Optional:
- `PCC_BASE_URL` (default: `http://localhost:4010`)
- `ANTHROPIC_MODEL` (default: `claude-3-5-sonnet-20240620`)
- `ANTHROPIC_TEMPERATURE` (default: `0.2`)
- `ANTHROPIC_MAX_TOKENS` (default: `256`)
- `ELEVENLABS_STT_MODEL_ID`
- `ELEVENLABS_TTS_MODEL_ID`
- `ELEVENLABS_TTS_FORMAT`

Audio config (Recall.ai defaults):
- `VOICE_AUDIO_SAMPLE_RATE` (default: `16000`)
- `VOICE_AUDIO_CHANNELS` (default: `1`)
- `VOICE_AUDIO_SAMPLE_WIDTH` (default: `2`)
- `VOICE_AUDIO_FRAME_MS` (default: `20`)
- `VOICE_AUDIO_FORMAT` (default: `pcm_s16le`)
