"use client";

import Link from "next/link";
import { useMemo } from "react";
import { NarrationPanel } from "../../../landing/NarrationPanel";
import { useAgentFocusSync } from "../../../playground/canvas/useAgentFocus";
import { useProjectsVisualization } from "../../../playground/canvas/useProjectsVisualization";
import type { ProjectNode } from "../../../playground/canvas/types";
import { AgentActivityPanel } from "../../../live/AgentActivityPanel";
import { CollapsibleVoiceWidget } from "../../../live/CollapsibleVoiceWidget";
import { LiveOrbitalCanvas } from "../../../live/LiveOrbitalCanvas";
import { ShiftStatusBar } from "../../../live/ShiftStatusBar";
import styles from "../../../live/live.module.css";

function selectProject(nodes: ProjectNode[], id: string): ProjectNode | null {
  return nodes.find((node) => node.id === id) ?? null;
}

export default function ProjectLivePage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { data, loading, error } = useProjectsVisualization();
  const project = useMemo(() => selectProject(data.nodes, id), [data.nodes, id]);
  const focus = useAgentFocusSync(project?.id ?? null, {
    intervalMs: 3000,
    hiddenIntervalMs: 15000,
    debounceMs: 400,
  });
  const hasActiveShift = Boolean(
    focus?.kind === "work_order" &&
      focus.workOrderId &&
      (focus.source === "active_run" || focus.source === "log")
  );
  const emptyNarrationText =
    !loading && !hasActiveShift
      ? "No active work right now. Explore the project structure."
      : undefined;

  return (
    <main className={styles.page} data-live-landing>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link href={`/projects/${encodeURIComponent(id)}`} className={styles.headerTitle}>
            {project?.name ?? id}
          </Link>
          <span className="badge">Live</span>
        </div>
        <ShiftStatusBar focus={focus} project={project} loading={loading} />
        <div className={styles.headerActions}>
          <Link href={`/projects/${encodeURIComponent(id)}`} className="badge">
            Dashboard
          </Link>
        </div>
      </header>

      {loading && !project ? (
        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontWeight: 600 }}>Loading project live view...</div>
          <div className="muted" style={{ fontSize: 13 }}>
            Fetching latest project context.
          </div>
        </section>
      ) : !project ? (
        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontWeight: 600 }}>Project not found</div>
          <div className="muted" style={{ fontSize: 13 }}>
            We could not load live data for {id}.
          </div>
        </section>
      ) : (
        <>
          <section className={`card ${styles.canvasSection}`}>
            <LiveOrbitalCanvas
              data={data}
              loading={loading}
              error={error}
              project={project}
              focus={focus}
            />
            <AgentActivityPanel
              project={project}
              focus={focus}
              workOrderNodes={data.workOrderNodes ?? []}
              loading={loading}
              variant="overlay"
              maxEntries={12}
            />
          </section>

          <CollapsibleVoiceWidget />

          <section className={styles.narrationSection}>
            <NarrationPanel emptyStateText={emptyNarrationText} />
          </section>
        </>
      )}
    </main>
  );
}
