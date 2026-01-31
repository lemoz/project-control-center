"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConversationTimeline } from "../../components/people/ConversationTimeline";
import { IdentifierManager } from "../../components/people/IdentifierManager";
import { PersonForm } from "../../components/people/PersonForm";
import { ProjectAssociations } from "../../components/people/ProjectAssociations";
import type {
  ConversationEvent,
  PersonDetails,
  RepoSummary,
} from "../../components/people/types";

type PersonResponse = {
  person: PersonDetails;
};

type ConversationsResponse = {
  events: ConversationEvent[];
};

type ChannelFilter = "all" | ConversationEvent["channel"];

const TIMELINE_PAGE_SIZE = 50;

export default function PersonDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const [person, setPerson] = useState<PersonDetails | null>(null);
  const [projects, setProjects] = useState<RepoSummary[]>([]);
  const [events, setEvents] = useState<ConversationEvent[]>([]);
  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineLoadingMore, setTimelineLoadingMore] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineOffset, setTimelineOffset] = useState(0);
  const [timelineHasMore, setTimelineHasMore] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [starUpdating, setStarUpdating] = useState(false);
  const personId = person?.id;

  const loadPerson = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/people/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const responseBody = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(responseBody?.error ?? "Failed to load contact.");
        return;
      }
      const responseBody = (await res.json().catch(() => null)) as PersonResponse | null;
      setPerson(responseBody?.person ?? null);
    } catch {
      setError("Failed to load contact.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/repos", { cache: "no-store" });
      if (!res.ok) return;
      const responseBody = (await res.json().catch(() => null)) as RepoSummary[] | null;
      setProjects(responseBody ?? []);
    } catch {
      setProjects([]);
    }
  }, []);

  const loadTimeline = useCallback(async () => {
    if (!personId) return;
    setTimelineLoading(true);
    setTimelineError(null);
    setTimelineLoadingMore(false);
    setEvents([]);
    setTimelineOffset(0);
    setTimelineHasMore(false);
    try {
      const params = new URLSearchParams();
      if (channel !== "all") params.set("channel", channel);
      params.set("limit", String(TIMELINE_PAGE_SIZE));
      params.set("offset", "0");
      const qs = params.toString();
      const res = await fetch(
        `/api/people/${encodeURIComponent(id)}/conversations${qs ? `?${qs}` : ""}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        const responseBody = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setTimelineError(responseBody?.error ?? "Failed to load conversations.");
        return;
      }
      const responseBody = (await res.json().catch(() => null)) as
        | ConversationsResponse
        | null;
      const nextEvents = responseBody?.events ?? [];
      setEvents(nextEvents);
      setTimelineOffset(nextEvents.length);
      setTimelineHasMore(nextEvents.length === TIMELINE_PAGE_SIZE);
    } catch {
      setTimelineError("Failed to load conversations.");
    } finally {
      setTimelineLoading(false);
    }
  }, [channel, id, personId]);

  const loadMoreTimeline = useCallback(async () => {
    if (!personId || timelineLoading || timelineLoadingMore || !timelineHasMore) return;
    setTimelineLoadingMore(true);
    setTimelineError(null);
    try {
      const params = new URLSearchParams();
      if (channel !== "all") params.set("channel", channel);
      params.set("limit", String(TIMELINE_PAGE_SIZE));
      params.set("offset", String(timelineOffset));
      const qs = params.toString();
      const res = await fetch(
        `/api/people/${encodeURIComponent(id)}/conversations${qs ? `?${qs}` : ""}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        const responseBody = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setTimelineError(responseBody?.error ?? "Failed to load more conversations.");
        return;
      }
      const responseBody = (await res.json().catch(() => null)) as
        | ConversationsResponse
        | null;
      const nextEvents = responseBody?.events ?? [];
      setEvents((prev) => [...prev, ...nextEvents]);
      setTimelineOffset((prev) => prev + nextEvents.length);
      setTimelineHasMore(nextEvents.length === TIMELINE_PAGE_SIZE);
    } catch {
      setTimelineError("Failed to load more conversations.");
    } finally {
      setTimelineLoadingMore(false);
    }
  }, [
    channel,
    id,
    personId,
    timelineHasMore,
    timelineLoading,
    timelineLoadingMore,
    timelineOffset,
  ]);

  useEffect(() => {
    void loadPerson();
  }, [loadPerson]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    void loadTimeline();
  }, [loadTimeline]);

  const handleDelete = async () => {
    if (!person) return;
    if (!window.confirm("Delete this contact?")) return;
    try {
      const res = await fetch(`/api/people/${encodeURIComponent(person.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) return;
      router.push("/people");
    } catch {
      return;
    }
  };

  const handleStarToggle = async () => {
    if (!person || starUpdating) return;
    const next = !person.starred;
    setStarUpdating(true);
    setPerson({ ...person, starred: next });
    try {
      const res = await fetch(`/api/people/${encodeURIComponent(person.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starred: next }),
      });
      if (!res.ok) {
        setPerson({ ...person, starred: !next });
      }
    } catch {
      setPerson({ ...person, starred: !next });
    } finally {
      setStarUpdating(false);
    }
  };

  const handleSync = async () => {
    if (!person) return;
    setSyncing(true);
    try {
      const res = await fetch(
        `/api/people/${encodeURIComponent(person.id)}/conversations/sync`,
        { method: "POST" }
      );
      if (res.ok) {
        await loadTimeline();
      }
    } catch {
      return;
    } finally {
      setSyncing(false);
    }
  };

  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Link href="/people" className="badge">
              Back to people
            </Link>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{person?.name ?? "Contact"}</div>
            {person && (
              <button
                type="button"
                onClick={handleStarToggle}
                disabled={starUpdating}
                className="btnSecondary"
              >
                {person.starred ? "Unstar" : "Star"}
              </button>
            )}
          </div>
          {person && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btnSecondary" onClick={() => setEditing((prev) => !prev)}>
                {editing ? "Cancel edit" : "Edit"}
              </button>
              <button className="btnSecondary" onClick={handleDelete}>
                Delete
              </button>
            </div>
          )}
        </div>
        {error && <div className="error">{error}</div>}
        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="spinner" />
            <span className="muted" style={{ fontSize: 12 }}>
              Loading contact...
            </span>
          </div>
        )}
      </section>

      {person && (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontWeight: 700 }}>Personal info</div>
            {editing ? (
              <PersonForm
                person={person}
                onSaved={(updated) => {
                  setPerson({ ...person, ...updated });
                  setEditing(false);
                }}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                {person.nickname && (
                  <div>
                    <strong>Nickname:</strong> {person.nickname}
                  </div>
                )}
                {(person.role || person.company) && (
                  <div>
                    <strong>Role:</strong> {person.role ?? ""}
                    {person.role && person.company ? " at " : ""}
                    {person.company ?? ""}
                  </div>
                )}
                {person.tags.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {person.tags.map((tag) => (
                      <span key={`${person.id}-${tag}`} className="badge">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {person.notes && (
                  <div>
                    <strong>Notes:</strong>
                    <div className="muted" style={{ marginTop: 4 }}>
                      {person.notes}
                    </div>
                  </div>
                )}
                {!person.notes && person.tags.length === 0 && !person.role && !person.company && !person.nickname && (
                  <div className="muted">No additional info yet.</div>
                )}
              </div>
            )}
          </section>

          <IdentifierManager
            personId={person.id}
            identifiers={person.identifiers}
            onChange={(identifiers) => setPerson({ ...person, identifiers })}
          />

          <ProjectAssociations
            personId={person.id}
            associations={person.projects}
            projects={projects}
            onChange={(associations) => setPerson({ ...person, projects: associations })}
          />
        </div>
      )}

      {person && (
        <ConversationTimeline
          events={events}
          channel={channel}
          onChannelChange={setChannel}
          onSync={handleSync}
          syncing={syncing}
          loading={timelineLoading}
          loadingMore={timelineLoadingMore}
          error={timelineError}
          hasMore={timelineHasMore}
          onLoadMore={loadMoreTimeline}
        />
      )}
    </main>
  );
}
