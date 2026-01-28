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

type ConstitutionVersion = {
  id: string;
  scope: "global" | "project";
  project_id: string | null;
  content: string;
  statements: string[];
  source: string;
  created_at: string;
  active: boolean;
};

type VersionsResponse = {
  versions: ConstitutionVersion[];
  error?: string;
};

type Signal = {
  id: string;
  project_id: string;
  work_order_id: string | null;
  run_id: string | null;
  type: string;
  summary: string;
  tags: string[];
  source: string;
  created_at: string;
};

type SignalsResponse = {
  signals: Signal[];
  error?: string;
};

type InsightCategory = "decision" | "style" | "anti" | "success" | "communication";

type SuggestionStatus = "pending" | "accepted" | "rejected";

type SuggestionEvidence = {
  id: string;
  type: string;
  summary: string;
  created_at: string;
};

type ConstitutionSuggestion = {
  id: string;
  project_id: string;
  scope: "global" | "project";
  category: InsightCategory;
  text: string;
  evidence: SuggestionEvidence[];
  status: SuggestionStatus;
  created_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
};

type SuggestionsResponse = {
  suggestions: ConstitutionSuggestion[];
  warnings?: string[];
  error?: string;
  retry_after_seconds?: number;
  next_allowed_at?: string;
};

const SUGGESTION_CATEGORY_LABELS: Record<InsightCategory, string> = {
  decision: "Decision Heuristics",
  style: "Style & Taste",
  anti: "Anti-Patterns",
  success: "Success Patterns",
  communication: "Communication",
};

