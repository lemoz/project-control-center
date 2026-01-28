"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { SpeakingIndicator } from "./SpeakingIndicator";
import { useVoiceAgent, type TranscriptEntry } from "./useVoiceAgent";
import { VoiceButton } from "./VoiceButton";
import { useCanvasVoiceState, type CanvasVoiceState, type CanvasVoiceNode } from "./voiceClientTools";

const MAX_CONTEXT_ITEMS = 8;
const CONTEXT_THROTTLE_MS = 600;

function formatNodeLabel(node: CanvasVoiceNode): string {
  if (node.type === "work_order" && node.title) {
    return `${node.label} (${node.title})`;
  }
  return node.label;
}

function formatNodeList(label: string, nodes: CanvasVoiceNode[]): string {
  if (!nodes.length) return `${label}: none.`;
  const listed = nodes.slice(0, MAX_CONTEXT_ITEMS).map(formatNodeLabel).join(", ");
  const overflow =
    nodes.length > MAX_CONTEXT_ITEMS
      ? ` (+${nodes.length - MAX_CONTEXT_ITEMS} more)`
      : "";
  return `${label}: ${listed}${overflow}.`;
}

function buildCanvasSummary(state: CanvasVoiceState): string {
  const contextLabel = state.contextLabel ?? "Canvas";
  const focusLabel = state.focusedNode ? formatNodeLabel(state.focusedNode) : "none";
  const selectedLabel = state.selectedNode ? formatNodeLabel(state.selectedNode) : "none";
  const detailPanel = state.detailPanelOpen ? "open" : "closed";
  const visibleProjects = formatNodeList("Visible projects", state.visibleProjects);
  const visibleWorkOrders = formatNodeList("Visible work orders", state.visibleWorkOrders);

  return (
    `${contextLabel} context update. Focused: ${focusLabel}. ` +
    `Selected: ${selectedLabel}. ` +
    `Detail panel: ${detailPanel}. ` +
    `${visibleProjects} ${visibleWorkOrders}`
  );
}

function statusLabel(
  status: string,
  isConnecting: boolean,
  isSpeaking: boolean,
  error: string | null
): string {
  if (error) return "Error";
  if (isConnecting) return "Connecting";
  if (status === "disconnecting") return "Stopping";
  if (status === "connected" && isSpeaking) return "Speaking";
  if (status === "connected") return "Listening";
  return "Idle";
}

function transcriptLabel(entry: TranscriptEntry): string {
  return entry.role === "agent" ? "Agent" : "You";
}

type VoiceStatusResponse = {
  available: boolean;
  reason?: string;
};

