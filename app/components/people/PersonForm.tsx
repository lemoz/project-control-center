"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import type { Person } from "./types";

export type PersonFormValues = {
  name: string;
  nickname: string;
  company: string;
  role: string;
  notes: string;
  tags: string;
};

type PersonFormProps = {
  person?: Person;
  onSaved?: (person: Person) => void;
  onCancel?: () => void;
  submitLabel?: string;
};

function normalizeOptional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function isErrorResponse(value: unknown): value is { error: string } {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { error?: unknown }).error === "string";
}

export function PersonForm({ person, onSaved, onCancel, submitLabel }: PersonFormProps) {
  const [form, setForm] = useState<PersonFormValues>({
    name: person?.name ?? "",
    nickname: person?.nickname ?? "",
    company: person?.company ?? "",
    role: person?.role ?? "",
    notes: person?.notes ?? "",
    tags: person?.tags?.join(", ") ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (field: keyof PersonFormValues) => (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setError("Name is required.");
      return;
    }

    setSaving(true);
    setError(null);
    const payload = {
      name,
      nickname: normalizeOptional(form.nickname),
      company: normalizeOptional(form.company),
      role: normalizeOptional(form.role),
      notes: normalizeOptional(form.notes),
      tags: parseTags(form.tags),
    };

    const url = person
      ? `/api/people/${encodeURIComponent(person.id)}`
      : "/api/people";
    const method = person ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const responseBody = (await res.json().catch(() => null)) as unknown;
        if (isErrorResponse(responseBody)) {
          setError(responseBody.error);
        } else {
          setError("Failed to save contact.");
        }
        return;
      }
      const responseBody = (await res.json().catch(() => null)) as
        | { person?: Person }
        | null;
      if (responseBody?.person) {
        onSaved?.(responseBody.person);
      }
      if (!person) {
        setForm({
          name: "",
          nickname: "",
          company: "",
          role: "",
          notes: "",
          tags: "",
        });
      }
    } catch {
      setError("Failed to save contact.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {error && <div className="error">{error}</div>}
      <div className="field">
        <label className="fieldLabel" htmlFor="person-name">
          Name
        </label>
        <input
          id="person-name"
          className="input"
          value={form.name}
          onChange={update("name")}
          placeholder="Full name"
        />
      </div>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <div className="field">
          <label className="fieldLabel" htmlFor="person-nickname">
            Nickname
          </label>
          <input
            id="person-nickname"
            className="input"
            value={form.nickname}
            onChange={update("nickname")}
            placeholder="Preferred name"
          />
        </div>
        <div className="field">
          <label className="fieldLabel" htmlFor="person-role">
            Role
          </label>
          <input
            id="person-role"
            className="input"
            value={form.role}
            onChange={update("role")}
            placeholder="Role"
          />
        </div>
        <div className="field">
          <label className="fieldLabel" htmlFor="person-company">
            Company
          </label>
          <input
            id="person-company"
            className="input"
            value={form.company}
            onChange={update("company")}
            placeholder="Company"
          />
        </div>
      </div>
      <div className="field">
        <label className="fieldLabel" htmlFor="person-tags">
          Tags
        </label>
        <input
          id="person-tags"
          className="input"
          value={form.tags}
          onChange={update("tags")}
          placeholder="Comma-separated tags"
        />
      </div>
      <div className="field">
        <label className="fieldLabel" htmlFor="person-notes">
          Notes
        </label>
        <textarea
          id="person-notes"
          className="textarea"
          rows={4}
          value={form.notes}
          onChange={update("notes")}
          placeholder="Add context or conversation notes"
        />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        {onCancel && (
          <button type="button" className="btnSecondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn" disabled={saving}>
          {saving ? "Saving..." : submitLabel ?? (person ? "Save changes" : "Add contact")}
        </button>
      </div>
    </form>
  );
}
