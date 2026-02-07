"use client";

import { useEffect, useRef, useState } from "react";
import { VoiceWidget } from "../landing/components/VoiceWidget/VoiceWidget";

export function HeaderVoiceControl() {
  const [open, setOpen] = useState(false);
  const [hasMountedWidget, setHasMountedWidget] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

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
        className={"nav-voice-trigger" + (open ? " nav-voice-trigger--open" : "")}
        onClick={() => setOpen((prev) => !prev)}
        aria-label={open ? "Close voice guide" : "Open voice guide"}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="nav-voice-panel"
        title="Voice guide"
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
