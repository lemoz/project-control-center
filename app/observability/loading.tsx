export default function ObservabilityLoading() {
  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section className="card" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ width: 160, height: 22, borderRadius: 6, background: "rgba(255,255,255,0.06)" }} />
          <div style={{ width: 200, height: 12, borderRadius: 6, background: "rgba(255,255,255,0.04)", marginTop: 8 }} />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ width: 100, height: 22, borderRadius: 999, background: "rgba(255,255,255,0.06)" }} />
          <div style={{ width: 90, height: 32, borderRadius: 10, background: "rgba(255,255,255,0.06)" }} />
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card" style={{ minHeight: 110 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ width: 100, height: 16, borderRadius: 6, background: "rgba(255,255,255,0.06)" }} />
              <div style={{ width: "70%", height: 28, borderRadius: 6, background: "rgba(255,255,255,0.04)" }} />
              <div style={{ width: "50%", height: 12, borderRadius: 6, background: "rgba(255,255,255,0.04)" }} />
            </div>
          </div>
        ))}
      </section>

      <div className="card" style={{ minHeight: 140 }}>
        <div style={{ width: 120, height: 16, borderRadius: 6, background: "rgba(255,255,255,0.06)" }} />
        <div style={{ width: "100%", height: 80, borderRadius: 10, background: "rgba(255,255,255,0.03)", marginTop: 10 }} />
      </div>
    </main>
  );
}
