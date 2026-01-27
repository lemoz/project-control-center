"use client";

import { useEffect, useMemo, useState } from "react";
import type { Track } from "../../../../lib/api";

const TRACK_COLORS = [
  { name: "Gray", hex: "#6B7280" },
  { name: "Red", hex: "#EF4444" },
  { name: "Orange", hex: "#F97316" },
  { name: "Amber", hex: "#F59E0B" },
  { name: "Green", hex: "#10B981" },
  { name: "Teal", hex: "#14B8A6" },
  { name: "Blue", hex: "#3B82F6" },
  { name: "Indigo", hex: "#6366F1" },
  { name: "Purple", hex: "#8B5CF6" },
  { name: "Pink", hex: "#EC4899" },
];

type TrackFormValues = {
  name: string;
  description: string;
  goal: string;
  color: string;
};

type TrackModalProps = {
  open: boolean;
  track: Track | null;
  onClose: () => void;
  onSave: (values: TrackFormValues) => void;
  saving: boolean;
  error: string | null;
};

function normalizeColorInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("#")) return trimmed;
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return `#${trimmed}`;
  }
  return trimmed;
}

function isValidHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

export function TrackModal({
  open,
  track,
  onClose,
  onSave,
  saving,
  error,
}: TrackModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [goal, setGoal] = useState("");
  const [color, setColor] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const defaultColor = TRACK_COLORS[0]?.hex ?? "#6B7280";

  useEffect(() => {
    if (!open) return;
    setName(track?.name ?? "");
    setDescription(track?.description ?? "");
    setGoal(track?.goal ?? "");
    if (track) {
      setColor(track.color ?? "");
    } else {
      setColor(defaultColor);
    }
    setFormError(null);
  }, [open, track, defaultColor]);

  const normalizedColor = useMemo(
    () => normalizeColorInput(color),
    [color]
  );
  const colorPickerValue = isValidHex(normalizedColor)
    ? normalizedColor
    : defaultColor;

  if (!open) return null;

  return (
    <div
      onClick={onClose}
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
          width: "min(720px, 100%)",
          background: "#0f1320",
          borderColor: "#22293a",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {track ? "Edit Track" : "Create Track"}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Define the focus and outcome for this work stream.
            </div>
          </div>
          <button type="button" className="btnSecondary" onClick={onClose}>
            Close
          </button>
        </div>

        {(error || formError) && (
          <div className="error">{formError ?? error}</div>
        )}

        <div className="field">
          <div className="fieldLabel muted">Name</div>
          <input
            className="input"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setFormError(null);
            }}
            placeholder="Track name"
          />
        </div>

        <div className="field">
          <div className="fieldLabel muted">Description</div>
          <textarea
            className="textarea"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this track focuses on"
          />
        </div>

        <div className="field">
          <div className="fieldLabel muted">Goal</div>
          <textarea
            className="textarea"
            rows={2}
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="End state this track builds toward"
          />
        </div>

        <div className="field">
          <div className="fieldLabel muted">Color</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {TRACK_COLORS.map((option) => {
              const isActive = normalizeColorInput(option.hex) === normalizedColor;
              return (
                <button
                  key={option.hex}
                  type="button"
                  onClick={() => setColor(option.hex)}
                  className="btnSecondary"
                  style={{
                    padding: "6px 8px",
                    borderColor: isActive ? option.hex : "#2b3347",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                  aria-label={`${option.name} (${option.hex})`}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 4,
                      background: option.hex,
                    }}
                  />
                  <span style={{ fontSize: 12 }}>{option.name}</span>
                </button>
              );
            })}
            <button
              type="button"
              className="btnSecondary"
              onClick={() => setColor("")}
              style={{ padding: "6px 8px" }}
            >
              Clear
            </button>
          </div>
          <div
            style={{
              marginTop: 8,
              display: "grid",
              gridTemplateColumns: "120px 1fr",
              gap: 8,
              alignItems: "center",
            }}
          >
            <input
              type="color"
              value={colorPickerValue}
              onChange={(event) => setColor(event.target.value)}
              style={{ width: "100%", height: 36, borderRadius: 8, border: "none" }}
              aria-label="Pick a custom color"
            />
            <input
              className="input"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              placeholder="#3B82F6"
            />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btnSecondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const trimmedName = name.trim();
              if (!trimmedName) {
                setFormError("Name is required.");
                return;
              }
              onSave({
                name: trimmedName,
                description,
                goal,
                color: normalizedColor,
              });
            }}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Track"}
          </button>
        </div>
      </div>
    </div>
  );
}
