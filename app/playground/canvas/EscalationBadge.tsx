import type { CSSProperties } from "react";

type EscalationBadgeProps = {
  count: number;
  label?: string;
  compact?: boolean;
};

const baseStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  background: "#341118",
  color: "#ffb3b8",
  border: "1px solid #6b1d26",
};

export function EscalationBadge({ count, label = "Needs human", compact }: EscalationBadgeProps) {
  if (count <= 0) return null;

  return (
    <span
      style={{
        ...baseStyle,
        padding: compact ? "2px 6px" : baseStyle.padding,
        fontSize: compact ? 11 : baseStyle.fontSize,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "#ff5c6a",
          boxShadow: "0 0 6px rgba(255, 92, 106, 0.9)",
        }}
      />
      {label}
      {count > 1 ? ` (${count})` : ""}
    </span>
  );
}
