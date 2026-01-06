import Link from "next/link";
import { WorkOrderDetails } from "./WorkOrderDetails";

export default function WorkOrderPage({
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
          href={`/projects/${encodeURIComponent(id)}/work-orders/${encodeURIComponent(workOrderId)}?chat=1`}
          className="badge"
        >
          Chat
        </Link>
        <div className="muted" style={{ fontSize: 13 }}>
          {workOrderId}
        </div>
      </section>

      <WorkOrderDetails repoId={id} workOrderId={workOrderId} />
    </main>
  );
}
