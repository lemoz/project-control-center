"use client";

import { useState } from "react";
import Link from "next/link";
import { GlobalOrbitalCanvas } from "./live/GlobalOrbitalCanvas";
import { GlobalSessionOverlay } from "./live/GlobalSessionOverlay";
import { CollapsibleVoiceWidget } from "./live/CollapsibleVoiceWidget";
import { ProjectDetailPanel } from "./live/ProjectDetailPanel";
import type { GlobalAgentSession } from "./live/globalSessionTypes";

export function HomeCanvas() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [globalSession, setGlobalSession] = useState<GlobalAgentSession | null>(null);

  return (
    <div className="home-canvas">
      <GlobalOrbitalCanvas
        onSelectProject={(id) => setSelectedProjectId(id)}
        selectedProjectId={selectedProjectId}
        globalSession={globalSession}
      />

      {selectedProjectId && (
        <ProjectDetailPanel
          projectId={selectedProjectId}
          onClose={() => setSelectedProjectId(null)}
        />
      )}

      <div className="home-session-overlay">
        <GlobalSessionOverlay onSessionChange={setGlobalSession} />
      </div>

      <CollapsibleVoiceWidget />

      <Link href="/portfolio" className="home-list-toggle btnSecondary">
        List view
      </Link>
    </div>
  );
}
