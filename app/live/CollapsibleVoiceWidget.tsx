"use client";

import { useState, useRef, useEffect } from "react";
import { VoiceWidget } from "../landing/components/VoiceWidget/VoiceWidget";
import styles from "./live.module.css";

export function CollapsibleVoiceWidget() {
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!expanded) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setExpanded(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpanded(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [expanded]);

  return (
    <div ref={containerRef} className={styles.voiceFloating}>
      {expanded ? (
        <div className={styles.voiceExpanded}>
          <button
            className={styles.voiceCloseBtn}
            onClick={() => setExpanded(false)}
            aria-label="Close voice guide"
          >
            &times;
          </button>
          <VoiceWidget />
        </div>
      ) : (
        <button
          className={styles.voiceFab}
          onClick={() => setExpanded(true)}
          aria-label="Open voice guide"
          title="Voice guide"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
          <span>Voice</span>
        </button>
      )}
    </div>
  );
}