export function ConstitutionPanel({ repoId }: { repoId: string }) {
  const [saved, setSaved] = useState("");
  const [draft, setDraft] = useState("");
  const [globalContent, setGlobalContent] = useState("");
  const [merged, setMerged] = useState("");
  const [hasLocal, setHasLocal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState<ConstitutionVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showGenerator, setShowGenerator] = useState(false);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [signalsError, setSignalsError] = useState<string | null>(null);
  const [loadingSignals, setLoadingSignals] = useState(false);
  const [suggestions, setSuggestions] = useState<ConstitutionSuggestion[]>([]);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [suggestionsNotice, setSuggestionsNotice] = useState<string | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [generatingSuggestions, setGeneratingSuggestions] = useState(false);
  const [decidingSuggestionId, setDecidingSuggestionId] = useState<string | null>(null);

  const dirty = useMemo(() => draft !== saved, [draft, saved]);

  const loadVersions = useCallback(async () => {
    setLoadingVersions(true);
    setHistoryError(null);
    try {
      const res = await fetch(
        `/api/constitution/versions?scope=project&projectId=${encodeURIComponent(repoId)}`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => null)) as VersionsResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to load history");
      setVersions(Array.isArray(json?.versions) ? json.versions : []);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : "failed to load history");
    } finally {
      setLoadingVersions(false);
    }
  }, [repoId]);

  const loadSignals = useCallback(async () => {
    setLoadingSignals(true);
    setSignalsError(null);
    try {
      const res = await fetch(
        `/api/repos/${encodeURIComponent(repoId)}/signals?limit=10`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => null)) as SignalsResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to load signals");
      setSignals(Array.isArray(json?.signals) ? json.signals : []);
    } catch (e) {
      setSignalsError(e instanceof Error ? e.message : "failed to load signals");
    } finally {
      setLoadingSignals(false);
    }
  }, [repoId]);

  const loadSuggestions = useCallback(async () => {
    setLoadingSuggestions(true);
    setSuggestionsError(null);
    try {
      const res = await fetch(
        `/api/repos/${encodeURIComponent(repoId)}/constitution/suggestions?limit=30`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => null)) as SuggestionsResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to load suggestions");
      setSuggestions(Array.isArray(json?.suggestions) ? json.suggestions : []);
    } catch (e) {
      setSuggestionsError(e instanceof Error ? e.message : "failed to load suggestions");
    } finally {
      setLoadingSuggestions(false);
    }
  }, [repoId]);

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
      void loadVersions();
      void loadSignals();
      void loadSuggestions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load constitution");
    } finally {
      setLoading(false);
    }
  }, [loadSignals, loadSuggestions, loadVersions, repoId]);

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

  const onGenerateSuggestions = useCallback(async () => {
    setGeneratingSuggestions(true);
    setSuggestionsError(null);
    setSuggestionsNotice(null);
    try {
      const res = await fetch(
        `/api/repos/${encodeURIComponent(repoId)}/constitution/suggestions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const json = (await res.json().catch(() => null)) as SuggestionsResponse | null;
      if (!res.ok) {
        if (res.status === 429 && json?.next_allowed_at) {
          const when = new Date(json.next_allowed_at).toLocaleString();
          throw new Error(`Rate limited. Try again after ${when}.`);
        }
        throw new Error(json?.error || "failed to generate suggestions");
      }
      const created = Array.isArray(json?.suggestions) ? json.suggestions.length : 0;
      const warningText =
        Array.isArray(json?.warnings) && json.warnings.length > 0
          ? ` ${json.warnings.join(" ")}`
          : "";
      setSuggestionsNotice(`Generated ${created} suggestions.${warningText}`);
      void loadSuggestions();
    } catch (e) {
      setSuggestionsError(e instanceof Error ? e.message : "failed to generate suggestions");
    } finally {
      setGeneratingSuggestions(false);
    }
  }, [loadSuggestions, repoId]);

  const decideSuggestion = useCallback(
    async (suggestionId: string, action: "accept" | "reject") => {
      setDecidingSuggestionId(suggestionId);
      setSuggestionsError(null);
      setSuggestionsNotice(null);
      try {
        const res = await fetch(
          `/api/repos/${encodeURIComponent(repoId)}/constitution/suggestions/${encodeURIComponent(
            suggestionId
          )}/${action}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ actor: "user" }),
          }
        );
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) throw new Error(json?.error || `failed to ${action} suggestion`);
        setSuggestionsNotice(action === "accept" ? "Suggestion accepted." : "Suggestion rejected.");
        if (action === "accept") {
          void load({ preserveNotice: true });
        } else {
          void loadSuggestions();
        }
      } catch (e) {
        setSuggestionsError(e instanceof Error ? e.message : `failed to ${action} suggestion`);
      } finally {
        setDecidingSuggestionId(null);
      }
    },
    [load, loadSuggestions, repoId]
  );

  return (
    <>
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>Constitution (Project)</h2>
            <div className="muted" style={{ fontSize: 13 }}>
              Project constitution overrides global when present; otherwise global is used.
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
              <div className="fieldLabel muted">Project constitution (Markdown)</div>
              <textarea
                className="input"
                rows={14}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", alignItems: "start" }}>
              <div className="field">
                <div className="fieldLabel muted">Effective constitution</div>
                <textarea className="input" rows={10} value={merged} readOnly />
              </div>
              <div className="field">
                <div className="fieldLabel muted">Global base</div>
                <textarea className="input" rows={10} value={globalContent} readOnly />
              </div>
            </div>
            <div className="field">
              <div className="fieldLabel muted">History</div>
              {!!historyError && <div className="error">{historyError}</div>}
              {loadingVersions && <div className="muted">Loading history…</div>}
              {!loadingVersions && versions.length === 0 && (
                <div className="muted" style={{ fontSize: 12 }}>
                  No saved versions yet.
                </div>
              )}
              {!loadingVersions &&
                versions.map((version) => {
                  const count = Array.isArray(version.statements)
                    ? version.statements.length
                    : 0;
                  const label = `${
                    version.active ? "Active" : "Saved"
                  } - ${version.created_at} - ${version.source || "unknown"} - ${count} statements`;
                  return (
                    <details key={version.id} style={{ marginBottom: 6 }}>
                      <summary style={{ cursor: "pointer" }}>{label}</summary>
                      <textarea
                        className="input"
                        rows={8}
                        value={version.content ?? ""}
                        readOnly
                      />
                    </details>
                  );
                })}
            </div>
          </>
        )}
      </section>

      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>Signals</h2>
            <div className="muted" style={{ fontSize: 13 }}>
              Recent outcome and decision notes for this project.
            </div>
          </div>
          <button className="btnSecondary" onClick={() => void loadSignals()} disabled={loadingSignals}>
            Refresh
          </button>
        </div>

        {!!signalsError && <div className="error">{signalsError}</div>}
        {loadingSignals && <div className="muted">Loading…</div>}
        {!loadingSignals && signals.length === 0 && (
          <div className="muted" style={{ fontSize: 12 }}>
            No signals yet.
          </div>
        )}
      {!loadingSignals && signals.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {signals.map((signal) => (
              <div
                key={signal.id}
                style={{
                  border: "1px solid #22293a",
                  borderRadius: 12,
                  padding: 12,
                  background: "#0f1320",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span className="badge">{signal.type}</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {signal.created_at}
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    source: {signal.source}
                  </span>
                </div>
                <div>{signal.summary}</div>
                {signal.tags.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {signal.tags.map((tag) => (
                      <span key={tag} className="badge">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {(signal.work_order_id || signal.run_id) && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    {signal.work_order_id ? (
                      <>
                        WO: <code>{signal.work_order_id}</code>
                      </>
                    ) : null}
                    {signal.run_id ? (
                      <>
                        {signal.work_order_id ? " · " : ""}
                        Run: <code>{signal.run_id}</code>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>Constitution Suggestions</h2>
            <div className="muted" style={{ fontSize: 13 }}>
              Review and accept suggestions generated from recent signals.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              className="btnSecondary"
              onClick={() => void loadSuggestions()}
              disabled={loadingSuggestions || generatingSuggestions}
            >
              Refresh
            </button>
            <button
              className="btn"
              onClick={() => void onGenerateSuggestions()}
              disabled={loadingSuggestions || generatingSuggestions}
            >
              {generatingSuggestions ? "Generating…" : "Generate Suggestions"}
            </button>
          </div>
        </div>

        {!!suggestionsError && <div className="error">{suggestionsError}</div>}
        {!!suggestionsNotice && <div className="badge">{suggestionsNotice}</div>}
        {loadingSuggestions && <div className="muted">Loading…</div>}
        {!loadingSuggestions && suggestions.length === 0 && (
          <div className="muted" style={{ fontSize: 12 }}>
            No suggestions yet.
          </div>
        )}
        {!loadingSuggestions && suggestions.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {suggestions.map((suggestion) => {
              const decidedAt =
                suggestion.status === "accepted"
                  ? suggestion.accepted_at
                  : suggestion.status === "rejected"
                    ? suggestion.rejected_at
                    : null;
              const decidedBy =
                suggestion.status === "accepted"
                  ? suggestion.accepted_by
                  : suggestion.status === "rejected"
                    ? suggestion.rejected_by
                    : null;
              const isDeciding = decidingSuggestionId === suggestion.id;
              return (
                <div
                  key={suggestion.id}
                  style={{
                    border: "1px solid #22293a",
                    borderRadius: 12,
                    padding: 12,
                    background: "#0f1320",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span className="badge">{suggestion.status}</span>
                    <span className="badge">{SUGGESTION_CATEGORY_LABELS[suggestion.category]}</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {suggestion.created_at}
                    </span>
                    {decidedAt && (
                      <span className="muted" style={{ fontSize: 12 }}>
                        {suggestion.status === "accepted" ? "Accepted" : "Rejected"}
                        {decidedBy ? ` by ${decidedBy}` : ""} · {decidedAt}
                      </span>
                    )}
                  </div>
                  <div>{suggestion.text}</div>
                  {suggestion.evidence.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div className="muted" style={{ fontSize: 12 }}>
                        Evidence
                      </div>
                      {suggestion.evidence.map((evidence) => (
                        <div
                          key={evidence.id}
                          style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
                        >
                          {evidence.type && <span className="badge">{evidence.type}</span>}
                          <span>{evidence.summary}</span>
                          {evidence.created_at && (
                            <span className="muted" style={{ fontSize: 12 }}>
                              {evidence.created_at}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {suggestion.status === "pending" && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        className="btn"
                        onClick={() => void decideSuggestion(suggestion.id, "accept")}
                        disabled={Boolean(decidingSuggestionId)}
                      >
                        {isDeciding ? "Saving…" : "Accept"}
                      </button>
                      <button
                        className="btnSecondary"
                        onClick={() => void decideSuggestion(suggestion.id, "reject")}
                        disabled={Boolean(decidingSuggestionId)}
                      >
                        {isDeciding ? "Saving…" : "Reject"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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
