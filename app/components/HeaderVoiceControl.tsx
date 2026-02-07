"use client";

import { useEffect, useRef, useState } from "react";
import { VoiceWidget } from "../landing/components/VoiceWidget/VoiceWidget";
import {
  useCanvasVoiceState,
  type CanvasVoiceRuntime,
} from "../landing/components/VoiceWidget/voiceClientTools";

type HeaderVoiceState =
  | "idle"
  | "connecting"
  | "listening"
  | "acting"
  | "speaking"
  | "error";

function deriveHeaderVoiceState(
  runtime: CanvasVoiceRuntime
): HeaderVoiceState {
  if (runtime.error || runtime.permissionDenied || runtime.toolPhase === "failed") {
    return "error";
  }
  if (runtime.isConnecting || runtime.status === "connecting") return "connecting";
  if (runtime.status === "connected" && runtime.toolPhase === "acting") return "acting";
  if (runtime.status === "connected" && runtime.isSpeaking) return "speaking";
  if (runtime.status === "connected") return "listening";
  return "idle";
}

function labelForState(state: HeaderVoiceState): string {
  if (state === "connecting") return "Connecting";
  if (state === "acting") return "Acting";
  if (state === "speaking") return "Speaking";
  if (state === "listening") return "Listening";
  if (state === "error") return "Error";
  return "Idle";
}

export function HeaderVoiceControl() {
  const [open, setOpen] = useState(false);
  const [hasMountedWidget, setHasMountedWidget] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasState = useCanvasVoiceState();
  const voiceState = deriveHeaderVoiceState(canvasState.runtime);
  const voiceLabel = labelForState(voiceState);
  const activeToolLabel =
    voiceState === "acting" && canvasState.runtime.activeToolName
      ? ` (${canvasState.runtime.activeToolName})`
      : "";
  const titleLabel = `Voice guide (${voiceLabel}${activeToolLabel})`;

  useEffect(() => {
    if (!open) return;
    setHasMountedWidget(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (containerRef.current && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div
      ref={containerRef}
      className={"nav-voice" + (open ? " nav-voice--open" : "")}
    >
      <button
        type="button"
        className={
          "nav-voice-trigger" +
          (open ? " nav-voice-trigger--open" : "") +
          ` nav-voice-trigger--${voiceState}`
        }
        onClick={() => setOpen((prev) => !prev)}
        aria-label={
          open
            ? `Close voice guide (${voiceLabel.toLowerCase()})`
            : `Open voice guide (${voiceLabel.toLowerCase()})`
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="nav-voice-panel"
        title={titleLabel}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
        <span className="nav-voice-label">Voice</span>
        <span className={"nav-voice-status nav-voice-status--" + voiceState}>
          {voiceLabel}
        </span>
      </button>

      {hasMountedWidget && (
        <div
          id="nav-voice-panel"
          className={"nav-voice-panel" + (open ? " nav-voice-panel--open" : "")}
          aria-hidden={!open}
        >
          <VoiceWidget />
        </div>
      )}
    </div>
  );
}
