import Link from "next/link";
import { ChatThread } from "../../../components/ChatThread";

export default function ProjectChatPage({ params }: { params: { id: string } }) {
  const { id } = params;

  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section
        className="card"
        style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
      >
        <Link href="/" className="badge">
          ← Portfolio
        </Link>
        <Link href={`/projects/${encodeURIComponent(id)}`} className="badge">
          ← Project
        </Link>
        <div className="muted" style={{ fontSize: 13 }}>
          Project chat
        </div>
      </section>

      <ChatThread scope={{ scope: "project", projectId: id }} />
    </main>
  );
}

