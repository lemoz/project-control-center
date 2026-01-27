"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createTrack,
  deleteTrack,
  listTracks,
  reorderTracks,
  updateTrack,
  type Track,
} from "../../../../lib/api";
import { TrackCard } from "./TrackCard";
import { TrackModal } from "./TrackModal";

type TrackFormValues = {
  name: string;
  description: string;
  goal: string;
  color: string;
};

const END_DROP_ID = "__end__";

function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function moveTrack(
  tracks: Track[],
  sourceId: string,
  targetIndex: number
): Track[] {
  const sourceIndex = tracks.findIndex((track) => track.id === sourceId);
  if (sourceIndex === -1) return tracks;

  const updated = [...tracks];
  const [moved] = updated.splice(sourceIndex, 1);
  const adjustedIndex =
    sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  const clampedIndex = Math.max(0, Math.min(adjustedIndex, updated.length));
  updated.splice(clampedIndex, 0, moved);
  return updated.map((track, index) => ({ ...track, sortOrder: index }));
}

export function TrackList({ projectId }: { projectId: string }) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Track | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const deleteCount = deleteTarget?.workOrderCount ?? 0;
  const modalOpen = createOpen || editingTrack !== null;
  const deleteModalOpen = deleteTarget !== null;

  const loadTracks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listTracks(projectId);
      setTracks(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tracks.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadTracks();
  }, [loadTracks]);

  const handleSave = useCallback(
    async (values: TrackFormValues) => {
      setSaving(true);
      setActionError(null);
      const payload = {
        name: values.name,
        description: normalizeOptionalText(values.description),
        goal: normalizeOptionalText(values.goal),
        color: normalizeOptionalText(values.color),
      };

      try {
        if (editingTrack) {
          await updateTrack(projectId, editingTrack.id, payload);
        } else {
          const nextSortOrder =
            tracks.length > 0
              ? Math.max(...tracks.map((track) => track.sortOrder)) + 1
              : 0;
          await createTrack(projectId, {
            ...payload,
            sortOrder: nextSortOrder,
          });
        }
        await loadTracks();
        setEditingTrack(null);
        setCreateOpen(false);
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "Failed to save track."
        );
      } finally {
        setSaving(false);
      }
    },
    [editingTrack, loadTracks, projectId, tracks]
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setSaving(true);
    setActionError(null);
    try {
      await deleteTrack(projectId, deleteTarget.id);
      setDeleteTarget(null);
      await loadTracks();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to delete track."
      );
    } finally {
      setSaving(false);
    }
  }, [deleteTarget, loadTracks, projectId]);

  const handleReorder = useCallback(
    async (sourceId: string, targetIndex: number) => {
      if (reordering) return;
      const previous = tracks;
      const next = moveTrack(tracks, sourceId, targetIndex);
      if (next === tracks) return;
      setTracks(next);
      setReordering(true);
      setActionError(null);
      try {
        await reorderTracks(projectId, next.map((track) => track.id));
      } catch (err) {
        setTracks(previous);
        setActionError(
          err instanceof Error ? err.message : "Failed to reorder tracks."
        );
      } finally {
        setReordering(false);
      }
    },
    [projectId, reordering, tracks]
  );

  const emptyState = useMemo(() => {
    if (loading) {
      return (
        <div className="card" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="spinner" aria-hidden="true" />
          <span>Loading tracks...</span>
        </div>
      );
    }
    if (error) return null;
    if (tracks.length === 0) {
      return (
        <div className="card">
          <div style={{ fontWeight: 700 }}>No tracks yet</div>
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            Create the first track to organize work orders by strategic goal.
          </div>
        </div>
      );
    }
    return null;
  }, [error, loading, tracks.length]);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section
        className="card"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Tracks</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Drag the handle to reorder tracks, or click a track to edit it.
          </div>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setCreateOpen(true);
            setEditingTrack(null);
            setActionError(null);
          }}
          disabled={saving}
        >
          Create Track
        </button>
      </section>

      {error && <div className="error">{error}</div>}
      {actionError && !modalOpen && !deleteModalOpen && (
        <div className="error">{actionError}</div>
      )}

      {emptyState}

      {!loading && tracks.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {tracks.map((track, index) => (
            <TrackCard
              key={track.id}
              track={track}
              isDragTarget={dragOverId === track.id}
              isDragging={draggedId === track.id}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", track.id);
                setDraggedId(track.id);
              }}
              onDragEnd={() => {
                setDraggedId(null);
                setDragOverId(null);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (dragOverId !== track.id) setDragOverId(track.id);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const sourceId =
                  draggedId ?? event.dataTransfer.getData("text/plain");
                setDraggedId(null);
                setDragOverId(null);
                if (!sourceId || sourceId === track.id) return;
                void handleReorder(sourceId, index);
              }}
              onEdit={() => {
                setEditingTrack(track);
                setCreateOpen(false);
                setActionError(null);
              }}
              onDelete={() => {
                setDeleteTarget(track);
                setActionError(null);
              }}
            />
          ))}
          <div
            onDragOver={(event) => {
              event.preventDefault();
              if (dragOverId !== END_DROP_ID) setDragOverId(END_DROP_ID);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const sourceId =
                draggedId ?? event.dataTransfer.getData("text/plain");
              setDraggedId(null);
              setDragOverId(null);
              if (!sourceId) return;
              void handleReorder(sourceId, tracks.length);
            }}
            style={{
              border: "1px dashed #2b3347",
              borderRadius: 12,
              padding: 12,
              textAlign: "center",
              color: "#a9b0c2",
              background: dragOverId === END_DROP_ID ? "#0f172a" : "transparent",
            }}
          >
            Drop here to move to the end
          </div>
        </div>
      )}

      <TrackModal
        open={modalOpen}
        track={editingTrack}
        onClose={() => {
          setCreateOpen(false);
          setEditingTrack(null);
        }}
        onSave={handleSave}
        saving={saving}
        error={modalOpen ? actionError : null}
      />

      {deleteTarget && (
        <div
          onClick={() => setDeleteTarget(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(5, 7, 12, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
            padding: 16,
          }}
        >
          <div
            className="card"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(520px, 100%)",
              background: "#0f1320",
              borderColor: "#22293a",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700 }}>Delete track</div>
            <div className="muted" style={{ fontSize: 13 }}>
              Deleting <strong>{deleteTarget.name}</strong> will orphan{" "}
              <strong>{deleteCount}</strong> work order{deleteCount === 1 ? "" : "s"}
              . This cannot be undone.
            </div>
            {actionError && <div className="error">{actionError}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                className="btnSecondary"
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void handleDelete()}
                style={{ background: "#ef4444", borderColor: "#ef4444" }}
                disabled={saving}
              >
                {saving ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
