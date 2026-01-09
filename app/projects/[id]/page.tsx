"use client";

import { useState } from "react";
import Link from "next/link";
import { KanbanBoard } from "./KanbanBoard";
import { TechTreeView } from "./TechTreeView";
import { ConstitutionPanel } from "./ConstitutionPanel";
import { VMPanel } from "./VMPanel";
import { SuccessPanel } from "./SuccessPanel";

type ViewMode = "kanban" | "tech-tree";

export default function ProjectPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [view, setView] = useState<ViewMode>("kanban");

  return (
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
      <ConstitutionPanel repoId={id} />
      <VMPanel repoId={id} />

      {view === "kanban" && <KanbanBoard repoId={id} />}
      {view === "tech-tree" && <TechTreeView repoId={id} />}
    </main>
  );
}
