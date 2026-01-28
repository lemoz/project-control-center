export default function HomeLoading() {
  return (
    <div
      style={{
        width: "100vw",
        marginLeft: "calc(-50vw + 50%)",
        marginTop: -16,
        height: "calc(100vh - 49px)",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0b0d12",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <div className="spinner" style={{ width: 24, height: 24 }} />
        <div className="muted" style={{ fontSize: 13 }}>Loading canvas...</div>
      </div>
    </div>
  );
}
