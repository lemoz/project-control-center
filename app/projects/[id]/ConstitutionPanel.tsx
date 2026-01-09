"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CONSTITUTION_TEMPLATE } from "../../constitutionTemplate";
import { ConstitutionGenerationWizard } from "../../components/ConstitutionGenerationWizard";

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

export function ConstitutionPanel({ repoId }: { repoId: string }) {
  const [saved, setSaved] = useState("");
  const [draft, setDraft] = useState("");
  const [globalContent, setGlobalContent] = useState("");
  const [merged, setMerged] = useState("");
  const [hasLocal, setHasLocal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showGenerator, setShowGenerator] = useState(false);

  const dirty = useMemo(() => draft !== saved, [draft, saved]);

  const load = useCallback(async (options?: { preserveNotice?: boolean }) => {
    setLoading(true);
    setError(null);
    if (!options?.preserveNotice) setNotice(null);
    try {
      const res = await fetch(`/api/constitution?projectId=${encodeURIComponent(repoId)}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as ConstitutionResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to load constitution");
      const local = json?.local ?? "";
      setSaved(local);
      setDraft(local);
      setHasLocal(json?.local !== null);
      setGlobalContent(json?.global ?? "");
      setMerged(json?.merged ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load constitution");
    } finally {
      setLoading(false);
    }
  }, [repoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(repoId)}/constitution`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      const json = (await res.json().catch(() => null)) as SaveResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to save constitution");
      setSaved(draft);
      setHasLocal(true);
      setNotice(json?.version ? `Saved (${json.version}).` : "Saved.");
      setTimeout(() => setNotice(null), 2500);
      void load({ preserveNotice: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to save constitution");
    } finally {
      setSaving(false);
    }
  }, [draft, load, repoId]);

  const applyTemplate = useCallback(() => {
    setDraft(CONSTITUTION_TEMPLATE);
  }, []);

  return (
    <>
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>Constitution (Project)</h2>
            <div className="muted" style={{ fontSize: 13 }}>
              Local overrides extend the global constitution for this repo.
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
            {!hasLocal && (
              <div className="muted" style={{ fontSize: 12 }}>
                No project constitution yet. This repo inherits the global constitution.
              </div>
            )}
            <div className="field">
              <div className="fieldLabel muted">Project overrides (Markdown)</div>
              <textarea
                className="input"
                rows={14}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", alignItems: "start" }}>
              <div className="field">
                <div className="fieldLabel muted">Merged preview</div>
                <textarea className="input" rows={10} value={merged} readOnly />
              </div>
              <div className="field">
                <div className="fieldLabel muted">Global base</div>
                <textarea className="input" rows={10} value={globalContent} readOnly />
              </div>
            </div>
          </>
        )}
      </section>

      {showGenerator && (
        <ConstitutionGenerationWizard
          scope="project"
          projectId={repoId}
          onClose={() => setShowGenerator(false)}
          onSaved={() => void load()}
        />
      )}
    </>
  );
}
