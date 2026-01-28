"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { ChatAttentionBell } from "./ChatAttentionBell";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/observability", label: "Observability" },
  { href: "/chat", label: "Chat" },
  { href: "/settings", label: "Settings" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function NavBar() {
  const pathname = usePathname();
  const isProjectPage = pathname.startsWith("/projects/");

  return (
    <nav className="nav-bar">
      <div className="nav-bar-inner">
        <Link href="/" className="nav-brand">
          PCC
        </Link>

        {isProjectPage && (
          <div className="nav-breadcrumb">
            <Link href="/" className="nav-back">
              &larr; Back
            </Link>
            <span className="nav-breadcrumb-sep">/</span>
            <span className="nav-breadcrumb-context">Project</span>
          </div>
        )}

        <div className="nav-links">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={
                "nav-link" + (isActive(pathname, href) ? " nav-link--active" : "")
              }
            >
              {label}
            </Link>
          ))}
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
