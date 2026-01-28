"use client";

export type TechTreeLegendItem = {
  id: string;
  name: string;
  color: string | null;
  count: number;
  isUnassigned: boolean;
};

type TechTreeLegendProps = {
  tracks: TechTreeLegendItem[];
  selectedTrackIds: Set<string> | null;
  onToggleTrack?: (trackId: string) => void;
};

const DEFAULT_DOT_COLOR = "#475569";

export function TechTreeLegend({ tracks, selectedTrackIds, onToggleTrack }: TechTreeLegendProps) {
  if (!tracks.length) return null;

  const isActive = (trackId: string) => {
    return selectedTrackIds ? selectedTrackIds.has(trackId) : true;
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <span className="muted" style={{ fontSize: 12 }}>
        Tracks
      </span>
      {tracks.map((track) => {
        const active = isActive(track.id);
        const dotColor = track.color ?? DEFAULT_DOT_COLOR;
        const Component = onToggleTrack ? "button" : "div";
        const componentProps = onToggleTrack
          ? {
              type: "button" as const,
              onClick: () => onToggleTrack(track.id),
              "aria-pressed": active,
            }
          : {};
        return (
          <Component
            key={track.id}
            {...componentProps}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "2px 8px",
              borderRadius: 999,
              border: "1px solid #2b3347",
              background: "transparent",
              color: "#e5e7eb",
              fontSize: 11,
              cursor: onToggleTrack ? "pointer" : "default",
              opacity: active ? 1 : 0.4,
            }}
            title={`${track.name} (${track.count})`}
          >
            <span
              aria-hidden="true"
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                backgroundColor: dotColor,
                border: `1px solid ${dotColor}`,
                display: "inline-block",
              }}
            />
            <span>{track.name}</span>
          </Component>
        );
      })}
    </div>
  );
}
