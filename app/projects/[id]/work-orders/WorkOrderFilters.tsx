"use client";

import { useMemo, useRef } from "react";

export type TrackFilterValue = string | "none" | null;

type TrackOption = {
  id: string;
  name: string;
  color: string | null;
  count: number;
};

type WorkOrderFiltersProps = {
  tracks: TrackOption[];
  selectedTrackId: TrackFilterValue;
  noTrackCount: number;
  groupByTrack: boolean;
  onTrackChange: (value: TrackFilterValue) => void;
  onGroupChange: (value: boolean) => void;
};

const DEFAULT_DOT_COLOR = "#475569";

function TrackDot({ color }: { color: string | null }) {
  const dotColor = color ?? DEFAULT_DOT_COLOR;
  return (
    <span
      aria-hidden="true"
      style={{
        width: 10,
        height: 10,
        borderRadius: 999,
        backgroundColor: dotColor,
        border: `1px solid ${dotColor}`,
        display: "inline-block",
      }}
    />
  );
}

export function WorkOrderFilters({
  tracks,
  selectedTrackId,
  noTrackCount,
  groupByTrack,
  onTrackChange,
  onGroupChange,
}: WorkOrderFiltersProps) {
  const menuRef = useRef<HTMLDetailsElement | null>(null);

  const totalCount = useMemo(() => {
    return tracks.reduce((sum, track) => sum + track.count, 0) + noTrackCount;
  }, [tracks, noTrackCount]);

  const selectedTrack = useMemo(() => {
    if (selectedTrackId === null) {
      return { label: "All Tracks", color: DEFAULT_DOT_COLOR, count: totalCount };
    }
    if (selectedTrackId === "none") {
      return { label: "No Track", color: DEFAULT_DOT_COLOR, count: noTrackCount };
    }
    const match = tracks.find((track) => track.id === selectedTrackId);
    if (match) {
      return { label: match.name, color: match.color ?? DEFAULT_DOT_COLOR, count: match.count };
    }
    return { label: "Unknown Track", color: DEFAULT_DOT_COLOR, count: 0 };
  }, [selectedTrackId, tracks, noTrackCount, totalCount]);

  const closeMenu = () => {
    menuRef.current?.removeAttribute("open");
  };

  const handleSelect = (value: TrackFilterValue) => {
    onTrackChange(value);
    closeMenu();
  };

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          Filter by Track
        </span>
        <details ref={menuRef} style={{ position: "relative", display: "inline-block" }}>
          <summary
            className="select"
            style={{
              cursor: "pointer",
              listStyle: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              minWidth: 200,
            }}
          >
            <TrackDot color={selectedTrack.color} />
            <span>{selectedTrack.label}</span>
            <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>
              {selectedTrack.count}
            </span>
          </summary>
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              marginTop: 6,
              minWidth: 240,
              background: "#0f1320",
              border: "1px solid #2b3347",
              borderRadius: 12,
              padding: 8,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              zIndex: 20,
            }}
          >
            <button
              type="button"
              onClick={() => handleSelect(null)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                justifyContent: "space-between",
                background: "transparent",
                border: "none",
                color: "inherit",
                padding: "6px 8px",
                borderRadius: 8,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <TrackDot color={DEFAULT_DOT_COLOR} />
                <span>All Tracks</span>
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {totalCount}
              </span>
            </button>

            <div style={{ height: 1, background: "#22293a", margin: "4px 0" }} />

            {tracks.map((track) => (
              <button
                key={track.id}
                type="button"
                onClick={() => handleSelect(track.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  justifyContent: "space-between",
                  background: "transparent",
                  border: "none",
                  color: "inherit",
                  padding: "6px 8px",
                  borderRadius: 8,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <TrackDot color={track.color} />
                  <span>{track.name}</span>
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {track.count}
                </span>
              </button>
            ))}

            <div style={{ height: 1, background: "#22293a", margin: "4px 0" }} />

            <button
              type="button"
              onClick={() => handleSelect("none")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                justifyContent: "space-between",
                background: "transparent",
                border: "none",
                color: "inherit",
                padding: "6px 8px",
                borderRadius: 8,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <TrackDot color={DEFAULT_DOT_COLOR} />
                <span>No Track</span>
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {noTrackCount}
              </span>
            </button>
          </div>
        </details>
      </div>

      <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
        <button
          type="button"
          className={groupByTrack ? "btnSecondary" : "btn"}
          onClick={() => onGroupChange(false)}
        >
          List
        </button>
        <button
          type="button"
          className={groupByTrack ? "btn" : "btnSecondary"}
          onClick={() => onGroupChange(true)}
        >
          Group by Track
        </button>
      </div>
    </div>
  );
}
