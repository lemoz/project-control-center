"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImportDialog } from "../components/people/ImportDialog";
import { PersonForm } from "../components/people/PersonForm";
import type { ConversationSummary, Person, RepoSummary } from "../components/people/types";

type PeopleResponse = {
  people: Person[];
};

type StarFilter = "all" | "starred" | "unstarred";

type SortOption = "name" | "last_interaction";

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "No activity";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60 * 1000) return "Just now";
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function matchesSearch(person: Person, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystacks = [person.name, person.nickname, person.company, person.role]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => value.toLowerCase());
  if (haystacks.some((value) => value.includes(needle))) return true;
  return person.tags.some((tag) => tag.toLowerCase().includes(needle));
}

export default function PeoplePage() {
  const router = useRouter();
  const [people, setPeople] = useState<Person[]>([]);
  const [projects, setProjects] = useState<RepoSummary[]>([]);
  const [summaryById, setSummaryById] = useState<Record<string, ConversationSummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [starFilter, setStarFilter] = useState<StarFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("name");
  const [importOpen, setImportOpen] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [starUpdating, setStarUpdating] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadPeople = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (projectFilter) params.set("project", projectFilter);
      if (tagFilter) params.set("tag", tagFilter);
      if (starFilter === "starred") params.set("starred", "true");
      if (starFilter === "unstarred") params.set("starred", "false");
      if (searchTerm) params.set("q", searchTerm);
      const qs = params.toString();
      const res = await fetch(`/api/people${qs ? `?${qs}` : ""}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const responseBody = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(responseBody?.error ?? "Failed to load people.");
        return;
      }
      const responseBody = (await res.json().catch(() => null)) as PeopleResponse | null;
      setPeople(responseBody?.people ?? []);
    } catch {
      setError("Failed to load people.");
    } finally {
      setLoading(false);
    }
  }, [projectFilter, tagFilter, searchTerm, starFilter]);

  useEffect(() => {
    void loadPeople();
  }, [loadPeople]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const loadProjects = async () => {
      try {
        const res = await fetch("/api/repos", { cache: "no-store", signal: controller.signal });
        if (!res.ok) return;
        const responseBody = (await res.json().catch(() => null)) as RepoSummary[] | null;
        if (!active) return;
        setProjects(responseBody ?? []);
      } catch {
        if (!active) return;
        setProjects([]);
      }
    };
    void loadProjects();
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (people.length === 0) return;
    const missing = people.filter((person) => !summaryById[person.id]);
    if (missing.length === 0) return;
    let active = true;
    const controller = new AbortController();
    const loadSummaries = async () => {
      const updates: Record<string, ConversationSummary> = {};
      await Promise.all(
        missing.map(async (person) => {
          try {
            const res = await fetch(
              `/api/people/${encodeURIComponent(person.id)}/conversations/summary`,
              { cache: "no-store", signal: controller.signal }
            );
            if (!res.ok) return;
            const responseBody = (await res.json().catch(() => null)) as
              | { summary?: ConversationSummary }
              | null;
            if (responseBody?.summary) {
              updates[person.id] = responseBody.summary;
            }
          } catch {
            return;
          }
        })
      );
      if (!active || Object.keys(updates).length === 0) return;
      setSummaryById((prev) => ({ ...prev, ...updates }));
    };
    void loadSummaries();
    return () => {
      active = false;
      controller.abort();
    };
  }, [people, summaryById]);

  const tagOptions = useMemo(() => {
    const tags = new Set<string>();
    for (const person of people) {
      for (const tag of person.tags) tags.add(tag);
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }, [people]);

  const filteredPeople = useMemo(() => {
    if (!searchTerm) return people;
    return people.filter((person) => matchesSearch(person, searchTerm));
  }, [people, searchTerm]);

  const sortedPeople = useMemo(() => {
    const list = [...filteredPeople];
    if (sortBy === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name));
      return list;
    }
    list.sort((a, b) => {
      const aTime = summaryById[a.id]?.last_interaction?.occurred_at;
      const bTime = summaryById[b.id]?.last_interaction?.occurred_at;
      const aMs = aTime ? Date.parse(aTime) : 0;
      const bMs = bTime ? Date.parse(bTime) : 0;
      if (aMs !== bMs) return bMs - aMs;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [filteredPeople, sortBy, summaryById]);

  const handleStarToggle = async (person: Person) => {
    if (starUpdating[person.id]) return;
    const next = !person.starred;
    setStarUpdating((prev) => ({ ...prev, [person.id]: true }));
    setPeople((prev) =>
      prev.map((entry) => (entry.id === person.id ? { ...entry, starred: next } : entry))
    );
    try {
      const res = await fetch(`/api/people/${encodeURIComponent(person.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starred: next }),
      });
      if (!res.ok) {
        setPeople((prev) =>
          prev.map((entry) =>
            entry.id === person.id ? { ...entry, starred: person.starred } : entry
          )
        );
        return;
      }
      if (starFilter !== "all") {
        void loadPeople();
      }
    } catch {
      setPeople((prev) =>
        prev.map((entry) =>
          entry.id === person.id ? { ...entry, starred: person.starred } : entry
        )
      );
    } finally {
      setStarUpdating((prev) => ({ ...prev, [person.id]: false }));
    }
  };

  const handleCreated = (person: Person) => {
    setShowAddForm(false);
    setPeople((prev) => [person, ...prev]);
    router.push(`/people/${encodeURIComponent(person.id)}`);
  };

  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section
        className="card"
        style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>People</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Manage contacts, project relationships, and conversation history.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btnSecondary" onClick={() => setShowAddForm((prev) => !prev)}>
            {showAddForm ? "Close" : "+ Add"}
          </button>
          <button className="btn" onClick={() => setImportOpen(true)}>
            Import
          </button>
        </div>
      </section>

      {showAddForm && (
        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontWeight: 700 }}>Add contact</div>
          <PersonForm onSaved={handleCreated} onCancel={() => setShowAddForm(false)} />
        </section>
      )}

      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            className="input"
            placeholder="Search by name, company, role, or tag"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select
              className="select"
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
            >
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <select
              className="select"
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
            >
              <option value="">All tags</option>
              {tagOptions.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
            <select
              className="select"
              value={starFilter}
              onChange={(event) => setStarFilter(event.target.value as StarFilter)}
            >
              <option value="all">All contacts</option>
              <option value="starred">Starred only</option>
              <option value="unstarred">Unstarred only</option>
            </select>
            <select
              className="select"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as SortOption)}
            >
              <option value="name">Sort by name</option>
              <option value="last_interaction">Sort by last interaction</option>
            </select>
          </div>
        </div>
      </section>

      {error && <div className="error">{error}</div>}
      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="spinner" />
          <span className="muted" style={{ fontSize: 12 }}>
            Loading people...
          </span>
        </div>
      )}

      {!loading && sortedPeople.length === 0 && (
        <section className="card">
          <div className="muted" style={{ fontSize: 13 }}>
            No contacts yet. Add someone or import from your Mac.
          </div>
        </section>
      )}

      {!loading && sortedPeople.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sortedPeople.map((person) => {
            const summary = summaryById[person.id];
            const lastInteraction = summary?.last_interaction?.occurred_at ?? null;
            return (
              <Link
                key={person.id}
                href={`/people/${encodeURIComponent(person.id)}`}
                className="card"
                style={{ display: "flex", flexDirection: "column", gap: 8 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void handleStarToggle(person);
                      }}
                      disabled={starUpdating[person.id]}
                      aria-label={person.starred ? "Unstar contact" : "Star contact"}
                      title={person.starred ? "Unstar contact" : "Star contact"}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: person.starred ? "#f5c542" : "#7c8ab0",
                        fontSize: 12,
                        cursor: "pointer",
                        padding: 0,
                        lineHeight: 1,
                      }}
                    >
                      {person.starred ? "Unstar" : "Star"}
                    </button>
                    <div style={{ fontWeight: 600 }}>{person.name}</div>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {formatRelativeTime(lastInteraction)}
                  </div>
                </div>
                {(person.role || person.company) && (
                  <div className="muted" style={{ fontSize: 13 }}>
                    {person.role ? person.role : ""}
                    {person.role && person.company ? " at " : ""}
                    {person.company ? person.company : ""}
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
              </Link>
            );
          })}
        </div>
      )}

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(_report) => {
          void loadPeople();
        }}
      />
    </main>
  );
}
