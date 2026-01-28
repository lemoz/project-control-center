import { HomeCanvas } from "./HomeCanvas";
import { LandingVoiceContextBridge } from "./landing/components/VoiceWidget/LandingVoiceContextBridge";

type RepoSummary = {
  id: string;
  name: string;
  description: string | null;
  path: string;
  type: "prototype" | "long_term";
  stage: string;
  status: "active" | "blocked" | "parked";
  lifecycle_status?: "active" | "stable" | "maintenance" | "archived";
  priority: number;
  starred: boolean;
  hidden: boolean;
  tags: string[];
  next_work_orders?: Array<{
    id: string;
    title: string;
    status: "ready" | "building";
    priority: number;
  }>;
};

async function getRepos(): Promise<RepoSummary[]> {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4010";
  try {
    const res = await fetch(`${baseUrl}/repos`, { cache: "no-store" });
    if (!res.ok) return [];
    return (await res.json()) as RepoSummary[];
  } catch {
    return [];
  }
}

export default async function Page() {
  const repos = await getRepos();
  const visibleRepos = repos.filter((r) => !r.hidden);
  const voiceContextProjects = visibleRepos.map((repo) => ({
    id: repo.id,
    name: repo.name,
    nextWorkOrders: repo.next_work_orders?.map((wo) => ({
      id: wo.id,
      title: wo.title,
    })),
  }));

  return (
    <>
      <LandingVoiceContextBridge projects={voiceContextProjects} />
      <HomeCanvas />
    </>
  );
}
