export default function ChatLoading() {
  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section className="card" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 80, height: 24, borderRadius: 999, background: "rgba(255,255,255,0.06)" }} />
        <div style={{ width: 50, height: 14, borderRadius: 6, background: "rgba(255,255,255,0.04)" }} />
      </section>

      <section className="card" style={{ minHeight: 200 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ width: 140, height: 18, borderRadius: 6, background: "rgba(255,255,255,0.06)" }} />
          <div style={{ width: "100%", height: 40, borderRadius: 10, background: "rgba(255,255,255,0.04)" }} />
          <div style={{ width: "80%", height: 12, borderRadius: 6, background: "rgba(255,255,255,0.04)" }} />
          <div style={{ width: "60%", height: 12, borderRadius: 6, background: "rgba(255,255,255,0.04)" }} />
        </div>
      </section>
    </main>
  );
}
