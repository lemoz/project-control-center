"use client";

import Link from "next/link";
import type { ObservabilityAlert } from "../types";

function AlertItem({ alert }: { alert: ObservabilityAlert }) {
  const className = alert.severity === "critical" ? "error" : "notice";
  const runHref = alert.run_id ? `/runs/${encodeURIComponent(alert.run_id)}` : null;
  const meta: string[] = [];
  if (alert.run_id) meta.push(`Run ${alert.run_id}`);
  if (alert.work_order_id) meta.push(`WO ${alert.work_order_id}`);
  if (alert.waiting_since) meta.push(`Waiting since ${alert.waiting_since}`);
  return (
    <div className={className} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <div>
        <div style={{ fontWeight: 700 }}>
          {runHref ? (
            <Link href={runHref} style={{ color: "inherit", textDecoration: "underline" }}>
              {alert.message}
            </Link>
          ) : (
            alert.message
          )}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {alert.type}
        </div>
        {meta.length > 0 && (
          <div className="muted" style={{ fontSize: 12 }}>
            {meta.join(" · ")}
          </div>
        )}
      </div>
      <span className="badge">{alert.severity}</span>
    </div>
  );
}

export function AlertsBanner({
  data,
  loading,
  error,
}: {
  data: ObservabilityAlert[];
  loading: boolean;
  error: string | null;
}) {
  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Alerts</div>
        <span className="badge">{data.length}</span>
      </div>

      {!!error && <div className="error">{error}</div>}
      {loading && <div className="muted">Checking alerts...</div>}

      {!loading && data.length === 0 && (
        <div className="muted" style={{ fontSize: 13 }}>
          (none)
        </div>
      )}

      {!loading && data.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.map((alert) => (
            <AlertItem key={alert.id} alert={alert} />
          ))}
        </div>
      )}
    </section>
  );
}
