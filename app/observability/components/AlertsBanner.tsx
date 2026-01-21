"use client";

import type { ObservabilityAlert } from "../types";

function AlertItem({ alert }: { alert: ObservabilityAlert }) {
  const className = alert.severity === "critical" ? "error" : "notice";
  return (
    <div className={className} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <div>
        <div style={{ fontWeight: 700 }}>{alert.message}</div>
        <div className="muted" style={{ fontSize: 12 }}>
          {alert.type}
        </div>
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
