"use client";

import { useMemo } from "react";
import {
  CONVERSATION_CHANNELS,
  type ConversationChannel,
  type ConversationEvent,
} from "./types";

type ChannelFilter = ConversationChannel | "all";

type ConversationTimelineProps = {
  events: ConversationEvent[];
  channel: ChannelFilter;
  onChannelChange: (value: ChannelFilter) => void;
  onSync?: () => void;
  syncing?: boolean;
  loading?: boolean;
  loadingMore?: boolean;
  error?: string | null;
  hasMore?: boolean;
  onLoadMore?: () => void;
};

const CHANNEL_LABELS: Record<ConversationChannel, string> = {
  imessage: "iMessage",
  email: "Email",
  meeting: "Meeting",
  call: "Call",
  note: "Note",
};

const DIRECTION_LABELS: Record<ConversationEvent["direction"], string> = {
  inbound: "<-",
  outbound: "->",
  bidirectional: "<->",
};

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDateLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  const today = startOfDay(new Date());
  const target = startOfDay(date);
  const diffMs = today.getTime() - target.getTime();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTimeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function summarizeEvent(event: ConversationEvent): string {
  if (event.summary) return event.summary;
  if (!event.content) return "";
  const firstLine = event.content.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return firstLine ?? "";
}

export function ConversationTimeline({
  events,
  channel,
  onChannelChange,
  onSync,
  syncing,
  loading,
  loadingMore,
  error,
  hasMore,
  onLoadMore,
}: ConversationTimelineProps) {
  const groups = useMemo(() => {
    const result: Array<{ key: string; label: string; items: ConversationEvent[] }> = [];
    const indexByKey = new Map<string, number>();
    for (const event of events) {
      const key = event.occurred_at.slice(0, 10);
      const existingIndex = indexByKey.get(key);
      if (existingIndex !== undefined) {
        result[existingIndex]?.items.push(event);
        continue;
      }
      const label = formatDateLabel(event.occurred_at);
      indexByKey.set(key, result.length);
      result.push({ key, label, items: [event] });
    }
    return result;
  }, [events]);

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700 }}>Conversation history</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Chronological across channels.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            className="select"
            value={channel}
            onChange={(event) => {
              const value = event.target.value as ChannelFilter;
              onChannelChange(value);
            }}
          >
            <option value="all">All channels</option>
            {CONVERSATION_CHANNELS.map((entry) => (
              <option key={entry} value={entry}>
                {CHANNEL_LABELS[entry]}
              </option>
            ))}
          </select>
          {onSync && (
            <button className="btnSecondary" onClick={onSync} disabled={syncing}>
              {syncing ? "Syncing..." : "Sync"}
            </button>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="spinner" />
          <span className="muted" style={{ fontSize: 12 }}>
            Loading conversation history...
          </span>
        </div>
      )}
      {!loading && events.length === 0 && (
        <div className="muted" style={{ fontSize: 13 }}>
          No conversation events yet.
        </div>
      )}

      {!loading && events.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {groups.map((group) => (
            <div key={group.key} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }} className="muted">
                {group.label}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {group.items.map((event) => (
                  <div
                    key={event.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #22293a",
                      background: "#0f1320",
                    }}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span className="badge">{CHANNEL_LABELS[event.channel]}</span>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {DIRECTION_LABELS[event.direction]} {formatTimeLabel(event.occurred_at)}
                      </span>
                    </div>
                    <div style={{ fontSize: 13 }}>{summarizeEvent(event) || "(no summary)"}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {!loading && events.length > 0 && onLoadMore && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div className="muted" style={{ fontSize: 12 }}>
            Showing {events.length} events
          </div>
          {hasMore ? (
            <button className="btnSecondary" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              End of conversation history.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
