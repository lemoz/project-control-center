"use client";

import { useMemo, useRef } from "react";

export type TechTreeTrackOption = {
  id: string;
  name: string;
  color: string | null;
  count: number;
  isUnassigned: boolean;
};

type TechTreeFiltersProps = {
  tracks: TechTreeTrackOption[];
  selectedTrackIds: Set<string> | null;
  onToggleTrack: (trackId: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
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

export function TechTreeFilters({
  tracks,
  selectedTrackIds,
  onToggleTrack,
  onSelectAll,
  onClear,
}: TechTreeFiltersProps) {
  const menuRef = useRef<HTMLDetailsElement | null>(null);

  const activeTrackIds = useMemo(() => {
    return selectedTrackIds ?? new Set(tracks.map((track) => track.id));
  }, [selectedTrackIds, tracks]);

  const selectedTracks = useMemo(() => {
    return tracks.filter((track) => activeTrackIds.has(track.id));
  }, [activeTrackIds, tracks]);

  const selectionLabel = useMemo(() => {
    if (!tracks.length) return "No tracks";
    if (activeTrackIds.size === 0) return "No tracks";
    if (activeTrackIds.size === tracks.length) return "All tracks";
    if (activeTrackIds.size === 1) return selectedTracks[0]?.name ?? "1 track";
    return `${activeTrackIds.size} tracks`;
  }, [activeTrackIds.size, selectedTracks, tracks.length]);

  const selectionColor = useMemo(() => {
    if (activeTrackIds.size === 1) return selectedTracks[0]?.color ?? DEFAULT_DOT_COLOR;
    return DEFAULT_DOT_COLOR;
  }, [activeTrackIds.size, selectedTracks]);

  const selectionCount = useMemo(() => {
    return selectedTracks.reduce((sum, track) => sum + track.count, 0);
  }, [selectedTracks]);

  const closeMenu = () => {
    menuRef.current?.removeAttribute("open");
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span className="muted" style={{ fontSize: 12 }}>
        Track
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
            minWidth: 190,
          }}
        >
          <TrackDot color={selectionColor} />
          <span>{selectionLabel}</span>
          <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>
            {selectionCount}
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
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            zIndex: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="muted" style={{ fontSize: 11 }}>
              Track filter
            </div>
            <button type="button" className="btnSecondary" onClick={closeMenu} style={{ padding: "4px 8px" }}>
              Close
            </button>
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className="btnSecondary" onClick={onSelectAll} style={{ padding: "4px 8px" }}>
              Select all
            </button>
            <button type="button" className="btnSecondary" onClick={onClear} style={{ padding: "4px 8px" }}>
              Clear
            </button>
          </div>

          <div style={{ height: 1, background: "#22293a" }} />

          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflow: "auto" }}>
            {tracks.map((track) => (
              <label
                key={track.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  color: "#e5e7eb",
                }}
              >
                <input
                  type="checkbox"
                  checked={activeTrackIds.has(track.id)}
                  onChange={() => onToggleTrack(track.id)}
                />
                <TrackDot color={track.color} />
                <span style={{ flex: 1 }}>{track.name}</span>
                <span className="muted" style={{ fontSize: 11 }}>
                  {track.count}
                </span>
              </label>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}
