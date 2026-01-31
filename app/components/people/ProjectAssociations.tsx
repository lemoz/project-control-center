"use client";

import { useEffect, useMemo, useState } from "react";
import {
  PROJECT_RELATIONSHIPS,
  type PersonProject,
  type PersonProjectRelationship,
  type RepoSummary,
} from "./types";

type ProjectAssociationsProps = {
  personId: string;
  associations: PersonProject[];
  projects: RepoSummary[];
  onChange: (projects: PersonProject[]) => void;
};

function isErrorResponse(value: unknown): value is { error: string } {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { error?: unknown }).error === "string";
}

export function ProjectAssociations({
  personId,
  associations,
  projects,
  onChange,
}: ProjectAssociationsProps) {
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [relationship, setRelationship] = useState<PersonProjectRelationship>(
    PROJECT_RELATIONSHIPS[0]
  );
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const availableProjects = useMemo(() => {
    return projects.filter(
      (project) => !associations.some((association) => association.project_id === project.id)
    );
  }, [projects, associations]);

  const projectLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) {
      map.set(project.id, project.name);
    }
    return map;
  }, [projects]);

  useEffect(() => {
    if (availableProjects.length === 0) {
      setSelectedProjectId("");
      return;
    }
    if (!availableProjects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(availableProjects[0]?.id ?? "");
    }
  }, [availableProjects, selectedProjectId]);

  const handleAdd = async () => {
    if (!selectedProjectId) {
      setError("Select a project first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/people/${encodeURIComponent(personId)}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: selectedProjectId,
          relationship,
        }),
      });
      if (!res.ok) {
        const responseBody = (await res.json().catch(() => null)) as unknown;
        if (isErrorResponse(responseBody)) {
          setError(responseBody.error);
        } else {
          setError("Unable to add project association.");
        }
        return;
      }
      const responseBody = (await res.json().catch(() => null)) as
        | { project?: PersonProject }
        | null;
      if (responseBody?.project) {
        onChange([...associations, responseBody.project]);
      }
    } catch {
      setError("Unable to add project association.");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (associationId: string) => {
    setRemovingId(associationId);
    setError(null);
    try {
      const res = await fetch(
        `/api/people/${encodeURIComponent(personId)}/projects/${encodeURIComponent(associationId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const responseBody = (await res.json().catch(() => null)) as unknown;
        if (isErrorResponse(responseBody)) {
          setError(responseBody.error);
        } else {
          setError("Unable to remove project association.");
        }
        return;
      }
      onChange(associations.filter((association) => association.id !== associationId));
    } catch {
      setError("Unable to remove project association.");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontWeight: 700 }}>Project associations</div>
      {error && <div className="error">{error}</div>}

      {associations.length === 0 && (
        <div className="muted" style={{ fontSize: 13 }}>
          No projects linked yet.
        </div>
      )}
      {associations.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {associations.map((association) => (
            <div
              key={association.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                alignItems: "center",
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #22293a",
                background: "#0f1320",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ fontSize: 13 }}>
                  {projectLabels.get(association.project_id) ?? association.project_id}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {association.relationship}
                </div>
              </div>
              <button
                className="btnSecondary"
                onClick={() => handleRemove(association.id)}
                disabled={removingId === association.id}
              >
                {removingId === association.id ? "Removing..." : "Remove"}
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>Add to project</div>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <select
            className="select"
            value={selectedProjectId}
            onChange={(event) => setSelectedProjectId(event.target.value)}
            disabled={availableProjects.length === 0}
          >
            {availableProjects.length === 0 && <option value="">No available projects</option>}
            {availableProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={relationship}
            onChange={(event) => setRelationship(event.target.value as PersonProjectRelationship)}
          >
            {PROJECT_RELATIONSHIPS.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </div>
        <button className="btn" onClick={handleAdd} disabled={saving || !selectedProjectId}>
          {saving ? "Adding..." : "Add to project"}
        </button>
      </div>
    </section>
  );
}
