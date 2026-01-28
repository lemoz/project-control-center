export default function PortfolioLoading() {
  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="skeleton" style={{ width: 80, height: 20, borderRadius: 6, background: "rgba(255,255,255,0.06)" }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div className="skeleton" style={{ width: 60, height: 16, borderRadius: 6, background: "rgba(255,255,255,0.06)" }} />
            <div className="skeleton" style={{ width: 90, height: 30, borderRadius: 10, background: "rgba(255,255,255,0.06)" }} />
          </div>
        </div>
      </section>

      <section className="grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card" style={{ minHeight: 120 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ width: "60%", height: 16, borderRadius: 6, background: "rgba(255,255,255,0.06)" }} />
              <div style={{ width: "90%", height: 12, borderRadius: 6, background: "rgba(255,255,255,0.04)" }} />
              <div style={{ width: "40%", height: 12, borderRadius: 6, background: "rgba(255,255,255,0.04)" }} />
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
              <div style={{ width: 60, height: 22, borderRadius: 999, background: "rgba(255,255,255,0.06)" }} />
              <div style={{ width: 50, height: 22, borderRadius: 999, background: "rgba(255,255,255,0.06)" }} />
              <div style={{ width: 48, height: 22, borderRadius: 999, background: "rgba(255,255,255,0.06)" }} />
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
