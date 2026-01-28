"use client";

export function VMHealthPanel() {
  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>VM Health</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Metrics moved to PCC Cloud.
          </div>
        </div>
        <span className="badge">Cloud</span>
      </div>

      <div className="notice">
        View VM health, disk, and container stats from the PCC Cloud observability console.
      </div>
    </section>
  );
}
