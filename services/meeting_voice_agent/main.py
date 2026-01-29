import asyncio
import inspect
import logging
import os
from dataclasses import dataclass
from typing import Any, Optional

from pcc_tools import (
    PccClient,
    build_system_prompt,
    build_tool_callbacks,
    build_tool_definitions,
)

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
    anthropic_api_key: Optional[str]
    anthropic_model: str
    anthropic_temperature: float
    anthropic_max_tokens: int
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


def load_any_symbol(symbols: list[str], modules: list[str]) -> Any:
    last_error: Optional[Exception] = None
    for symbol in symbols:
        try:
            return load_symbol(symbol, modules)
        except ImportError as exc:
            last_error = exc
    raise ImportError(f"Unable to import any of {symbols} from {modules}") from last_error


def init_with_supported_kwargs(cls: Any, **kwargs: Any) -> Any:
    try:
        signature = inspect.signature(cls)
    except (TypeError, ValueError):
        return cls(**kwargs)
    supported = {
        key: value
        for key, value in kwargs.items()
        if key in signature.parameters and value is not None
    }
    return cls(**supported)


def parse_int_env(name: str, default: int) -> int:
    raw = env(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        LOG.warning("Invalid %s=%r, using default %s", name, raw, default)
        return default


def parse_float_env(name: str, default: float) -> float:
    raw = env(name)
    if raw is None:
        return default
    try:
        return float(raw)
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
        anthropic_api_key=env("ANTHROPIC_API_KEY"),
        anthropic_model=env("ANTHROPIC_MODEL", "claude-3-5-sonnet-20240620")
        or "claude-3-5-sonnet-20240620",
        anthropic_temperature=parse_float_env("ANTHROPIC_TEMPERATURE", 0.2),
        anthropic_max_tokens=parse_int_env("ANTHROPIC_MAX_TOKENS", 256),
        elevenlabs_api_key=env("CONTROL_CENTER_ELEVENLABS_API_KEY"),
        elevenlabs_voice_id=env("ELEVENLABS_VOICE_ID"),
        elevenlabs_stt_model_id=env("ELEVENLABS_STT_MODEL_ID"),
        elevenlabs_tts_model_id=env("ELEVENLABS_TTS_MODEL_ID"),
        elevenlabs_tts_format=env("ELEVENLABS_TTS_FORMAT"),
        audio=load_audio_config(),
    )


def attach_tools(
    llm: Any,
    tool_defs: list[dict[str, Any]],
    callbacks: dict[str, Any],
) -> None:
    if hasattr(llm, "tools"):
        setattr(llm, "tools", tool_defs)
    if hasattr(llm, "tool_callbacks"):
        setattr(llm, "tool_callbacks", callbacks)
    if hasattr(llm, "register_tool"):
        for tool in tool_defs:
            if "function" in tool:
                fn = tool.get("function", {})
                name = fn.get("name")
                description = fn.get("description", "")
                parameters = fn.get("parameters")
            else:
                name = tool.get("name")
                description = tool.get("description", "")
                parameters = tool.get("input_schema")
            if not name:
                continue
            callback = callbacks.get(name)
            if callback is None:
                continue
            llm.register_tool(
                name=name,
                description=description,
                parameters=parameters,
                callback=callback,
            )


def build_llm_processor(llm: Any) -> Any:
    try:
        LLMProcessor = load_symbol(
            "LLMProcessor",
            [
                "pipecat.processors.llm",
                "pipecat.processors",
            ],
        )
    except ImportError:
        return llm
    return init_with_supported_kwargs(LLMProcessor, llm=llm, service=llm)


def build_claude_service(config: ServiceConfig, system_prompt: str, tool_defs: list[dict]) -> Any:
    AnthropicService = load_any_symbol(
        [
            "AnthropicLLMService",
            "AnthropicChatService",
            "AnthropicService",
        ],
        [
            "pipecat.services.anthropic",
            "pipecat.services.anthropic_chat",
            "pipecat.services",
        ],
    )
    return init_with_supported_kwargs(
        AnthropicService,
        api_key=config.anthropic_api_key,
        model=config.anthropic_model,
        system_prompt=system_prompt,
        system=system_prompt,
        temperature=config.anthropic_temperature,
        max_tokens=config.anthropic_max_tokens,
        tools=tool_defs,
    )


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    config = load_config()

    LOG.info("Meeting voice agent starting.")
    LOG.info("PCC base URL: %s", config.pcc_base_url)
    LOG.info("Audio config: %s", config.audio)

    if not config.anthropic_api_key:
        LOG.info("Missing ANTHROPIC_API_KEY; Claude LLM not started.")
        return

    pcc = PccClient(config.pcc_base_url)
    try:
        system_prompt = await build_system_prompt(pcc)
        tool_defs = build_tool_definitions()
        tool_callbacks = build_tool_callbacks(pcc)

        try:
            llm_service = build_claude_service(config, system_prompt, tool_defs)
        except ImportError as exc:
            LOG.error("Pipecat Anthropic service not available: %s", exc)
            return
        attach_tools(llm_service, tool_defs, tool_callbacks)
        llm_processor = build_llm_processor(llm_service)

        LOG.info(
            "Claude LLM processor ready: %s",
            llm_processor.__class__.__name__,
        )
        LOG.info("Pipecat pipeline not configured yet; exiting cleanly.")
    finally:
        await pcc.close()


if __name__ == "__main__":
    asyncio.run(main())
