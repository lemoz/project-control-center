"use client";

type TrackBadgeInfo = {
  id: string;
  name: string;
  color: string | null;
};

type TrackBadgeProps = {
  tracks: TrackBadgeInfo[];
  onSelect?: (trackId: string) => void;
};

const DEFAULT_TRACK_COLOR = "#475569";

function parseHexColor(value: string): { r: number; g: number; b: number } | null {
  const trimmed = value.trim();
  const hex = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return { r, g, b };
  }
  if (hex.length !== 6) return null;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return { r, g, b };
}

function withAlpha(color: string, alpha: number): string {
  const rgb = parseHexColor(color);
  if (!rgb) return color;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function darkenColor(color: string, amount: number): string {
  const rgb = parseHexColor(color);
  if (!rgb) return color;
  const factor = Math.max(0, Math.min(1, 1 - amount));
  const r = Math.round(rgb.r * factor);
  const g = Math.round(rgb.g * factor);
  const b = Math.round(rgb.b * factor);
  return `rgb(${r}, ${g}, ${b})`;
}

function isLightColor(color: string): boolean {
  const rgb = parseHexColor(color);
  if (!rgb) return false;
  const luminance =
    (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance > 0.7;
}

export function TrackBadge({ tracks, onSelect }: TrackBadgeProps) {
  if (!tracks.length) return null;

  return (
    <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {tracks.map((track) => {
        const baseColor = track.color ?? DEFAULT_TRACK_COLOR;
        const textColor = isLightColor(baseColor)
          ? darkenColor(baseColor, 0.45)
          : baseColor;

        if (onSelect) {
          return (
            <button
              key={track.id}
              type="button"
              className="badge"
              onClick={(event) => {
                event.stopPropagation();
                onSelect(track.id);
              }}
              style={{
                padding: "4px 10px",
                fontSize: 13,
                fontWeight: 600,
                borderColor: baseColor,
                backgroundColor: withAlpha(baseColor, 0.2),
                color: textColor,
                cursor: "pointer",
              }}
            >
              {track.name}
            </button>
          );
        }

        return (
          <span
            key={track.id}
            className="badge"
            style={{
              padding: "4px 10px",
              fontSize: 13,
              fontWeight: 600,
              borderColor: baseColor,
              backgroundColor: withAlpha(baseColor, 0.2),
              color: textColor,
            }}
          >
            {track.name}
          </span>
        );
      })}
    </span>
  );
}
