import Link from "next/link";
import type { ProjectNode } from "./types";
import { EscalationBadge } from "./EscalationBadge";

function formatTimestamp(value: Date | null): string {
  if (!value) return "No recent activity";
  return value.toLocaleString();
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toLocaleString();
}

export function ProjectPopup({ node }: { node: ProjectNode }) {
  const successPercent = Math.round(node.successProgress * 100);

  return (
    <aside
      style={{
        position: "absolute",
        right: 16,
        top: 16,
        width: 320,
        background: "rgba(10, 12, 18, 0.96)",
        border: "1px solid #1d2233",
        borderRadius: 14,
        padding: 14,
        boxShadow: "0 16px 32px rgba(0, 0, 0, 0.45)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div>
          <Link
            href={`/projects/${encodeURIComponent(node.id)}`}
            style={{
              color: "#f5f7ff",
              fontWeight: 700,
              textDecoration: "none",
              fontSize: 16,
            }}
          >
            {node.name}
          </Link>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Status: {node.status}
          </div>
        </div>
        <EscalationBadge count={node.escalationCount} compact />
      </div>

      {node.escalationSummary && (
        <div
          style={{
            marginTop: 10,
            padding: 8,
            borderRadius: 10,
            background: "rgba(52, 17, 24, 0.5)",
            border: "1px solid #4b1620",
            fontSize: 12,
            color: "#ffb3b8",
          }}
        >
          {node.escalationSummary}
        </div>
      )}

      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        <div className="muted" style={{ fontSize: 12 }}>
          Last activity: {formatTimestamp(node.lastActivity)}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          Tokens today: {formatTokens(node.consumptionRate)}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>Work orders</div>
        <div
          className="muted"
          style={{
            fontSize: 12,
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 6,
            marginTop: 6,
          }}
        >
          <div>Ready: {node.workOrders.ready}</div>
          <div>Building: {node.workOrders.building}</div>
          <div>Blocked: {node.workOrders.blocked}</div>
          <div>Done: {node.workOrders.done}</div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>Success progress</div>
        <div style={{ marginTop: 6 }}>
          <div className="progressTrack">
            <div className="progressFill" style={{ width: `${successPercent}%` }} />
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {formatPercent(node.successProgress)} toward success metrics
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <Link href={`/projects/${encodeURIComponent(node.id)}`} className="badge">
          Open project
        </Link>
        <Link href={`/projects/${encodeURIComponent(node.id)}?view=tech-tree`} className="badge">
          Tech tree
        </Link>
      </div>
    </aside>
  );
}
