"use client";

export function VMPanel({ repoId }: { repoId: string }) {
  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>VM Isolation</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            VM provisioning has moved to PCC Cloud.
          </div>
        </div>
        <span className="badge">Cloud</span>
      </div>

      <div className="notice">
        VM-based execution now lives in the PCC Cloud app (Fly.io-backed).
      </div>

      <div className="field">
        <div className="fieldLabel muted">Next step</div>
        <div>
          Open the PCC Cloud app to provision and manage VMs for {repoId}.
        </div>
      </div>
    </section>
  );
}
