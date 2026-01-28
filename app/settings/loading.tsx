export default function SettingsLoading() {
  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <section key={i} className="card" style={{ minHeight: 100 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ width: 140, height: 18, borderRadius: 6, background: "rgba(255,255,255,0.06)" }} />
            <div style={{ width: "80%", height: 12, borderRadius: 6, background: "rgba(255,255,255,0.04)" }} />
            <div style={{ width: "100%", height: 36, borderRadius: 10, background: "rgba(255,255,255,0.04)", marginTop: 4 }} />
          </div>
        </section>
      ))}
    </main>
  );
}
