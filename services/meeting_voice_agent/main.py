import asyncio
import inspect
import logging
import os
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
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
    voice_agent_host: str
    voice_agent_port: int
    audio: AudioConfig
    meeting_project_id: Optional[str]
    meeting_id: Optional[str]
    meeting_title: Optional[str]
    meeting_started_at: Optional[str]
    meeting_attendee_emails: list[str]


@dataclass(frozen=True)
class MeetingDefaults:
    project_id: Optional[str]
    meeting_id: Optional[str]
    meeting_title: Optional[str]
    meeting_started_at: Optional[str]


class MeetingSummaryTracker:
    def __init__(
        self,
        defaults: MeetingDefaults,
        *,
        max_notes: int = 5,
        max_action_items: int = 5,
    ) -> None:
        self._project_id = defaults.project_id
        self._meeting_id = defaults.meeting_id
        self._meeting_title = defaults.meeting_title
        self._meeting_started_at = defaults.meeting_started_at
        self._notes: list[str] = []
        self._action_items: list[str] = []
        self._summary_sent = False
        self._summary_blocked = False
        self._max_notes = max_notes
        self._max_action_items = max_action_items

    @property
    def summary_sent(self) -> bool:
        return self._summary_sent

    def update_from_params(self, params: Mapping[str, object] | None) -> None:
        if not params:
            return
        self._assign_once(
            "project_id",
            _coerce_str(_get_param(params, "project_id", "project")),
        )
        self._assign_once(
            "meeting_id",
            _coerce_str(_get_param(params, "meeting_id", "meeting")),
        )
        self._assign_once(
            "meeting_title",
            _coerce_str(_get_param(params, "meeting_title", "meeting_name", "title")),
        )
        self._assign_once(
            "meeting_started_at",
            _coerce_str(_get_param(params, "meeting_started_at", "meeting_start")),
        )

    def record_tool_result(
        self,
        name: str,
        params: Mapping[str, object] | None,
        result: object,
    ) -> None:
        if _result_is_error(result):
            return
        if name == "save_meeting_notes":
            note = _coerce_str(_get_param(params, "note", "text"))
            if note:
                self._add_note(note)
        elif name == "create_action_item":
            title = _coerce_str(_get_param(params, "title", "summary"))
            if title:
                self._add_action_item(title)
        elif name == "send_meeting_summary":
            self._summary_sent = True

    def build_summary_params(self, *, ended_at: str) -> dict[str, object] | None:
        if not self._meeting_id or not self._project_id:
            if not self._summary_blocked:
                LOG.warning(
                    "Meeting summary skipped: missing meeting_id or project_id."
                )
                self._summary_blocked = True
            return None

        summary_text = self._build_summary_text()
        params: dict[str, object] = {
            "project_id": self._project_id,
            "meeting_id": self._meeting_id,
            "summary": summary_text,
            "meeting_ended_at": ended_at,
            "to_scope": "project",
            "to_project_id": self._project_id,
        }
        if self._meeting_title:
            params["meeting_title"] = self._meeting_title
        if self._meeting_started_at:
            params["meeting_started_at"] = self._meeting_started_at
        if self._action_items:
            params["action_items"] = list(self._action_items)
        return params

    def _assign_once(self, field_name: str, value: Optional[str]) -> None:
        if not value:
            return
        current = getattr(self, f"_{field_name}")
        if current is None:
            setattr(self, f"_{field_name}", value)
            return
        if current != value:
            LOG.warning(
                "Meeting summary tracker saw multiple %s values: %s vs %s",
                field_name,
                current,
                value,
            )

    def _add_note(self, note: str) -> None:
        if len(self._notes) >= self._max_notes:
            return
        self._notes.append(_truncate_text(note, 140))

    def _add_action_item(self, title: str) -> None:
        if len(self._action_items) >= self._max_action_items:
            return
        self._action_items.append(_truncate_text(title, 140))

    def _build_summary_text(self) -> str:
        if not self._notes and not self._action_items:
            return "No notes or action items were captured during the meeting."

        lines: list[str] = []
        if self._notes:
            lines.append("Notes captured:")
            lines.extend([f"- {note}" for note in self._notes])
        if not self._notes and self._action_items:
            lines.append("No notes were captured; see action items for follow-ups.")
        return "\n".join(lines)


