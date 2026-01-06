import Link from "next/link";
import { Suspense } from "react";
import { ChatOverlayLauncher } from "../components/ChatOverlayLauncher";

export default function GlobalChatPage() {
  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section className="card" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Link href="/" className="badge">
          ← Portfolio
        </Link>
        <div className="muted" style={{ fontSize: 13 }}>Global</div>
      </section>

      <Suspense fallback={null}>
        <ChatOverlayLauncher scope={{ scope: "global" }} />
      </Suspense>
    </main>
  );
}
