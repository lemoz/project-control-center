import Link from "next/link";
import { KanbanBoard } from "./KanbanBoard";

export default function ProjectPage({ params }: { params: { id: string } }) {
  const { id } = params;

  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section className="card" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Link href="/" className="badge">
          ← Portfolio
        </Link>
        <Link href={`/projects/${encodeURIComponent(id)}/chat`} className="badge">
          Chat
        </Link>
        <div className="muted" style={{ fontSize: 13 }}>
          {id}
        </div>
      </section>

      <KanbanBoard repoId={id} />
    </main>
  );
}
