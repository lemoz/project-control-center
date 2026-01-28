import { StarToggle } from "../components/StarToggle";
import Link from "next/link";
import path from "path";

type RepoSummary = {
  id: string;
  name: string;
  description: string | null;
  path: string;
  type: "prototype" | "long_term";
  stage: string;
  status: "active" | "blocked" | "parked";
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

export default async function PortfolioPage() {
  const repos = await getRepos();
  const visibleRepos = repos.filter((r) => !r.hidden);
  const hiddenRepos = repos.filter((r) => r.hidden);
  const nameCounts = repos.reduce((acc, repo) => {
    acc.set(repo.name, (acc.get(repo.name) || 0) + 1);
    return acc;
  }, new Map<string, number>());

  const displayName = (repo: RepoSummary) => {
    const count = nameCounts.get(repo.name) || 0;
    if (count > 1) return `${repo.name} (${path.basename(repo.path)})`;
    return repo.name;
  };

  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Portfolio</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 13 }}>
              {repos.length ? `${repos.length} repos` : "server offline or empty"}
            </span>
            <Link href="/" className="btnSecondary" style={{ fontSize: 12, padding: "4px 10px" }}>
              Canvas view
            </Link>
          </div>
        </div>
      </section>

      <section className="grid">
        {visibleRepos.map((repo) => (
          <div key={repo.id} className="card cardLink">
            <Link
              href={`/projects/${repo.id}`}
              prefetch={false}
              className="stretchedLink"
              aria-label={`Open ${displayName(repo)}`}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ minWidth: 0, overflow: "hidden" }}>
                <div style={{ fontWeight: 600 }}>{displayName(repo)}</div>
                <div className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}>{repo.path}</div>
                {repo.description && <div className="desc">{repo.description}</div>}
              </div>
              <div style={{ zIndex: 2, position: "relative", flexShrink: 0, pointerEvents: "auto" }}>
                <StarToggle repoId={repo.id} initialStarred={repo.starred} />
              </div>
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span className="badge">{repo.type}</span>
              <span className="badge">{repo.stage}</span>
              <span className="badge">{repo.status}</span>
              <span className="badge">p{repo.priority}</span>
            </div>

            {!!repo.next_work_orders?.length && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                <div className="muted" style={{ fontSize: 12 }}>Next</div>
                {repo.next_work_orders.map((wo) => (
                  <div key={wo.id} className="nextItem">
                    <span className="muted">{wo.id}</span>{" "}
                    <span style={{ fontWeight: 600 }}>{wo.title}</span>{" "}
                    <span className="badge">{wo.status}</span>
                  </div>
                ))}
              </div>
            )}
            {!!repo.tags?.length && (
              <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {repo.tags.map((t) => (
                  <span key={t} className="badge">{t}</span>
                ))}
              </div>
            )}
          </div>
        ))}

        {!repos.length && (
          <div className="card">
            <div style={{ fontWeight: 600 }}>No repos yet</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              Start the local server (`npm run server:dev`) to load repos.
            </div>
          </div>
        )}
      </section>

      {!!hiddenRepos.length && (
        <section className="card">
          <details>
            <summary className="muted" style={{ cursor: "pointer" }}>
              Hidden projects ({hiddenRepos.length})
            </summary>
            <div className="grid" style={{ marginTop: 12 }}>
              {hiddenRepos.map((repo) => (
                <div key={repo.id} className="card cardLink" style={{ opacity: 0.75 }}>
                  <Link
                    href={`/projects/${repo.id}`}
                    prefetch={false}
                    className="stretchedLink"
                    aria-label={`Open ${displayName(repo)}`}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div style={{ minWidth: 0, overflow: "hidden" }}>
                      <div style={{ fontWeight: 600 }}>{displayName(repo)}</div>
                      <div className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}>{repo.path}</div>
                      {repo.description && <div className="desc">{repo.description}</div>}
                    </div>
                    <div style={{ zIndex: 2, position: "relative", flexShrink: 0, pointerEvents: "auto" }}>
                      <StarToggle repoId={repo.id} initialStarred={repo.starred} />
                    </div>
                  </div>
                  <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span className="badge">hidden</span>
                    <span className="badge">{repo.type}</span>
                    <span className="badge">{repo.stage}</span>
                    <span className="badge">{repo.status}</span>
                    <span className="badge">p{repo.priority}</span>
                  </div>
                </div>
              ))}
            </div>
          </details>
        </section>
      )}
    </main>
  );
}
