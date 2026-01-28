"use client";

import { useState } from "react";
import { RunPhaseProgress, type RunPhase } from "./RunPhaseProgress";

type RunEstimateConfidence = "high" | "medium" | "low";

type RunEstimate = {
  estimated_iterations: number;
  estimated_minutes: number;
  confidence: RunEstimateConfidence;
  reasoning: string;
};

type RunEstimateDisplayProps = {
  initialEstimate: RunEstimate | null;
  currentEta: number | null;
  estimatedCompletion: string | null;
  confidence: RunEstimateConfidence | null;
  reasoning: string | null;
  phase: RunPhase | null;
  iteration: number | null;
  isActive: boolean;
};

const PHASE_LABELS: Record<RunPhase, string> = {
  setup: "Setup",
  builder: "Builder",
  test: "Test",
  reviewer: "Reviewer",
  merge: "Merge",
};

const CONFIDENCE_STYLES: Record<RunEstimateConfidence, { background: string; borderColor: string; color: string }> = {
  high: { background: "#143726", borderColor: "#1f5c3a", color: "#9fe3b6" },
  medium: { background: "#1b2d4f", borderColor: "#2b5cff", color: "#cfe0ff" },
  low: { background: "#3a1d25", borderColor: "#5a1f2a", color: "#ffb4c0" },
};

function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "pending";
  const rounded = Math.max(0, Math.round(value));
  return `~${rounded} min`;
}

function formatCompletionTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
  });
  return formatter.format(date);
}

function formatConfidence(confidence: RunEstimateConfidence | null): string {
  if (!confidence) return "Pending";
  return confidence.slice(0, 1).toUpperCase() + confidence.slice(1);
}

export function RunEstimateDisplay({
  initialEstimate,
  currentEta,
  estimatedCompletion,
  confidence,
  reasoning,
  phase,
  iteration,
  isActive,
}: RunEstimateDisplayProps) {
  const [showReasoning, setShowReasoning] = useState(false);
  const hasReasoning = Boolean(reasoning && reasoning.trim().length);
  const reasoningText = reasoning?.trim() ?? "";
  const completionLabel = formatCompletionTime(estimatedCompletion);
  const initialMinutesLabel = formatMinutes(initialEstimate?.estimated_minutes);
  const initialIterations = initialEstimate?.estimated_iterations ?? null;
  const hasCurrentEta = typeof currentEta === "number" && Number.isFinite(currentEta);
  const currentEtaLabel = hasCurrentEta ? formatMinutes(currentEta) : "pending";
  const currentEtaSuffix = hasCurrentEta ? " remaining" : "";
  const phaseLabel = phase ? PHASE_LABELS[phase] : "Pending";
  const iterationLabel =
    phase && (phase === "builder" || phase === "test" || phase === "reviewer") && iteration
      ? ` (iter ${iteration})`
      : "";
  const progressLabel = phase ? `${phaseLabel}${iterationLabel}` : "Awaiting start";
  const confidenceStyle = confidence ? CONFIDENCE_STYLES[confidence] : { background: "#1f2433", borderColor: "#2b3347", color: "#a9b0c2" };

  return (
    <section className="card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 14 }}>
          Estimated Time: {initialMinutesLabel}
          {typeof initialIterations === "number" ? ` / ${initialIterations} iter` : ""}
        </div>
        {hasReasoning && (
          <button
            type="button"
            onClick={() => setShowReasoning((prev) => !prev)}
            title={reasoningText}
            aria-expanded={showReasoning}
            style={{
              width: 24,
              height: 24,
              borderRadius: 999,
              border: "1px solid #2b3347",
              background: "transparent",
              color: "#a9b0c2",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ?
          </button>
        )}
      </div>

      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <RunPhaseProgress phase={phase} />
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {progressLabel}
        </div>
      </div>

      {(isActive || hasCurrentEta) && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            Current ETA: {currentEtaLabel}
            {currentEtaSuffix}
          </div>
          {completionLabel && (
            <div className="muted" style={{ fontSize: 12 }}>
              Completing around {completionLabel}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div className="muted" style={{ fontSize: 12 }}>
          Confidence:
        </div>
        <span className="badge" style={confidenceStyle}>
          {formatConfidence(confidence)}
        </span>
      </div>

      {hasReasoning && showReasoning && (
        <div className="muted" style={{ marginTop: 8, lineHeight: 1.4 }}>
          {reasoningText}
        </div>
      )}
    </section>
  );
}
