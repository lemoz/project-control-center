"use client";

import { useNarration } from "./hooks/useNarration";

const STATE_LABELS: Record<string, string> = {
  idle: "Idle",
  speaking: "Speaking",
  cooldown: "Cooldown",
  muted: "Muted",
  disabled: "Disabled",
};

type NarrationPanelProps = {
  emptyStateText?: string;
};

export function NarrationPanel({ emptyStateText }: NarrationPanelProps) {
  const {
    activeCount,
    enabled,
    muted,
    promptDismissed,
    supported,
    state,
    transcript,
    setEnabled,
    setMuted,
    dismissPrompt,
  } = useNarration();

  const showPrompt = !enabled && !promptDismissed && supported;
  const activeLabel = activeCount === 1 ? "1 active run" : `${activeCount} active runs`;
  const stateLabel = STATE_LABELS[state] ?? "Idle";

  const emptyLabel = emptyStateText ?? "No narration yet.";

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontWeight: 600 }}>Ambient narration</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {supported ? activeLabel : "Narration audio unavailable in this browser."}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {enabled && (
            <button
              className="btnSecondary"
              onClick={() => setMuted((prev) => !prev)}
              aria-pressed={muted}
            >
              {muted ? "Unmute" : "Mute"}
            </button>
          )}
          <button
            className="btnSecondary"
            onClick={() => setEnabled((prev) => !prev)}
            disabled={!supported && !enabled}
          >
            {enabled ? "Disable" : "Enable"}
          </button>
          <span className="badge">{stateLabel}</span>
        </div>
      </div>

      {showPrompt && (
        <div
          className="notice"
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontWeight: 600 }}>Enable ambient narration?</div>
            <div className="muted" style={{ fontSize: 12 }}>
              Hear short voice updates about active runs.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={() => setEnabled(true)}>
              Enable narration
            </button>
            <button className="linkBtn" onClick={dismissPrompt}>
              Not now
            </button>
          </div>
        </div>
      )}

      <details>
        <summary className="muted" style={{ cursor: "pointer" }}>
          Narration transcript
        </summary>
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {transcript.length ? (
            <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {transcript.map((entry) => (
                <div key={entry.id} style={{ fontSize: 13 }}>
                  <span className="muted">{entry.time}</span>{" "}
                  <span>{entry.text}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              {emptyLabel}
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
