"use client";

import { useState } from "react";
import {
  IDENTIFIER_TYPES,
  type PersonIdentifier,
  type PersonIdentifierType,
} from "./types";

type IdentifierManagerProps = {
  personId: string;
  identifiers: PersonIdentifier[];
  onChange: (identifiers: PersonIdentifier[]) => void;
};

function isErrorResponse(value: unknown): value is { error: string } {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { error?: unknown }).error === "string";
}

export function IdentifierManager({ personId, identifiers, onChange }: IdentifierManagerProps) {
  const [type, setType] = useState<PersonIdentifierType>(IDENTIFIER_TYPES[0]);
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async () => {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      setError("Identifier value is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/people/${encodeURIComponent(personId)}/identifiers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          value: trimmedValue,
          label: label.trim() ? label.trim() : null,
        }),
      });
      if (!res.ok) {
        const responseBody = (await res.json().catch(() => null)) as unknown;
        if (isErrorResponse(responseBody)) {
          setError(responseBody.error);
        } else {
          setError("Unable to add identifier.");
        }
        return;
      }
      const responseBody = (await res.json().catch(() => null)) as
        | { identifier?: PersonIdentifier }
        | null;
      if (responseBody?.identifier) {
        onChange([...identifiers, responseBody.identifier]);
        setValue("");
        setLabel("");
      }
    } catch {
      setError("Unable to add identifier.");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (identifierId: string) => {
    setRemovingId(identifierId);
    setError(null);
    try {
      const res = await fetch(
        `/api/people/${encodeURIComponent(personId)}/identifiers/${encodeURIComponent(identifierId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const responseBody = (await res.json().catch(() => null)) as unknown;
        if (isErrorResponse(responseBody)) {
          setError(responseBody.error);
        } else {
          setError("Unable to remove identifier.");
        }
        return;
      }
      onChange(identifiers.filter((identifier) => identifier.id !== identifierId));
    } catch {
      setError("Unable to remove identifier.");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontWeight: 700 }}>Identifiers</div>
      {error && <div className="error">{error}</div>}

      {identifiers.length === 0 && (
        <div className="muted" style={{ fontSize: 13 }}>
          No identifiers added yet.
        </div>
      )}
      {identifiers.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {identifiers.map((identifier) => (
            <div
              key={identifier.id}
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
                  <strong style={{ textTransform: "capitalize" }}>{identifier.type}</strong>: {identifier.value}
                </div>
                {identifier.label && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    {identifier.label}
                  </div>
                )}
              </div>
              <button
                className="btnSecondary"
                onClick={() => handleRemove(identifier.id)}
                disabled={removingId === identifier.id}
              >
                {removingId === identifier.id ? "Removing..." : "Remove"}
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>Add identifier</div>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
          <select className="select" value={type} onChange={(event) => setType(event.target.value as PersonIdentifierType)}>
            {IDENTIFIER_TYPES.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
          <input
            className="input"
            placeholder="Value"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <input
            className="input"
            placeholder="Label (optional)"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
        <button className="btn" onClick={handleAdd} disabled={saving}>
          {saving ? "Adding..." : "Add identifier"}
        </button>
      </div>
    </section>
  );
}
