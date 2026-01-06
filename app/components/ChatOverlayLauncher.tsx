"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type LegacyScope =
  | { scope: "global" }
  | { scope: "project"; projectId: string }
  | { scope: "work_order"; projectId: string; workOrderId: string };

type LegacyThreadResponse = {
  thread?: { id?: string };
  error?: string;
};

function lookupUrl(scope: LegacyScope): string {
  if (scope.scope === "global") return "/api/chat/global";
  if (scope.scope === "project") {
    return `/api/chat/projects/${encodeURIComponent(scope.projectId)}`;
  }
  return `/api/chat/projects/${encodeURIComponent(scope.projectId)}/work-orders/${encodeURIComponent(
    scope.workOrderId
  )}`;
}

export function ChatOverlayLauncher({ scope }: { scope: LegacyScope }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hasAutoOpenedRef = useRef(false);

  const queryString = useMemo(() => searchParams.toString(), [searchParams]);

  useEffect(() => {
    const chatOpen = searchParams.get("chat") === "1";
    const threadParam = searchParams.get("thread");
    if (chatOpen || threadParam) {
      hasAutoOpenedRef.current = true;
      setLoading(false);
      return;
    }
    if (hasAutoOpenedRef.current) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    const openOverlay = async () => {
      hasAutoOpenedRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(lookupUrl(scope), { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as LegacyThreadResponse | null;
        if (!res.ok) throw new Error(json?.error || "failed to load thread");
        const threadId = json?.thread?.id;
        const params = new URLSearchParams(queryString);
        params.set("chat", "1");
        if (threadId) params.set("thread", threadId);
        const query = params.toString();
        const href = query ? `${pathname}?${query}` : pathname;
        router.replace(href, { scroll: false });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "failed to open chat");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void openOverlay();
    return () => {
      cancelled = true;
    };
  }, [pathname, queryString, router, scope, searchParams]);

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontWeight: 700 }}>Chat now opens in the overlay</div>
      {loading && <div className="muted">Opening chat overlay...</div>}
      {!loading && !error && (
        <div className="muted">If the overlay didn&apos;t open, use the Chat widget.</div>
      )}
      {error && <div className="error">{error}</div>}
      {error && (
        <button
          className="btnSecondary"
          type="button"
          onClick={() => {
            const params = new URLSearchParams(queryString);
            params.set("chat", "1");
            const query = params.toString();
            const href = query ? `${pathname}?${query}` : pathname;
            router.replace(href, { scroll: false });
          }}
        >
          Open chat overlay
        </button>
      )}
    </section>
  );
}