export function VoiceWidget() {
  const {
    status,
    isSpeaking,
    isConnecting,
    transcript,
    error,
    permissionDenied,
    start,
    stop,
    sendTextMessage,
    sendContextualUpdate,
  } = useVoiceAgent();
  const canvasState = useCanvasVoiceState();
  const [textOnly, setTextOnly] = useState(false);
  const [textInput, setTextInput] = useState("");
  const lastContextRef = useRef<string>("");
  const contextTimerRef = useRef<number | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatusResponse | null>(null);
  const [voiceStatusLoading, setVoiceStatusLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/voice/status", { cache: "no-store" });
        const json = (await res.json()) as VoiceStatusResponse;
        if (!cancelled) setVoiceStatus(json);
      } catch {
        if (!cancelled) setVoiceStatus({ available: false, reason: "server_unreachable" });
      } finally {
        if (!cancelled) setVoiceStatusLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const isConnected = status === "connected";
  const isBusy = isConnecting || status === "disconnecting";
  const buttonState = error
    ? "error"
    : isConnecting
      ? "connecting"
      : isConnected && isSpeaking
        ? "speaking"
        : isConnected
          ? "listening"
          : "idle";

  useEffect(() => {
    if (permissionDenied) {
      setTextOnly(true);
    }
  }, [permissionDenied]);

  useEffect(() => {
    if (status === "connected") return;
    lastContextRef.current = "";
    if (contextTimerRef.current) {
      window.clearTimeout(contextTimerRef.current);
      contextTimerRef.current = null;
    }
  }, [status]);

  useEffect(() => {
    if (status !== "connected") return;
    const summary = buildCanvasSummary(canvasState);
    if (summary === lastContextRef.current) return;

    if (contextTimerRef.current) {
      window.clearTimeout(contextTimerRef.current);
    }
    contextTimerRef.current = window.setTimeout(() => {
      if (status === "connected") {
        sendContextualUpdate(summary);
        lastContextRef.current = summary;
      }
    }, CONTEXT_THROTTLE_MS);

    return () => {
      if (contextTimerRef.current) {
        window.clearTimeout(contextTimerRef.current);
      }
    };
  }, [canvasState, sendContextualUpdate, status]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (isConnected || isConnecting)) {
        stop();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isConnected, isConnecting, stop]);

  const handleToggle = async () => {
    if (isConnected || isConnecting) {
      await stop();
    } else {
      await start({ textOnly });
    }
  };

  const handleSendText = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = textInput.trim();
    if (!trimmed) return;
    const sent = await sendTextMessage(trimmed, { textOnly: true });
    if (sent) setTextInput("");
  };

  const statusText = useMemo(
    () => statusLabel(status, isConnecting, isSpeaking, error),
    [status, isConnecting, isSpeaking, error]
  );

  if (!voiceStatusLoading && !voiceStatus?.available) {
    return (
      <section className="card voice-widget">
        <div className="voice-widget-header">
          <div style={{ fontWeight: 600 }}>Voice guide</div>
        </div>
        <div className="notice">
          Voice requires an ElevenLabs API key. Configure in Settings or upgrade to PCC Cloud.
        </div>
      </section>
    );
  }

  return (
    <section className="card voice-widget">
      <div className="voice-widget-header">
        <div>
          <div style={{ fontWeight: 600 }}>Voice guide</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Ask about projects, work orders, or the canvas.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <VoiceButton
            state={buttonState}
            label={isConnected ? "Stop voice session" : "Start voice session"}
            onClick={handleToggle}
            disabled={isBusy}
          />
          <span className="badge">{statusText}</span>
        </div>
      </div>

      <div
        aria-live="polite"
        className="muted"
        style={{ fontSize: 12, display: "flex", gap: 8, alignItems: "center" }}
      >
        <span>Status: {statusText}</span>
        <SpeakingIndicator active={isConnected && isSpeaking} />
      </div>

      {error && <div className="error">{error}</div>}

      {permissionDenied && (
        <div className="notice">
          Microphone access denied. Use text-only mode to continue.
        </div>
      )}

      <div className="voice-widget-controls">
        <button
          className="btnSecondary"
          onClick={() => setTextOnly((prev) => !prev)}
          disabled={isConnected || isConnecting}
          aria-pressed={textOnly}
        >
          {textOnly ? "Voice mode" : "Text-only mode"}
        </button>
        <div className="muted" style={{ fontSize: 12 }}>
          {textOnly
            ? "Text-only mode will open a chat-style session."
            : "Voice mode uses your microphone."}
        </div>
      </div>

      {textOnly && (
        <form onSubmit={handleSendText} className="voice-widget-text">
          <input
            className="input"
            value={textInput}
            onChange={(event) => setTextInput(event.target.value)}
            placeholder="Type a question for the voice agent"
          />
          <button className="btn" type="submit" disabled={!textInput.trim()}>
            Send
          </button>
        </form>
      )}

      <details>
        <summary className="muted" style={{ cursor: "pointer" }}>
          Transcript
        </summary>
        <div className="voice-transcript" aria-live="polite">
          {transcript.length ? (
            transcript.map((entry) => (
              <div key={entry.id} className="voice-transcript-line">
                <span className="muted">{entry.timestamp}</span>{" "}
                <span style={{ fontWeight: 600 }}>{transcriptLabel(entry)}:</span>{" "}
                <span>{entry.text}</span>
              </div>
            ))
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              No transcript yet.
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
