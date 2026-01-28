import { Fragment } from "react";

export type RunPhase = "setup" | "builder" | "test" | "reviewer" | "merge";

type PhaseState = "complete" | "current" | "pending";

const PHASES: Array<{ key: RunPhase; label: string }> = [
  { key: "setup", label: "Setup" },
  { key: "builder", label: "Builder" },
  { key: "test", label: "Test" },
  { key: "reviewer", label: "Reviewer" },
  { key: "merge", label: "Merge" },
];

type RunPhaseProgressProps = {
  phase: RunPhase | null;
};

function getPhaseState(index: number, currentIndex: number): PhaseState {
  if (currentIndex < 0) return "pending";
  if (index < currentIndex) return "complete";
  if (index === currentIndex) return "current";
  return "pending";
}

export function RunPhaseProgress({ phase }: RunPhaseProgressProps) {
  const currentIndex = phase ? PHASES.findIndex((entry) => entry.key === phase) : -1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {PHASES.map((entry, index) => {
          const state = getPhaseState(index, currentIndex);
          const lineState = index < currentIndex ? "complete" : "pending";
          const circleStyle =
            state === "pending"
              ? { borderColor: "#2b3347", background: "transparent", boxShadow: "none" }
              : state === "current"
              ? { borderColor: "#2b5cff", background: "#2b5cff", boxShadow: "0 0 0 3px rgba(43, 92, 255, 0.2)" }
              : { borderColor: "#2b5cff", background: "#2b5cff", boxShadow: "none" };
          const lineStyle =
            lineState === "complete"
              ? { background: "#2b5cff" }
              : { background: "#2b3347" };

          return (
            <Fragment key={entry.key}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  border: "1px solid",
                  ...circleStyle,
                }}
              />
              {index < PHASES.length - 1 && (
                <span
                  style={{
                    flex: 1,
                    height: 2,
                    borderRadius: 999,
                    ...lineStyle,
                  }}
                />
              )}
            </Fragment>
          );
        })}
      </div>
      <div
        className="muted"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${PHASES.length}, minmax(0, 1fr))`,
          fontSize: 11,
          textAlign: "center",
          letterSpacing: 0.3,
        }}
      >
        {PHASES.map((entry) => (
          <div key={entry.key}>{entry.label}</div>
        ))}
      </div>
    </div>
  );
}
