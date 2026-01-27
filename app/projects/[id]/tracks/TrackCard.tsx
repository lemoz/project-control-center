"use client";

import type { DragEventHandler, MouseEventHandler } from "react";
import type { Track } from "../../../../lib/api";

type TrackCardProps = {
  track: Track;
  isDragTarget: boolean;
  isDragging: boolean;
  onDragStart: DragEventHandler<HTMLDivElement>;
  onDragEnd: DragEventHandler<HTMLDivElement>;
  onDragOver: DragEventHandler<HTMLDivElement>;
  onDrop: DragEventHandler<HTMLDivElement>;
  onEdit: () => void;
  onDelete: () => void;
};

export function TrackCard({
  track,
  isDragTarget,
  isDragging,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onEdit,
  onDelete,
}: TrackCardProps) {
  const handleStop: MouseEventHandler<HTMLButtonElement | HTMLDivElement> = (
    event
  ) => {
    event.stopPropagation();
  };

  return (
    <div
      className="card"
      onClick={onEdit}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        gap: 12,
        alignItems: "center",
        cursor: "pointer",
        borderColor: isDragTarget ? "#2b5cff" : undefined,
        boxShadow: isDragTarget ? "0 0 0 1px rgba(43,92,255,0.5)" : undefined,
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 10 }}
        onClick={handleStop}
        onMouseDown={handleStop}
      >
        <div
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onClick={handleStop}
          onMouseDown={handleStop}
          aria-label="Drag to reorder"
          style={{
            cursor: "grab",
            color: "#6b7280",
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          ⣿
        </div>
        <span
          aria-hidden="true"
          style={{
            width: 18,
            height: 18,
            borderRadius: 6,
            background: track.color ?? "#2b3347",
            border: "1px solid #2b3347",
          }}
        />
      </div>

      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{track.name}</div>
        <div className="desc">{track.description ?? "No description yet."}</div>
        <div className="muted" style={{ fontSize: 12 }}>
          Goal: {track.goal ?? "Not set"}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="badge">{track.workOrderCount ?? 0} WOs</span>
        <button
          className="btnSecondary"
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
          type="button"
        >
          Edit
        </button>
        <button
          className="btnSecondary"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          type="button"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
