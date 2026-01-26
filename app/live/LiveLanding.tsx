"use client";

import Link from "next/link";
import { useMemo } from "react";
import { NarrationPanel } from "../landing/NarrationPanel";
import { VoiceWidget } from "../landing/components/VoiceWidget/VoiceWidget";
import { useAgentFocusSync } from "../playground/canvas/useAgentFocus";
import { useProjectsVisualization } from "../playground/canvas/useProjectsVisualization";
import type { ProjectNode } from "../playground/canvas/types";
import { LiveOrbitalCanvas } from "./LiveOrbitalCanvas";
import { ShiftStatusBar } from "./ShiftStatusBar";
import styles from "./live.module.css";

function selectLandingProject(nodes: ProjectNode[]): ProjectNode | null {
  if (!nodes.length) return null;
  const byName = nodes.find((node) =>
    node.name.toLowerCase().includes("project control center")
  );
  if (byName) return byName;
  const byPath = nodes.find((node) =>
    node.path.toLowerCase().includes("project-control-center")
  );
  if (byPath) return byPath;
  const active = nodes.find((node) => node.isActive);
  return active ?? nodes[0] ?? null;
}

export function LiveLanding() {
  const { data, loading, error } = useProjectsVisualization();
  const project = useMemo(() => selectLandingProject(data.nodes), [data.nodes]);
  const focus = useAgentFocusSync(project?.id ?? null, {
    intervalMs: 5000,
    hiddenIntervalMs: 15000,
    debounceMs: 400,
  });
  const hasActiveShift = Boolean(
    focus?.kind === "work_order" && focus.source === "active_run" && focus.workOrderId
  );
  const emptyNarrationText =
    !loading && !hasActiveShift
      ? "No active work right now. Explore the project structure."
      : undefined;

  return (
    <main className={styles.page} data-live-landing>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link href="/" className={styles.headerTitle}>
            Project Control Center
          </Link>
          <span className="badge">Live</span>
        </div>
        <ShiftStatusBar focus={focus} project={project} loading={loading} />
        <div className={styles.headerActions}>
          <Link href="/" className="badge">
            Portfolio
          </Link>
        </div>
      </header>

      <section className={`card ${styles.canvasSection}`}>
        <LiveOrbitalCanvas data={data} loading={loading} error={error} project={project} focus={focus} />
        <aside className={styles.voiceDock}>
          <VoiceWidget />
        </aside>
      </section>

      <section className={styles.narrationSection}>
        <NarrationPanel emptyStateText={emptyNarrationText} />
      </section>
    </main>
  );
}
