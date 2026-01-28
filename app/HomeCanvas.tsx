"use client";

import { useState } from "react";
import Link from "next/link";
import { GlobalOrbitalCanvas } from "./live/GlobalOrbitalCanvas";
import { GlobalSessionOverlay } from "./live/GlobalSessionOverlay";
import { VoiceWidget } from "./landing/components/VoiceWidget/VoiceWidget";
import { ProjectDetailPanel } from "./live/ProjectDetailPanel";

export function HomeCanvas() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  return (
    <div className="home-canvas">
      <GlobalOrbitalCanvas
        onSelectProject={(id) => setSelectedProjectId(id)}
        selectedProjectId={selectedProjectId}
      />

      {selectedProjectId && (
        <ProjectDetailPanel
          projectId={selectedProjectId}
          onClose={() => setSelectedProjectId(null)}
        />
      )}

      <div className="home-session-overlay">
        <GlobalSessionOverlay />
      </div>

      <div className="home-voice-dock">
        <VoiceWidget />
      </div>

      <Link href="/portfolio" className="home-list-toggle btnSecondary">
        List view
      </Link>
    </div>
  );
}
