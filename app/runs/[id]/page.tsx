import Link from "next/link";
import { RunDetails } from "./RunDetails";

export default function RunPage({ params }: { params: { id: string } }) {
  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section className="card" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Link href="/" className="badge">
          ← Portfolio
        </Link>
        <div className="muted" style={{ fontSize: 13 }}>
          Run details
        </div>
      </section>

      <RunDetails runId={params.id} />
    </main>
  );
}

