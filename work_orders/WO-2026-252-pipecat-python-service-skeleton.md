---
id: WO-2026-252
title: Pipecat Python service skeleton
goal: Standalone Python service under services/meeting_voice_agent/ with Pipecat installed, config loading, and a runnable entrypoint
context:
  - "Parent WO: WO-2026-245 (unpacked)"
  - "Pipecat: open-source Python framework by Daily.co for real-time voice pipelines"
  - "Failed run produced a scaffold: .system/runs/42e1eb06.../worktree/services/meeting_voice_agent/"
  - "Reference that run's main.py for patterns (AudioConfig, env helpers, load_symbol)"
acceptance_criteria:
  - services/meeting_voice_agent/ directory with main.py, requirements.txt, README.md
  - requirements.txt pins pipecat-ai, httpx, and anthropic
  - Config loading from env vars (PCC_BASE_URL, ELEVENLABS keys, audio params)
  - AudioConfig dataclass for Recall.ai defaults (16kHz mono PCM s16le, 20ms frames)
  - "python main.py" starts without crashing (logs startup, exits cleanly if no pipeline yet)
  - .gitignore for .venv/ and __pycache__/
non_goals:
  - LLM integration (WO-2026-254)
  - ElevenLabs STT/TTS wiring (WO-2026-255)
  - WebSocket transport (WO-2026-256)
priority: 1
tags:
  - meeting-integration
  - voice
  - pipecat
estimate_hours: 1
status: done
depends_on: []
created_at: 2026-01-29
updated_at: 2026-01-29
era: v2
---
