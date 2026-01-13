"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { KanbanBoard } from "./KanbanBoard";
import { TechTreeView } from "./TechTreeView";
import { ConstitutionPanel } from "./ConstitutionPanel";
import { VMPanel } from "./VMPanel";
import { SuccessPanel } from "./SuccessPanel";
import { CostPanel } from "./CostPanel";

type ViewMode = "kanban" | "tech-tree";

export default function ProjectPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const searchParams = useSearchParams();
  const viewParam = searchParams.get("view");
  const [view, setView] = useState<ViewMode>("kanban");

  useEffect(() => {
    if (viewParam === "tech-tree") {
      setView("tech-tree");
      return;
    }
    if (viewParam === "kanban") {
      setView("kanban");
    }
  }, [viewParam]);

  return (
    <>
      <main style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <section className="card" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Link href="/" className="badge">
            &larr; Portfolio
          </Link>
          <Link href={`/projects/${encodeURIComponent(id)}/chat`} className="badge">
            Chat
          </Link>
          <div className="muted" style={{ fontSize: 13 }}>
            {id}
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            <button
              className={view === "kanban" ? "btn" : "btnSecondary"}
              onClick={() => setView("kanban")}
              style={{ padding: "6px 12px" }}
            >
              Kanban
            </button>
            <button
              className={view === "tech-tree" ? "btn" : "btnSecondary"}
              onClick={() => setView("tech-tree")}
              style={{ padding: "6px 12px" }}
            >
              Tech Tree
            </button>
          </div>
        </section>

        <SuccessPanel repoId={id} />
        <CostPanel repoId={id} />
        <ConstitutionPanel repoId={id} />
        <VMPanel repoId={id} />
        <KanbanBoard repoId={id} />
      </main>

      {/* Tech Tree Modal */}
      {view === "tech-tree" && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "#0a0a14",
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <TechTreeView repoId={id} onClose={() => setView("kanban")} />
        </div>
      )}
    </>
  );
}
