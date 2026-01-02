import Link from "next/link";
import { ChatThread } from "../../../../../components/ChatThread";

export default function WorkOrderChatPage({
  params,
}: {
  params: { id: string; workOrderId: string };
}) {
  const { id, workOrderId } = params;

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
        <Link
          href={`/projects/${encodeURIComponent(id)}/work-orders/${encodeURIComponent(workOrderId)}`}
          className="badge"
        >
          ← Work Order
        </Link>
        <div className="muted" style={{ fontSize: 13 }}>
          Work Order chat
        </div>
      </section>

      <ChatThread scope={{ scope: "work_order", projectId: id, workOrderId }} />
    </main>
  );
}

