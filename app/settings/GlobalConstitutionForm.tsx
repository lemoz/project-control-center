"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CONSTITUTION_TEMPLATE } from "../constitutionTemplate";
import { ConstitutionGenerationWizard } from "../components/ConstitutionGenerationWizard";

type ConstitutionResponse = {
  global: string;
  local: string | null;
  merged: string;
  error?: string;
};

type SaveResponse = {
  ok: boolean;
  version: string;
  error?: string;
};

export function GlobalConstitutionForm() {
  const [saved, setSaved] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showGenerator, setShowGenerator] = useState(false);

  const dirty = useMemo(() => draft !== saved, [draft, saved]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/constitution", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ConstitutionResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to load constitution");
      const global = json?.global ?? "";
      setSaved(global);
      setDraft(global);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load constitution");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/constitution/global", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      const json = (await res.json().catch(() => null)) as SaveResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to save constitution");
      setSaved(draft);
      setNotice(json?.version ? `Saved (${json.version}).` : "Saved.");
      setTimeout(() => setNotice(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to save constitution");
    } finally {
      setSaving(false);
    }
  }, [draft]);

  const applyTemplate = useCallback(() => {
    setDraft(CONSTITUTION_TEMPLATE);
  }, []);

  return (
    <>
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>Constitution (Global)</h2>
            <div className="muted" style={{ fontSize: 13 }}>
              Shared preferences and decision heuristics for all projects.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              className="btnSecondary"
              onClick={() => setShowGenerator(true)}
              disabled={loading || saving}
            >
              Generate Constitution
            </button>
            <button className="btnSecondary" onClick={applyTemplate} disabled={loading || saving}>
              Insert template
            </button>
            <button className="btnSecondary" onClick={() => void load()} disabled={loading || saving}>
              Refresh
            </button>
            <button className="btn" onClick={() => void save()} disabled={loading || saving || !dirty}>
              {saving ? "Saving…" : dirty ? "Save" : "Saved"}
            </button>
          </div>
        </div>

        {!!error && <div className="error">{error}</div>}
        {!!notice && <div className="badge">{notice}</div>}
        {loading && <div className="muted">Loading…</div>}

        {!loading && (
          <>
            {!saved && (
              <div className="muted" style={{ fontSize: 12 }}>
                No global constitution yet. Insert the template or write your own.
              </div>
            )}
            <div className="field">
              <div className="fieldLabel muted">Markdown</div>
              <textarea
                className="input"
                rows={18}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
          </>
        )}
      </section>

      {showGenerator && (
        <ConstitutionGenerationWizard
          scope="global"
          onClose={() => setShowGenerator(false)}
          onSaved={() => void load()}
        />
      )}
    </>
  );
}