class MeetingSummaryDispatcher:
    def __init__(
        self,
        tracker: MeetingSummaryTracker,
        send_summary: Callable[[Mapping[str, object] | None], Awaitable[object]],
    ) -> None:
        self._tracker = tracker
        self._send_summary = send_summary
        self._lock = asyncio.Lock()

    async def send_if_needed(self, reason: str) -> None:
        async with self._lock:
            if self._tracker.summary_sent:
                return
            params = self._tracker.build_summary_params(ended_at=_iso_now())
            if params is None:
                return
            result = await self._send_summary(params)
            if not _result_is_error(result):
                LOG.info("Meeting summary sent (%s).", reason)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _coerce_str(value: object) -> Optional[str]:
    if isinstance(value, str):
        trimmed = value.strip()
        return trimmed if trimmed else None
    return None


def _get_param(params: Mapping[str, object] | None, *keys: str) -> object | None:
    if not params:
        return None
    for key in keys:
        if key in params:
            return params.get(key)
    return None


def _merge_tool_params(
    params: Mapping[str, object] | None, kwargs: Mapping[str, object]
) -> Mapping[str, object] | None:
    if params is None:
        return dict(kwargs) if kwargs else None
    if not kwargs:
        return params
    merged = dict(params)
    merged.update(kwargs)
    return merged


