"use client";

import { useMemo } from "react";
import type { ActiveRun } from "../types";
import { useLogTail } from "../hooks/useLogTail";

type RunOption = {
  id: string;
  label: string;
};

function buildRunOptions(runs: ActiveRun[]): RunOption[] {
  return runs.map((run) => ({
    id: run.id,
    label: `${run.work_order_id} (${run.status})`,
  }));
}

export function LiveLogs({
  runs,
  selectedRunId,
  onSelectRun,
}: {
  runs: ActiveRun[];
  selectedRunId: string | null;
  onSelectRun: (runId: string | null) => void;
}) {
  const options = useMemo(() => buildRunOptions(runs), [runs]);
  const { data, loading, error } = useLogTail(selectedRunId, 60);
  const lines = data?.lines ?? [];
  const logText = selectedRunId
    ? lines.length
      ? lines.join("\n")
      : "(no logs yet)"
    : "(select a run)";

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Live Logs</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Tail active run output in near real time.
          </div>
        </div>
        <select
          className="select"
          value={selectedRunId ?? ""}
          onChange={(event) => onSelectRun(event.target.value || null)}
          disabled={!options.length}
          style={{ minWidth: 220 }}
        >
          {!options.length && <option value="">No active runs</option>}
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {!!error && <div className="error">{error}</div>}
      {loading && <div className="muted">Loading logs...</div>}

      <pre
        style={{
          margin: 0,
          whiteSpace: "pre-wrap",
          fontSize: 12,
          lineHeight: 1.35,
          maxHeight: 220,
          overflow: "auto",
          background: "#0b0d12",
          borderRadius: 10,
          border: "1px solid #2b3347",
          padding: 10,
        }}
      >
        {logText}
      </pre>
      {data?.has_more && (
        <div className="muted" style={{ fontSize: 12 }}>
          Showing latest lines only.
        </div>
      )}
    </section>
  );
}
