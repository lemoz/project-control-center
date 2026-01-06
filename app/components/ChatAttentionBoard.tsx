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

function formatTime(value: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleString();
}

function formatReasonBadge(reason: AttentionReason): string {
  const label = attentionReasonLabel(reason.code);
  return reason.count > 1 ? `${label} (${reason.count})` : label;
}

export function ChatAttentionBoard() {
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [limited, setLimited] = useState(false);
  const [scanLimit, setScanLimit] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) =>
      (b.attention.last_event_at ?? "").localeCompare(a.attention.last_event_at ?? "")
    );
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

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700 }}>Attention</div>
          <div className="muted" style={{ fontSize: 12 }}>Threads that need you across chat scopes.</div>
        </div>
        <button className="btnSecondary" onClick={() => void load()} disabled={loading || refreshing}>
          Refresh
        </button>
      </div>

      {!!error && <div className="error">{error}</div>}
      {limited && scanLimit && (
        <div className="muted" style={{ fontSize: 12 }}>
          Showing the latest {scanLimit} assistant messages; older pending actions
          may be omitted.
        </div>
      )}
      {loading && <div className="muted">Loading...</div>}

      {!loading && !sortedItems.length && (
        <div className="muted">No threads need attention.</div>
      )}

      {!loading && !!sortedItems.length && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sortedItems.map((item) => {
            const href = buildChatHref(item, pathname, queryString);
            const pendingActions = item.attention.reasons.find(
              (reason) => reason.code === "pending_action"
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
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="badge">{scopeLabel(item.scope)}</span>
                    <div style={{ fontWeight: 700 }}>{buildLocationLabel(item)}</div>
                  </div>
                  <span className="badge">Needs you</span>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  Last event {formatTime(item.attention.last_event_at ?? "")}
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
                {!!pendingActions?.action_titles?.length && (
                  <div className="muted" style={{ fontSize: 12, lineHeight: 1.4 }}>
                    Actions: {pendingActions.action_titles.join(" / ")}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {href ? (
                    <Link href={href} className="badge">
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
    </section>
  );
}
