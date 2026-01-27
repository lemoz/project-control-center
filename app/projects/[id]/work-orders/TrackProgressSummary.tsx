"use client";

type TrackProgressItem = {
  id: string;
  name: string;
  color: string | null;
  total: number;
  done: number;
  ready: number;
  backlog: number;
};

type TrackProgressSummaryProps = {
  tracks: TrackProgressItem[];
};

const DEFAULT_TRACK_COLOR = "#475569";

export function TrackProgressSummary({ tracks }: TrackProgressSummaryProps) {
  if (!tracks.length) return null;

  return (
    <section className="card">
      <div style={{ fontWeight: 700 }}>Track Progress</div>
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 12 }}>
        {tracks.map((track) => {
          const trackColor = track.color ?? DEFAULT_TRACK_COLOR;
          const pct = track.total > 0 ? Math.round((track.done / track.total) * 100) : 0;
          return (
            <div key={track.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      backgroundColor: trackColor,
                      border: `1px solid ${trackColor}`,
                    }}
                  />
                  <span style={{ fontWeight: 600 }}>{track.name}</span>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {track.done} done / {track.ready} ready / {track.backlog} backlog
                </div>
              </div>
              <div
                style={{
                  height: 8,
                  borderRadius: 999,
                  background: "#1f2433",
                  border: "1px solid #22293a",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: "100%",
                    background: trackColor,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
