"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { GlobalOrbitalCanvas } from "./live/GlobalOrbitalCanvas";
import { VoiceWidget } from "./landing/components/VoiceWidget/VoiceWidget";

export function HomeCanvas() {
  const router = useRouter();

  return (
    <div className="home-canvas">
      <GlobalOrbitalCanvas
        onSelectProject={(id) => router.push(`/projects/${id}`)}
      />

      <div className="home-voice-dock">
        <VoiceWidget />
      </div>

      <Link href="/portfolio" className="home-list-toggle btnSecondary">
        List view
      </Link>
    </div>
  );
}
