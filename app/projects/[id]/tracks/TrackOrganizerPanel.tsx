"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyTrackOrganizationSuggestions,
  generateTrackOrganizationSuggestions,
  type Track,
  type TrackOrganizationMode,
  type TrackOrganizationResult,
} from "../../../../lib/api";

type TrackOrganizerPanelProps = {
  projectId: string;
  tracks: Track[];
  onApplied: () => void;
};

type AssignmentGroup = {
  trackId: string;
  trackLabel: string;
  workOrders: string[];
};

const ASSIGNMENT_PREVIEW_LIMIT = 16;

function renderAssignmentsPreview(workOrders: string[]): string {
  if (workOrders.length <= ASSIGNMENT_PREVIEW_LIMIT) {
    return workOrders.join(", ");
  }
  const shown = workOrders.slice(0, ASSIGNMENT_PREVIEW_LIMIT);
  return `${shown.join(", ")} … +${workOrders.length - ASSIGNMENT_PREVIEW_LIMIT} more`;
}

export function TrackOrganizerPanel({
  projectId,
  tracks,
  onApplied,
}: TrackOrganizerPanelProps) {
  const [mode, setMode] = useState<TrackOrganizationMode>(
    tracks.length === 0 ? "initial" : "incremental"
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<TrackOrganizationResult | null>(null);

  useEffect(() => {
    if (tracks.length === 0) {
      setMode("initial");
    } else if (mode === "initial") {
      setMode("incremental");
    }
  }, [mode, tracks.length]);

  const modeOptions = useMemo(() => {
    if (tracks.length === 0) {
      return [{ value: "initial", label: "Initial organization" }];
    }
    return [
      { value: "incremental", label: "Incremental (assign unassigned WOs)" },
      { value: "reorg", label: "Reorg (full review)" },
    ];
  }, [tracks.length]);

  const trackNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const track of tracks) {
      map.set(track.id, track.name);
    }
    return map;
  }, [tracks]);

  const suggestionTrackById = useMemo(() => {
    const map = new Map<string, string>();
    if (!result) return map;
    for (const track of result.suggestions.tracks) {
      map.set(track.id, track.name);
    }
    return map;
  }, [result]);

  const assignmentGroups = useMemo<AssignmentGroup[]>(() => {
    if (!result) return [];
    const map = new Map<string, string[]>();
    for (const assignment of result.suggestions.assignments) {
      for (const trackId of assignment.track_ids) {
        const list = map.get(trackId) ?? [];
        list.push(assignment.wo_id);
        map.set(trackId, list);
      }
    }
    const groups: AssignmentGroup[] = [];
    for (const [trackId, workOrders] of map) {
      const label =
        suggestionTrackById.get(trackId) ||
        trackNameById.get(trackId) ||
        trackId;
      groups.push({
        trackId,
        trackLabel: label,
        workOrders: workOrders.slice().sort(),
      });
    }
    return groups.sort((a, b) => a.trackLabel.localeCompare(b.trackLabel));
  }, [result, suggestionTrackById, trackNameById]);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const data = await generateTrackOrganizationSuggestions(projectId, mode);
      setResult(data);
      if (data.warnings.length > 0) {
        setNotice(data.warnings.join(" "));
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate track suggestions."
      );
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [mode, projectId]);

  const handleApply = useCallback(async () => {
    if (!result) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const applied = await applyTrackOrganizationSuggestions(
        projectId,
        result.mode,
        result.suggestions
      );
      if (applied.warnings.length > 0) {
        setNotice(applied.warnings.join(" "));
      } else {
        setNotice("Track suggestions applied.");
      }
      setResult(null);
      onApplied();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to apply track suggestions."
      );
    } finally {
      setSaving(false);
    }
  }, [onApplied, projectId, result]);

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Organize tracks</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Run the organizer to propose track groupings and review before applying.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as TrackOrganizationMode)}
            disabled={loading || saving}
          >
            {modeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            onClick={() => void handleGenerate()}
            disabled={loading || saving}
          >
            {loading ? "Generating..." : "Generate"}
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {notice && <div className="badge">{notice}</div>}

      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <div className="badge">Mode: {result.mode}</div>
            <div className="badge">WOs: {result.scope.total_work_orders}</div>
            <div className="badge">Unassigned: {result.scope.unassigned_work_orders}</div>
          </div>

          {result.suggestions.tracks.length > 0 && (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Suggested tracks</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {result.suggestions.tracks.map((track) => (
                  <div key={track.id} className="card" style={{ padding: 10 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 600 }}>{track.name}</span>
                      <span className="badge">{track.status}</span>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {track.id}
                      </span>
                    </div>
                    {track.goal && (
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        Goal: {track.goal}
                      </div>
                    )}
                    {track.parent_track_id && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        Parent: {track.parent_track_id}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.suggestions.recommendations.length > 0 && (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Recommendations</div>
              <div className="card" style={{ padding: 10 }}>
                {result.suggestions.recommendations.map((item, idx) => (
                  <div key={`${item}-${idx}`}>- {item}</div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Assignments</div>
            {assignmentGroups.length === 0 ? (
              <div className="muted">No assignments suggested.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {assignmentGroups.map((group) => (
                  <div key={group.trackId} className="card" style={{ padding: 10 }}>
                    <div style={{ fontWeight: 600 }}>{group.trackLabel}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {renderAssignmentsPreview(group.workOrders)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn"
              onClick={() => void handleApply()}
              disabled={saving}
            >
              {saving ? "Applying..." : "Apply suggestions"}
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => setResult(null)}
              disabled={saving}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
