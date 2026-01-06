"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  attentionReasonLabel,
  buildChatHref,
  buildLocationLabel,
  scopeLabel,
  type AttentionReason,
  type AttentionItem,
  type AttentionResponse,
} from "./chat_attention";

function summarizeActionTitles(titles: string[], limit = 3): string {
  const cleaned = titles.map((title) => title.trim()).filter(Boolean);
  if (!cleaned.length) return "";
  const head = cleaned.slice(0, limit);
  const remaining = cleaned.length - head.length;
  if (remaining > 0) return `${head.join(" / ")} +${remaining} more`;
  return head.join(" / ");
}

function formatReasonBadge(reason: AttentionReason): string {
  const label = attentionReasonLabel(reason.code);
  return reason.count > 1 ? `${label} (${reason.count})` : label;
}

function BellIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ opacity: active ? 1 : 0.8 }}
    >
      <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
      <path d="M9 17a3 3 0 0 0 6 0" />
    </svg>
  );
}

export function ChatAttentionBell() {
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [limited, setLimited] = useState(false);
  const [scanLimit, setScanLimit] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const hasLoadedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) =>
      (b.attention.last_event_at ?? "").localeCompare(a.attention.last_event_at ?? "")
    );
  }, [items]);

  const pendingTotal = useMemo(() => {
    return items.length;
  }, [items]);

  const load = useCallback(async () => {
    const isInitial = !hasLoadedRef.current;
    if (isInitial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/chat/attention", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as AttentionResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to load attention");
      setItems(json?.items ?? []);
      setLimited(Boolean(json?.limited));
      setScanLimit(
        typeof json?.scan_limit === "number" ? json?.scan_limit ?? null : null
      );
      hasLoadedRef.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load attention");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (containerRef.current && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const countLabel = pendingTotal > 99 ? "99+" : String(pendingTotal);
  const buttonLabel = pendingTotal
    ? `Chat attention (${pendingTotal} threads need attention)`
    : "Chat attention";

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={buttonLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        title={buttonLabel}
        style={{
          background: "transparent",
          border: "none",
          color: pendingTotal ? "#f5c542" : "#a9b0c2",
          cursor: "pointer",
          padding: 4,
          lineHeight: 1,
          position: "relative",
          display: "flex",
          alignItems: "center",
        }}
      >
        <BellIcon active={pendingTotal > 0} />
        {pendingTotal > 0 && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              background: "#2b5cff",
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              padding: "0 5px",
              minWidth: 16,
              height: 16,
              borderRadius: 999,
              lineHeight: "16px",
              border: "1px solid #0b0d12",
              textAlign: "center",
            }}
          >
            {countLabel}
          </span>
        )}
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 10px)",
            width: 360,
            maxWidth: "calc(100vw - 32px)",
            zIndex: 40,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Needs your attention</div>
            <button
              type="button"
              className="linkBtn"
              onClick={() => void load()}
              disabled={loading || refreshing}
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {!!error && <div className="error">{error}</div>}

          {limited && scanLimit && (
            <div className="muted" style={{ fontSize: 11 }}>
              Showing the latest {scanLimit} assistant messages; older pending actions may be omitted.
            </div>
          )}

          {loading && <div className="muted" style={{ fontSize: 12 }}>Loading...</div>}

          {!loading && !sortedItems.length && (
            <div className="muted" style={{ fontSize: 12 }}>
              No threads need attention.
            </div>
          )}

          {!loading && !!sortedItems.length && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
              {sortedItems.map((item) => {
                const href = buildChatHref(item, pathname, queryString);
                const pendingActions = item.attention.reasons.find(
                  (reason) => reason.code === "pending_action"
                );
                const actionSummary = summarizeActionTitles(
                  pendingActions?.action_titles ?? []
                );
                return (
                  <div
                    key={item.thread_id}
                    style={{
                      border: "1px solid rgba(124,138,176,0.2)",
                      borderRadius: 10,
                      padding: 10,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span className="badge">{scopeLabel(item.scope)}</span>
                      <span className="badge">Needs you</span>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {buildLocationLabel(item)}
                    </div>
                    {!!item.attention.reasons.length && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {item.attention.reasons.map((reason) => (
                          <span key={reason.code} className="badge">
                            {formatReasonBadge(reason)}
                          </span>
                        ))}
                      </div>
                    )}
                    {!!actionSummary && (
                      <div className="muted" style={{ fontSize: 11, lineHeight: 1.4 }}>
                        Actions: {actionSummary}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      {href ? (
                        <Link href={href} className="badge" onClick={() => setOpen(false)}>
                          Open chat
                        </Link>
                      ) : (
                        <span className="badge">Chat unavailable</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
