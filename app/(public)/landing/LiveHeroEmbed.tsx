"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AgentActivityPanel } from "../../live/AgentActivityPanel";
import { LiveOrbitalCanvas } from "../../live/LiveOrbitalCanvas";
import { useAgentFocusSync } from "../../playground/canvas/useAgentFocus";
import { useProjectsVisualization } from "../../playground/canvas/useProjectsVisualization";
import type { ProjectNode } from "../../playground/canvas/types";
import styles from "./landing.module.css";

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

export function LiveHeroEmbed() {
  const { data, loading, error } = useProjectsVisualization();
  const project = useMemo(() => selectLandingProject(data.nodes), [data.nodes]);
  const focus = useAgentFocusSync(project?.id ?? null, {
    intervalMs: 3000,
    hiddenIntervalMs: 15000,
    debounceMs: 400,
  });
  const projectLabel = project ? `Tracking ${project.name}` : "Awaiting local project data";
  const footerStatus = error
    ? "Live feed unavailable"
    : loading
      ? "Loading feed..."
      : "Syncing now";

  return (
    <div className={`card ${styles.liveDemoCard}`}>
      <div className={styles.liveDemoHeader}>
        <div className={styles.liveBadgeRow}>
          <span className={`badge ${styles.liveBadge}`}>Live</span>
          <span className={styles.liveBadgeText}>{projectLabel}</span>
        </div>
        <Link href="/live" className={`btnSecondary ${styles.liveCta}`}>
          Full-screen /live
        </Link>
      </div>
      <div className={styles.liveDemoStage}>
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
          maxEntries={6}
        />
      </div>
      <div className={styles.liveDemoFooter}>
        <span>Live telemetry updates every few seconds.</span>
        <span className={styles.liveFooterStatus}>{footerStatus}</span>
      </div>
    </div>
  );
}
