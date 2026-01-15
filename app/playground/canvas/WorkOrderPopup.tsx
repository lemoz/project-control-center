import Link from "next/link";
import type { WorkOrderNode } from "./types";

function formatStatus(value: string): string {
  return value.replace(/_/g, " ");
}

function formatTimestamp(value: Date | null): string {
  if (!value) return "No recent activity";
  return value.toLocaleString();
}

export function WorkOrderPopup({ node }: { node: WorkOrderNode }) {
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
            href={`/projects/${encodeURIComponent(node.projectId)}/work-orders/${encodeURIComponent(
              node.workOrderId
            )}`}
            style={{
              color: "#f5f7ff",
              fontWeight: 700,
              textDecoration: "none",
              fontSize: 16,
            }}
          >
            {node.workOrderId}
          </Link>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {node.title}
          </div>
        </div>
        <div
          style={{
            padding: "2px 8px",
            borderRadius: 999,
            fontSize: 11,
            border: "1px solid #2b3347",
            background: "#141824",
            height: "fit-content",
          }}
        >
          {formatStatus(node.status)}
        </div>
      </div>

      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        <div className="muted" style={{ fontSize: 12 }}>
          Project:{" "}
          <Link
            href={`/projects/${encodeURIComponent(node.projectId)}`}
            style={{ color: "#cbd5f5", textDecoration: "none" }}
          >
            {node.projectName}
          </Link>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          Priority: P{node.priority} | Era: {node.era ?? "Unassigned"}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          Last activity: {formatTimestamp(node.lastActivity)}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <Link
          href={`/projects/${encodeURIComponent(node.projectId)}/work-orders/${encodeURIComponent(
            node.workOrderId
          )}`}
          className="badge"
        >
          Open work order
        </Link>
        <Link href={`/projects/${encodeURIComponent(node.projectId)}`} className="badge">
          Open project
        </Link>
      </div>
    </aside>
  );
}
