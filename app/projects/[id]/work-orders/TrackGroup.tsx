"use client";

import type { ReactNode } from "react";

type TrackGroupProps = {
  title: string;
  color: string | null;
  totalCount: number;
  doneCount: number;
  children: ReactNode;
  defaultOpen?: boolean;
};

const DEFAULT_TRACK_COLOR = "#475569";

export function TrackGroup({
  title,
  color,
  totalCount,
  doneCount,
  children,
  defaultOpen = true,
}: TrackGroupProps) {
  const trackColor = color ?? DEFAULT_TRACK_COLOR;
  return (
    <details className="card" open={defaultOpen}>
      <summary
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            aria-hidden="true"
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              backgroundColor: trackColor,
              border: `1px solid ${trackColor}`,
            }}
          />
          <div style={{ fontWeight: 700 }}>{title}</div>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {totalCount} WOs ({doneCount} done)
        </div>
      </summary>
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
        {children}
      </div>
    </details>
  );
}
