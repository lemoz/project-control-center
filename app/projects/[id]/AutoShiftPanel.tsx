"use client";

import { useCallback, useEffect, useState } from "react";

type ProjectAutoShiftResponse = {
  project: {
    id: string;
    name: string;
    auto_shift_enabled: boolean;
  };
  error?: string;
};

export function AutoShiftPanel({ repoId }: { repoId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(repoId)}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as ProjectAutoShiftResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to load project settings");
      setEnabled(Boolean(json?.project?.auto_shift_enabled));
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load project settings");
    } finally {
      setLoading(false);
    }
  }, [repoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (next: boolean) => {
      setSaving(true);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch(`/api/repos/${encodeURIComponent(repoId)}/auto-shift`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auto_shift_enabled: next }),
        });
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) throw new Error(json?.error || "failed to update auto-shift");
        setEnabled(next);
        setNotice("Saved.");
        setTimeout(() => setNotice(null), 2000);
      } catch (e) {
        setError(e instanceof Error ? e.message : "failed to update auto-shift");
      } finally {
        setSaving(false);
      }
    },
    [repoId]
  );

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Automation</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Allow the shift scheduler to start autonomous shifts for this project.
          </div>
        </div>
        <button className="btnSecondary" onClick={() => void load()} disabled={loading || saving}>
          Refresh
        </button>
      </div>

      {!!error && <div className="error">{error}</div>}
      {!!notice && <div className="badge">{notice}</div>}
      {loading && <div className="muted">Loading…</div>}

      {!loading && (
        <div className="field">
          <div className="fieldLabel muted">Auto-shift</div>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={enabled}
              disabled={saving}
              onChange={(e) => void save(e.target.checked)}
            />
            <span>{enabled ? "Enabled" : "Disabled"}</span>
          </label>
        </div>
      )}
    </section>
  );
}
