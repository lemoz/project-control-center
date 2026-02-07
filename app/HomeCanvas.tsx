"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { GlobalOrbitalCanvas } from "./live/GlobalOrbitalCanvas";
import { GlobalSessionOverlay } from "./live/GlobalSessionOverlay";
import { ProjectDetailPanel } from "./live/ProjectDetailPanel";
import type { ProjectNode } from "./playground/canvas/types";
import type { GlobalAgentSession } from "./live/globalSessionTypes";

export function HomeCanvas() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [globalSession, setGlobalSession] = useState<GlobalAgentSession | null>(null);
  const selectedNodeRef = useRef<ProjectNode | null>(null);
  const handleSelectProject = useCallback((id: string | null, node?: ProjectNode | null) => {
    selectedNodeRef.current = node ?? null;
    setSelectedProjectId(id);
  }, []);

  return (
    <div className="home-canvas">
      <GlobalOrbitalCanvas
        onSelectProject={handleSelectProject}
        selectedProjectId={selectedProjectId}
        globalSession={globalSession}
      />

      {selectedProjectId && (
        <ProjectDetailPanel
          projectId={selectedProjectId}
          initialNode={selectedNodeRef.current}
          onClose={() => setSelectedProjectId(null)}
        />
      )}

      <div className="home-session-overlay">
        <GlobalSessionOverlay onSessionChange={setGlobalSession} />
      </div>

      <Link href="/portfolio" className="home-list-toggle btnSecondary">
        List view
      </Link>
    </div>
  );
}
