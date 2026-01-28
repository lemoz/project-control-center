export default function ProjectLoading() {
  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section className="card" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ width: 80, height: 24, borderRadius: 999, background: "rgba(255,255,255,0.06)" }} />
        <div style={{ width: 50, height: 24, borderRadius: 999, background: "rgba(255,255,255,0.06)" }} />
        <div style={{ width: 50, height: 24, borderRadius: 999, background: "rgba(255,255,255,0.06)" }} />
        <div style={{ width: 120, height: 14, borderRadius: 6, background: "rgba(255,255,255,0.04)", marginLeft: 8 }} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <div style={{ width: 70, height: 32, borderRadius: 10, background: "rgba(255,255,255,0.06)" }} />
          <div style={{ width: 80, height: 32, borderRadius: 10, background: "rgba(255,255,255,0.06)" }} />
        </div>
      </section>

      {Array.from({ length: 3 }).map((_, i) => (
        <section key={i} className="card" style={{ minHeight: 90 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ width: 120, height: 16, borderRadius: 6, background: "rgba(255,255,255,0.06)" }} />
            <div style={{ width: "90%", height: 12, borderRadius: 6, background: "rgba(255,255,255,0.04)" }} />
            <div style={{ width: "60%", height: 12, borderRadius: 6, background: "rgba(255,255,255,0.04)" }} />
          </div>
        </section>
      ))}
    </main>
  );
}
