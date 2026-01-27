import Link from "next/link";
import { TrackList } from "./TrackList";

export default function TracksPage({ params }: { params: { id: string } }) {
  const { id } = params;

  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section
        className="card"
        style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
      >
        <Link href="/" className="badge">
          &larr; Portfolio
        </Link>
        <Link href={`/projects/${encodeURIComponent(id)}`} className="badge">
          &larr; Project
        </Link>
        <div style={{ fontWeight: 700 }}>Tracks</div>
        <div className="muted" style={{ fontSize: 13 }}>
          {id}
        </div>
      </section>

      <TrackList projectId={id} />
    </main>
  );
}
