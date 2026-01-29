import logging
import os
from dataclasses import dataclass
from typing import Any, Optional

LOG = logging.getLogger("meeting_voice_agent")


@dataclass(frozen=True)
class AudioConfig:
    sample_rate: int = 16000
    channels: int = 1
    sample_width: int = 2
    frame_duration_ms: int = 20
    audio_format: str = "pcm_s16le"


@dataclass(frozen=True)
class ServiceConfig:
    pcc_base_url: str
    elevenlabs_api_key: Optional[str]
    elevenlabs_voice_id: Optional[str]
    elevenlabs_stt_model_id: Optional[str]
    elevenlabs_tts_model_id: Optional[str]
    elevenlabs_tts_format: Optional[str]
    audio: AudioConfig


def env(name: str, default: Optional[str] = None) -> Optional[str]:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value


def load_symbol(symbol: str, modules: list[str]) -> Any:
    for module_name in modules:
        try:
            module = __import__(module_name, fromlist=[symbol])
        except Exception:
            continue
        if hasattr(module, symbol):
            return getattr(module, symbol)
    raise ImportError(f"Unable to import {symbol} from {modules}")


def parse_int_env(name: str, default: int) -> int:
    raw = env(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        LOG.warning("Invalid %s=%r, using default %s", name, raw, default)
        return default


def load_audio_config() -> AudioConfig:
    return AudioConfig(
        sample_rate=parse_int_env("VOICE_AUDIO_SAMPLE_RATE", 16000),
        channels=parse_int_env("VOICE_AUDIO_CHANNELS", 1),
        sample_width=parse_int_env("VOICE_AUDIO_SAMPLE_WIDTH", 2),
        frame_duration_ms=parse_int_env("VOICE_AUDIO_FRAME_MS", 20),
        audio_format=env("VOICE_AUDIO_FORMAT", "pcm_s16le") or "pcm_s16le",
    )


def load_config() -> ServiceConfig:
    return ServiceConfig(
        pcc_base_url=env("PCC_BASE_URL", "http://localhost:4010")
        or "http://localhost:4010",
        elevenlabs_api_key=env("CONTROL_CENTER_ELEVENLABS_API_KEY"),
        elevenlabs_voice_id=env("ELEVENLABS_VOICE_ID"),
        elevenlabs_stt_model_id=env("ELEVENLABS_STT_MODEL_ID"),
        elevenlabs_tts_model_id=env("ELEVENLABS_TTS_MODEL_ID"),
        elevenlabs_tts_format=env("ELEVENLABS_TTS_FORMAT"),
        audio=load_audio_config(),
    )


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    config = load_config()

    LOG.info("Meeting voice agent starting.")
    LOG.info("PCC base URL: %s", config.pcc_base_url)
    LOG.info("Audio config: %s", config.audio)

    if not config.elevenlabs_api_key:
        LOG.info("Missing CONTROL_CENTER_ELEVENLABS_API_KEY; pipeline not started.")
    if not config.elevenlabs_voice_id:
        LOG.info("Missing ELEVENLABS_VOICE_ID; pipeline not started.")

    LOG.info("Pipecat pipeline not configured yet; exiting cleanly.")


if __name__ == "__main__":
    main()