def _truncate_text(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    clipped = text[: max(0, limit - 3)].rstrip()
    return f"{clipped}..."


def _result_is_error(result: object) -> bool:
    if isinstance(result, Mapping):
        error = result.get("error")
        return isinstance(error, str) and bool(error.strip())
    return False


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


def parse_list_env(name: str) -> list[str]:
    raw = env(name)
    if raw is None:
        return []
    parts = [item.strip() for item in raw.replace(";", ",").split(",")]
    return [item for item in parts if item]


def load_attendee_emails() -> list[str]:
    primary = parse_list_env("MEETING_ATTENDEE_EMAILS")
    if primary:
        return primary
    return parse_list_env("MEETING_ATTENDEES")


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
        voice_agent_host=env("VOICE_AGENT_HOST", "0.0.0.0") or "0.0.0.0",
        voice_agent_port=parse_int_env("VOICE_AGENT_PORT", 8765),
        audio=load_audio_config(),
        meeting_project_id=env("MEETING_PROJECT_ID"),
        meeting_id=env("MEETING_ID"),
        meeting_title=env("MEETING_TITLE"),
        meeting_started_at=env("MEETING_STARTED_AT"),
        meeting_attendee_emails=load_attendee_emails(),
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


def build_elevenlabs_stt_service(config: ServiceConfig) -> Any:
    ElevenLabsSTTService = load_any_symbol(
        [
            "ElevenLabsSTTService",
            "ElevenLabsSTT",
            "ElevenLabsSpeechToTextService",
        ],
        [
            "pipecat.services.elevenlabs",
            "pipecat.services.elevenlabs_stt",
            "pipecat.services",
        ],
    )
    return init_with_supported_kwargs(
        ElevenLabsSTTService,
        api_key=config.elevenlabs_api_key,
        xi_api_key=config.elevenlabs_api_key,
        model_id=config.elevenlabs_stt_model_id,
        model=config.elevenlabs_stt_model_id,
        sample_rate=config.audio.sample_rate,
        sample_rate_hz=config.audio.sample_rate,
        channels=config.audio.channels,
        num_channels=config.audio.channels,
        sample_width=config.audio.sample_width,
        sample_width_bytes=config.audio.sample_width,
        frame_duration_ms=config.audio.frame_duration_ms,
        frame_ms=config.audio.frame_duration_ms,
        audio_format=config.audio.audio_format,
        format=config.audio.audio_format,
    )


def build_elevenlabs_tts_service(config: ServiceConfig) -> Any:
    ElevenLabsTTSService = load_any_symbol(
        [
            "ElevenLabsTTSService",
            "ElevenLabsTTS",
            "ElevenLabsTextToSpeechService",
        ],
        [
            "pipecat.services.elevenlabs",
            "pipecat.services.elevenlabs_tts",
            "pipecat.services",
        ],
    )
    return init_with_supported_kwargs(
        ElevenLabsTTSService,
        api_key=config.elevenlabs_api_key,
        xi_api_key=config.elevenlabs_api_key,
        voice_id=config.elevenlabs_voice_id,
        voice=config.elevenlabs_voice_id,
        model_id=config.elevenlabs_tts_model_id,
        model=config.elevenlabs_tts_model_id,
        output_format=config.elevenlabs_tts_format,
        format=config.elevenlabs_tts_format,
        sample_rate=config.audio.sample_rate,
        sample_rate_hz=config.audio.sample_rate,
        channels=config.audio.channels,
        num_channels=config.audio.channels,
        sample_width=config.audio.sample_width,
        sample_width_bytes=config.audio.sample_width,
        audio_format=config.audio.audio_format,
    )


def build_stt_processor(stt: Any) -> Any:
    try:
        STTProcessor = load_any_symbol(
            [
                "STTProcessor",
                "SpeechToTextProcessor",
            ],
            [
                "pipecat.processors.stt",
                "pipecat.processors.speech",
                "pipecat.processors",
            ],
        )
    except ImportError:
        return stt
    return init_with_supported_kwargs(STTProcessor, stt=stt, service=stt)


def build_tts_processor(tts: Any) -> Any:
    try:
        TTSProcessor = load_any_symbol(
            [
                "TTSProcessor",
                "TextToSpeechProcessor",
            ],
            [
                "pipecat.processors.tts",
                "pipecat.processors.speech",
                "pipecat.processors",
            ],
        )
    except ImportError:
        return tts
    return init_with_supported_kwargs(TTSProcessor, tts=tts, service=tts)


def build_transport_params(audio: AudioConfig) -> Optional[Any]:
    try:
        TransportParams = load_any_symbol(
            [
                "AudioParams",
                "AudioTransportParams",
                "TransportParams",
            ],
            [
                "pipecat.transports.base",
                "pipecat.transports.transport",
                "pipecat.transports",
            ],
        )
    except ImportError:
        return None
    return init_with_supported_kwargs(
        TransportParams,
        sample_rate=audio.sample_rate,
        sample_rate_hz=audio.sample_rate,
        channels=audio.channels,
        num_channels=audio.channels,
        sample_width=audio.sample_width,
        sample_width_bytes=audio.sample_width,
        frame_duration_ms=audio.frame_duration_ms,
        frame_ms=audio.frame_duration_ms,
        audio_format=audio.audio_format,
        format=audio.audio_format,
    )


def log_ws_connected(*_args, **_kwargs) -> None:
    LOG.info("WebSocket client connected.")


def log_ws_disconnected(*_args, **_kwargs) -> None:
    LOG.info("WebSocket client disconnected.")


def build_websocket_audio_transport(
    config: ServiceConfig,
    params: Optional[Any],
    *,
    on_disconnect: Optional[Callable[[], None]] = None,
) -> Optional[Any]:
    try:
        WebSocketTransport = load_any_symbol(
            [
                "WebSocketServerTransport",
                "WebsocketServerTransport",
                "WebSocketTransport",
                "WebsocketTransport",
            ],
            [
                "pipecat.transports.websocket",
                "pipecat.transports.websocket_server",
                "pipecat.transports.websocket_transport",
                "pipecat.transports.websockets",
                "pipecat.transports",
            ],
        )
    except ImportError:
        return None

    def handle_disconnect(*_args: object, **_kwargs: object) -> None:
        log_ws_disconnected()
        if on_disconnect:
            on_disconnect()

    kwargs = {
        "host": config.voice_agent_host,
        "port": config.voice_agent_port,
        "params": params,
        "audio_params": params,
        "sample_rate": config.audio.sample_rate,
        "sample_rate_hz": config.audio.sample_rate,
        "channels": config.audio.channels,
        "num_channels": config.audio.channels,
        "sample_width": config.audio.sample_width,
        "sample_width_bytes": config.audio.sample_width,
        "frame_duration_ms": config.audio.frame_duration_ms,
        "frame_ms": config.audio.frame_duration_ms,
        "audio_format": config.audio.audio_format,
        "format": config.audio.audio_format,
        "on_connect": log_ws_connected,
        "on_disconnect": handle_disconnect,
        "on_client_connected": log_ws_connected,
        "on_client_disconnected": handle_disconnect,
        "on_connection_open": log_ws_connected,
        "on_connection_closed": handle_disconnect,
    }
    try:
        return WebSocketTransport(**kwargs)
    except TypeError:
        return init_with_supported_kwargs(WebSocketTransport, **kwargs)


def build_local_audio_transport(
    config: ServiceConfig, params: Optional[Any]
) -> Optional[Any]:
    try:
        LocalAudioTransport = load_any_symbol(
            [
                "LocalAudioTransport",
                "LocalTransport",
                "LocalAudioIOTransport",
                "MicrophoneAudioTransport",
            ],
            [
                "pipecat.transports.local",
                "pipecat.transports.local_audio",
                "pipecat.transports",
            ],
        )
    except ImportError:
        return None
    return init_with_supported_kwargs(
        LocalAudioTransport,
        params=params,
        audio_params=params,
        sample_rate=config.audio.sample_rate,
        sample_rate_hz=config.audio.sample_rate,
        channels=config.audio.channels,
        num_channels=config.audio.channels,
        sample_width=config.audio.sample_width,
        sample_width_bytes=config.audio.sample_width,
        frame_duration_ms=config.audio.frame_duration_ms,
        frame_ms=config.audio.frame_duration_ms,
        audio_format=config.audio.audio_format,
        format=config.audio.audio_format,
    )


def get_transport_processors(transport: Any) -> tuple[Optional[Any], Optional[Any]]:
    input_processor = None
    output_processor = None

    input_attr = getattr(transport, "input", None)
    if callable(input_attr):
        input_processor = input_attr()
    elif input_attr is not None:
        input_processor = input_attr
    elif hasattr(transport, "input_processor"):
        input_processor = getattr(transport, "input_processor")

    output_attr = getattr(transport, "output", None)
    if callable(output_attr):
        output_processor = output_attr()
    elif output_attr is not None:
        output_processor = output_attr
    elif hasattr(transport, "output_processor"):
        output_processor = getattr(transport, "output_processor")

    return input_processor, output_processor


def build_pipeline(processors: list[Any]) -> Any:
    Pipeline = load_any_symbol(
        ["Pipeline"],
        [
            "pipecat.pipeline.pipeline",
            "pipecat.pipeline",
        ],
    )
    try:
        return Pipeline(processors)
    except TypeError:
        return init_with_supported_kwargs(
            Pipeline,
            processors=processors,
            pipeline=processors,
            stages=processors,
        )


def build_pipeline_task(
    pipeline: Any, transport: Any, params: Optional[Any]
) -> Any:
    PipelineTask = load_any_symbol(
        ["PipelineTask"],
        [
            "pipecat.pipeline.task",
            "pipecat.pipeline",
        ],
    )
    kwargs = {
        "transport": transport,
        "params": params,
        "audio_params": params,
    }
    filtered = {key: value for key, value in kwargs.items() if value is not None}
    try:
        return PipelineTask(pipeline, **filtered)
    except TypeError:
        return init_with_supported_kwargs(
            PipelineTask,
            pipeline=pipeline,
            **kwargs,
        )


async def run_pipeline_task(task: Any) -> None:
    PipelineRunner = load_any_symbol(
        ["PipelineRunner", "PipelineExecutor"],
        [
            "pipecat.pipeline.runner",
            "pipecat.pipeline",
        ],
    )
    runner = init_with_supported_kwargs(PipelineRunner)
    if hasattr(runner, "run"):
        result = runner.run(task)
    elif hasattr(runner, "run_task"):
        result = runner.run_task(task)
    else:
        raise RuntimeError("Pipecat pipeline runner missing run method.")
    if inspect.isawaitable(result):
        await result


async def run_pipeline(
    config: ServiceConfig,
    llm_processor: Any,
    tool_callbacks: dict[str, Callable[..., Awaitable[object]]],
    tracker: MeetingSummaryTracker,
) -> None:
    if not config.elevenlabs_api_key:
        LOG.info("Missing CONTROL_CENTER_ELEVENLABS_API_KEY; ElevenLabs pipeline not started.")
        return
    if not config.elevenlabs_voice_id:
        LOG.info("Missing ELEVENLABS_VOICE_ID; ElevenLabs TTS not started.")
        return

    try:
        stt_service = build_elevenlabs_stt_service(config)
        tts_service = build_elevenlabs_tts_service(config)
    except ImportError as exc:
        LOG.error("Pipecat ElevenLabs services not available: %s", exc)
        return

    stt_processor = build_stt_processor(stt_service)
    tts_processor = build_tts_processor(tts_service)
    transport_params = build_transport_params(config.audio)
    summary_sender = tool_callbacks.get("send_meeting_summary")
    dispatcher = (
        MeetingSummaryDispatcher(tracker, summary_sender)
        if summary_sender is not None
        else None
    )
    loop = asyncio.get_running_loop()

    def schedule_summary(reason: str) -> None:
        if dispatcher is None:
            return
        loop.call_soon_threadsafe(
            lambda: asyncio.create_task(dispatcher.send_if_needed(reason))
        )

    transport = build_websocket_audio_transport(
        config,
        transport_params,
        on_disconnect=lambda: schedule_summary("disconnect"),
    )
    transport_label = "websocket"
    if transport is None:
        transport = build_local_audio_transport(config, transport_params)
        transport_label = "local audio"
    if transport is None:
        LOG.error("Pipecat audio transport not available; cannot start pipeline.")
        return
    if transport_label == "websocket":
        LOG.info(
            "WebSocket audio server listening on %s:%s",
            config.voice_agent_host,
            config.voice_agent_port,
        )

    input_processor, output_processor = get_transport_processors(transport)
    processors = []
    if input_processor is not None:
        processors.append(input_processor)
    processors.extend([stt_processor, llm_processor, tts_processor])
    if output_processor is not None:
        processors.append(output_processor)

    if input_processor is None:
        LOG.warning("Transport input processor missing; audio input may not flow.")
    if output_processor is None:
        LOG.warning("Transport output processor missing; audio output may not play.")

    try:
        pipeline = build_pipeline(processors)
        task = build_pipeline_task(pipeline, transport, transport_params)
        LOG.info(
            "Pipecat pipeline ready: %s",
            [processor.__class__.__name__ for processor in processors],
        )
        await run_pipeline_task(task)
    except ImportError as exc:
        LOG.error("Pipecat pipeline modules not available: %s", exc)
    finally:
        if dispatcher is not None:
            await dispatcher.send_if_needed("pipeline_end")


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    config = load_config()

    LOG.info("Meeting voice agent starting.")
    LOG.info("PCC base URL: %s", config.pcc_base_url)
    LOG.info(
        "Voice agent WebSocket: %s:%s",
        config.voice_agent_host,
        config.voice_agent_port,
    )
    LOG.info("Audio config: %s", config.audio)
    if config.meeting_id or config.meeting_project_id:
        LOG.info(
            "Meeting context: project=%s meeting=%s",
            config.meeting_project_id,
            config.meeting_id,
        )

    if not config.anthropic_api_key:
        LOG.info("Missing ANTHROPIC_API_KEY; Claude LLM not started.")
        return

    pcc = PccClient(config.pcc_base_url)
    try:
        system_prompt = await build_system_prompt(
            pcc,
            attendee_emails=config.meeting_attendee_emails,
            project_id=config.meeting_project_id,
        )
        tool_defs = build_tool_definitions()
        tool_callbacks = build_tool_callbacks(
            pcc, default_attendees=config.meeting_attendee_emails
        )
        tracker = MeetingSummaryTracker(
            MeetingDefaults(
                project_id=config.meeting_project_id,
                meeting_id=config.meeting_id,
                meeting_title=config.meeting_title,
                meeting_started_at=config.meeting_started_at,
            )
        )

        def instrument_tool_callback(
            name: str, callback: Callable[..., Awaitable[object]]
        ) -> Callable[..., Awaitable[object]]:
            async def _wrapped(
                params: Mapping[str, object] | None = None, **kwargs: object
            ) -> object:
                merged = _merge_tool_params(params, kwargs)
                tracker.update_from_params(merged)
                result = await callback(merged)
                tracker.record_tool_result(name, merged, result)
                return result

            return _wrapped

        tool_callbacks = {
            name: instrument_tool_callback(name, callback)
            for name, callback in tool_callbacks.items()
        }

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
        await run_pipeline(config, llm_processor, tool_callbacks, tracker)
    finally:
        await pcc.close()


if __name__ == "__main__":
    asyncio.run(main())
