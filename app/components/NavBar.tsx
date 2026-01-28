"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { ChatAttentionBell } from "./ChatAttentionBell";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/observability", label: "Observability" },
  { href: "/chat", label: "Chat" },
  { href: "/settings", label: "Settings" },
] as const;

const PROJECT_LINKS = [
  { key: "dashboard", label: "Dashboard", suffix: "" },
  { key: "live", label: "Live", suffix: "/live" },
  { key: "chat", label: "Chat", suffix: "/chat" },
  { key: "tracks", label: "Tracks", suffix: "/tracks" },
] as const;

type ProjectLinkKey = (typeof PROJECT_LINKS)[number]["key"];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname === "/portfolio";
  return pathname === href || pathname.startsWith(href + "/");
}

function pathMatches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

function projectIdFromPath(pathname: string): string | null {
  const [root, id] = pathname.split("/").filter(Boolean);
  if (root !== "projects" || !id) return null;
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

type ProjectResponse = {
  project?: {
    name?: string;
  };
};

export function NavBar() {
  const pathname = usePathname();
  const projectId = useMemo(() => projectIdFromPath(pathname), [pathname]);
  const encodedProjectId = projectId ? encodeURIComponent(projectId) : null;
  const projectBase = encodedProjectId ? `/projects/${encodedProjectId}` : null;
  const [projectName, setProjectName] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setProjectName(null);
      return;
    }
    let isActiveFetch = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const res = await fetch(`/api/repos/${encodeURIComponent(projectId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const json = (await res.json().catch(() => null)) as ProjectResponse | null;
        if (!isActiveFetch) return;
        setProjectName(json?.project?.name ?? null);
      } catch {
        if (!isActiveFetch) return;
        setProjectName(null);
      }
    };
    void load();
    return () => {
      isActiveFetch = false;
      controller.abort();
    };
  }, [projectId]);

  const projectLabel = projectName || projectId || "Project";
  const projectPrefixes = useMemo(() => {
    if (!projectBase) return null;
    return {
      live: `${projectBase}/live`,
      chat: `${projectBase}/chat`,
      tracks: `${projectBase}/tracks`,
    };
  }, [projectBase]);

  const isProjectLinkActive = (key: ProjectLinkKey): boolean => {
    if (!projectBase || !projectPrefixes) return false;
    if (key === "dashboard") {
      if (pathname === projectBase) return true;
      return (
        !pathMatches(pathname, projectPrefixes.live) &&
        !pathMatches(pathname, projectPrefixes.chat) &&
        !pathMatches(pathname, projectPrefixes.tracks)
      );
    }
    if (key === "live") return pathMatches(pathname, projectPrefixes.live);
    if (key === "chat") return pathMatches(pathname, projectPrefixes.chat);
    if (key === "tracks") return pathMatches(pathname, projectPrefixes.tracks);
    return false;
  };

  return (
    <nav className="nav-bar">
      <div className="nav-bar-inner">
        <div className="nav-left">
          <Link href="/" className="nav-brand">
            PCC
          </Link>

          {projectBase && (
            <div className="nav-breadcrumb" aria-label="Project navigation">
              <span className="nav-project-name" title={projectLabel}>
                {projectLabel}
              </span>
              <div className="nav-project-links">
                {PROJECT_LINKS.map(({ key, label, suffix }) => {
                  const href = `${projectBase}${suffix}`;
                  const active = isProjectLinkActive(key);
                  return (
                    <Link
                      key={key}
                      href={href}
                      className={
                        "nav-project-link" + (active ? " nav-project-link--active" : "")
                      }
                      aria-current={active ? "page" : undefined}
                    >
                      {label}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="nav-links" aria-label="Global navigation">
          {NAV_LINKS.map(({ href, label }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                className={"nav-link" + (active ? " nav-link--active" : "")}
                aria-current={active ? "page" : undefined}
              >
                {label}
              </Link>
            );
          })}
        </div>

        <div className="nav-actions">
          <Suspense fallback={null}>
            <ChatAttentionBell />
          </Suspense>
        </div>
      </div>
    </nav>
  );
}
