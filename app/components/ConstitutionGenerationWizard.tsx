"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Scope = "global" | "project";
type InsightCategory = "decision" | "style" | "anti" | "success" | "communication";
type RangePreset =
  | "last_7_days"
  | "last_30_days"
  | "last_90_days"
  | "last_365_days"
  | "all_time"
  | "since_last";

type SourceSelection = {
  claude: boolean;
  codex: boolean;
  pcc: boolean;
};

type SourceStats = {
  source: "claude" | "codex" | "pcc";
  available: number;
  analyzed: number;
  sampled: boolean;
  error?: string;
};

type AnalysisStats = {
  conversations_available: number;
  conversations_analyzed: number;
  patterns_found: number;
  preferences_found: number;
  anti_patterns_found: number;
};

type AnalysisInsight = {
  id: string;
  category: InsightCategory;
  text: string;
  confidence: "high" | "medium" | "low";
  evidence_count: number;
};

type InsightItem = {
  id: string;
  category: InsightCategory;
  text: string;
  confidence: "high" | "medium" | "low";
  evidence_count: number;
  selected: boolean;
  origin: "ai" | "manual";
};

type AnalysisResponse = {
  insights: AnalysisInsight[];
  stats: AnalysisStats;
  sources: SourceStats[];
  warnings: string[];
  fallback: boolean;
};

type SourcesResponse = {
  sources: SourceStats[];
  meta: { last_generated_at: string | null };
  warnings: string[];
};

type DraftResponse = {
  draft: string;
  warnings: string[];
  used_ai: boolean;
};

const STEP_LABELS = [
  "Source Selection",
  "Analysis",
  "Review Insights",
  "Generate Draft",
  "Edit and Save",
];

const SOURCE_LABELS: Record<SourceStats["source"], string> = {
  claude: "Claude Code CLI",
  codex: "Codex CLI",
  pcc: "Project Control Center",
};

const CATEGORY_LABELS: Record<InsightCategory, string> = {
  decision: "Decision Heuristics",
  style: "Style & Taste",
  anti: "Anti-Patterns (Learned Failures)",
  success: "Success Patterns",
  communication: "Communication",
};

const RANGE_OPTIONS: Array<{ value: RangePreset; label: string }> = [
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_90_days", label: "Last 90 days" },
  { value: "last_365_days", label: "Last 12 months" },
  { value: "all_time", label: "All time" },
  { value: "since_last", label: "Since last generation" },
];

function daysAgoIso(days: number): string {
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

function rangeForPreset(preset: RangePreset, lastGeneratedAt: string | null) {
  if (preset === "all_time") {
    return { start: null, end: null };
  }
  if (preset === "since_last") {
    if (lastGeneratedAt) {
      return { start: lastGeneratedAt, end: new Date().toISOString() };
    }
    return { start: daysAgoIso(30), end: new Date().toISOString() };
  }
  if (preset === "last_7_days") return { start: daysAgoIso(7), end: new Date().toISOString() };
  if (preset === "last_90_days") return { start: daysAgoIso(90), end: new Date().toISOString() };
  if (preset === "last_365_days") return { start: daysAgoIso(365), end: new Date().toISOString() };
  return { start: daysAgoIso(30), end: new Date().toISOString() };
}

function sortInsightCategories(a: InsightCategory, b: InsightCategory): number {
  const order: InsightCategory[] = [
    "decision",
    "style",
    "anti",
    "success",
    "communication",
  ];
  return order.indexOf(a) - order.indexOf(b);
}

export function ConstitutionGenerationWizard(props: {
  scope: Scope;
  projectId?: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { scope, projectId, onClose, onSaved } = props;
  const [step, setStep] = useState(0);
  const [selection, setSelection] = useState<SourceSelection>({
    claude: true,
    codex: true,
    pcc: true,
  });
  const [rangePreset, setRangePreset] = useState<RangePreset>("last_30_days");
  const [rangeTouched, setRangeTouched] = useState(false);
  const [sources, setSources] = useState<SourceStats[]>([]);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);
  const [baseWarnings, setBaseWarnings] = useState<string[]>([]);
  const [meta, setMeta] = useState<SourcesResponse["meta"]>({ last_generated_at: null });
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [insights, setInsights] = useState<InsightItem[]>([]);
  const [manualCategory, setManualCategory] = useState<InsightCategory>("style");
  const [manualText, setManualText] = useState("");
  const [draft, setDraft] = useState("");
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftWarnings, setDraftWarnings] = useState<string[]>([]);
  const [finalDraft, setFinalDraft] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [baseConstitution, setBaseConstitution] = useState("");

  const progressPct = Math.round(((step + 1) / STEP_LABELS.length) * 100);
  const sourceById = useMemo(() => {
    const map = new Map(sources.map((entry) => [entry.source, entry]));
    return map;
  }, [sources]);
  const combinedSourceWarnings = useMemo(() => {
    const combined = [...sourceWarnings, ...baseWarnings];
    return Array.from(new Set(combined));
  }, [baseWarnings, sourceWarnings]);

  const groupedInsights = useMemo(() => {
    const groups = new Map<InsightCategory, InsightItem[]>();
    for (const item of insights) {
      const list = groups.get(item.category) ?? [];
      list.push(item);
      groups.set(item.category, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => sortInsightCategories(a, b));
  }, [insights]);

  const acceptedInsights = useMemo(
    () =>
      insights
        .filter((item) => item.selected && item.text.trim())
        .map((item) => ({ category: item.category, text: item.text.trim() })),
    [insights]
  );
  const { fallbackWarnings: draftFallbackWarnings, otherWarnings: draftOtherWarnings } = useMemo(
    () => {
      if (draftWarnings.length === 0) {
        return { fallbackWarnings: [], otherWarnings: [] };
      }
      const fallbackWarnings: string[] = [];
      const otherWarnings: string[] = [];
      for (const warning of draftWarnings) {
        const normalized = warning.toLowerCase();
        if (normalized.includes("falling back to local")) {
          fallbackWarnings.push(warning);
        } else {
          otherWarnings.push(warning);
        }
      }
      return { fallbackWarnings, otherWarnings };
    },
    [draftWarnings]
  );
  const hasSelection = selection.claude || selection.codex || selection.pcc;

  const rangeValue = useMemo(
    () => rangeForPreset(rangePreset, meta.last_generated_at ?? null),
    [rangePreset, meta.last_generated_at]
  );

  const loadSources = useCallback(async () => {
    setSourceWarnings([]);
    setAnalysisError(null);
    try {
      const res = await fetch("/api/constitution/generation/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: scope === "project" ? projectId : null,
          range: rangeValue,
        }),
      });
      const json = (await res.json().catch(() => null)) as SourcesResponse | null;
      if (!res.ok || !json) {
        setSourceWarnings(["Failed to load chat sources."]);
        return;
      }
      setSources(json.sources ?? []);
      setMeta(json.meta ?? { last_generated_at: null });
      setSourceWarnings(json.warnings ?? []);
    } catch (err) {
      setSourceWarnings(["Failed to load chat sources."]);
    }
  }, [projectId, rangeValue, scope]);

  const loadBaseConstitution = useCallback(async () => {
    setBaseWarnings([]);
    const target =
      scope === "project" && projectId
        ? `/api/constitution?projectId=${encodeURIComponent(projectId)}`
        : "/api/constitution";
    try {
      const res = await fetch(target, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as
        | { global: string; local: string | null }
        | null;
      if (!res.ok || !json) {
        setBaseWarnings(["Failed to load constitution."]);
        return;
      }
      if (scope === "project") {
        setBaseConstitution(json.local ?? "");
      } else {
        setBaseConstitution(json.global ?? "");
      }
    } catch (err) {
      setBaseWarnings(["Failed to load constitution."]);
    }
  }, [projectId, scope]);

  useEffect(() => {
    void loadSources();
    void loadBaseConstitution();
  }, [loadSources, loadBaseConstitution]);

  useEffect(() => {
    if (!meta.last_generated_at || rangeTouched) return;
    setRangePreset("since_last");
  }, [meta.last_generated_at, rangeTouched]);

  useEffect(() => {
    setFinalDraft(draft);
  }, [draft]);

  const updateSelection = useCallback((source: SourceStats["source"]) => {
    setSelection((prev) => ({ ...prev, [source]: !prev[source] }));
  }, []);

  const updateInsight = useCallback((id: string, patch: Partial<InsightItem>) => {
    setInsights((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }, []);

  const addManualInsight = useCallback(() => {
    const trimmed = manualText.trim();
    if (!trimmed) return;
    const id = `manual-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    setInsights((prev) => [
      ...prev,
      {
        id,
        category: manualCategory,
        text: trimmed,
        confidence: "low",
        evidence_count: 1,
        selected: true,
        origin: "manual",
      },
    ]);
    setManualText("");
  }, [manualCategory, manualText]);

  const startAnalysis = useCallback(async () => {
    setStep(1);
    setAnalysisLoading(true);
    setAnalysisError(null);
    setAnalysis(null);
    setDraft("");
    setInsights([]);
    setDraftWarnings([]);
    try {
      const res = await fetch("/api/constitution/generation/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: scope === "project" ? projectId : null,
          sources: selection,
          range: rangeValue,
        }),
      });
      const json = (await res.json().catch(() => null)) as AnalysisResponse | null;
      if (!res.ok || !json) {
        throw new Error("Analysis failed.");
      }
      const nextInsights = (json.insights ?? []).map((item) => ({
        ...item,
        selected: true,
        origin: "ai" as const,
      }));
      setAnalysis(json);
      setInsights(nextInsights);
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setAnalysisLoading(false);
    }
  }, [projectId, rangeValue, scope, selection]);

  const startDraftGeneration = useCallback(async () => {
    setStep(3);
    setDraftLoading(true);
    setDraftWarnings([]);
    setSaveNotice(null);
    setSaveError(null);
    try {
      const res = await fetch("/api/constitution/generation/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: scope === "project" ? projectId : null,
          insights: acceptedInsights,
          base: baseConstitution,
        }),
      });
      const json = (await res.json().catch(() => null)) as DraftResponse | null;
      if (!res.ok || !json) {
        throw new Error("Draft generation failed.");
      }
      setDraft(json.draft ?? "");
      setDraftWarnings(json.warnings ?? []);
    } catch (err) {
      setDraftWarnings([err instanceof Error ? err.message : "Draft generation failed."]);
    } finally {
      setDraftLoading(false);
    }
  }, [acceptedInsights, baseConstitution, projectId, scope]);

  const saveDraft = useCallback(async () => {
    if (!finalDraft.trim()) {
      setSaveError("Draft is empty.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    const endpoint =
      scope === "project" && projectId
        ? `/api/repos/${encodeURIComponent(projectId)}/constitution`
        : "/api/constitution/global";
    try {
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: finalDraft }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(json?.error || "Save failed.");
      }
      await fetch("/api/constitution/generation/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: scope === "project" ? projectId : null }),
      }).catch(() => null);
      setSaveNotice("Saved constitution.");
      setBaseConstitution(finalDraft);
      if (onSaved) onSaved();
      void loadSources();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [finalDraft, loadSources, onSaved, projectId, scope]);

  const renderSourceCount = useCallback(
    (source: SourceStats["source"]) => {
      const stat = sourceById.get(source);
      if (!stat) return "Loading...";
      if (stat.error) return `${stat.error}`;
      const sampled = stat.sampled ? " (sampled)" : "";
      return `${stat.available} conversations${sampled}`;
    },
    [sourceById]
  );

  const stepHeader = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <div>
        <h3 style={{ margin: 0 }}>Generate Constitution</h3>
        <div className="muted" style={{ fontSize: 12 }}>
          Guided flow to extract preferences from chat history.
        </div>
      </div>
      <button className="btnSecondary" onClick={onClose}>
        Close
      </button>
    </div>
  );

  const stepper = (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {STEP_LABELS.map((label, index) => (
          <span
            key={label}
            className="badge"
            style={{
              background: index <= step ? "#223061" : undefined,
              borderColor: index <= step ? "#2b5cff" : undefined,
            }}
          >
            {index + 1}. {label}
          </span>
        ))}
      </div>
      <div className="progressTrack">
        <div className="progressFill" style={{ width: `${progressPct}%` }} />
      </div>
    </div>
  );

  const warningsBlock = (warnings: string[]) =>
    warnings.length ? (
      <div className="error">
        {warnings.map((warning) => (
          <div key={warning}>{warning}</div>
        ))}
      </div>
    ) : null;

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {stepHeader}
      {stepper}

      {step === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="field">
            <div className="fieldLabel muted">Select chat sources</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(Object.keys(SOURCE_LABELS) as Array<SourceStats["source"]>).map((source) => (
                <label
                  key={source}
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <input
                    type="checkbox"
                    checked={selection[source]}
                    onChange={() => updateSelection(source)}
                  />
                  <span>{SOURCE_LABELS[source]}</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {renderSourceCount(source)}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="field">
            <div className="fieldLabel muted">Date range</div>
            <select
              className="select"
              value={rangePreset}
              onChange={(e) => {
                setRangePreset(e.target.value as RangePreset);
                setRangeTouched(true);
              }}
            >
              {RANGE_OPTIONS.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={option.value === "since_last" && !meta.last_generated_at}
                >
                  {option.label}
                </option>
              ))}
            </select>
            {meta.last_generated_at && (
              <div className="muted" style={{ fontSize: 12 }}>
                Last generation: {new Date(meta.last_generated_at).toLocaleString()}
              </div>
            )}
          </div>

          {warningsBlock(combinedSourceWarnings)}

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={() => void startAnalysis()} disabled={!hasSelection}>
              Next
            </button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {analysisLoading && <div className="spinner" />}
            <strong>Analyzing chat history...</strong>
          </div>

          {analysisLoading && <div className="loadingBar" />}

          {analysis && (
            <div style={{ display: "grid", gap: 6 }}>
              <div>
                Parsed: {analysis.stats.conversations_analyzed} / {analysis.stats.conversations_available}
              </div>
              <div>Patterns found: {analysis.stats.patterns_found}</div>
              <div>Preferences detected: {analysis.stats.preferences_found}</div>
              <div>Anti-patterns identified: {analysis.stats.anti_patterns_found}</div>
            </div>
          )}

          {analysisError && <div className="error">{analysisError}</div>}
          {analysis?.warnings?.length ? warningsBlock(analysis.warnings) : null}

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btnSecondary" onClick={() => setStep(0)} disabled={analysisLoading}>
              Back
            </button>
            <button
              className="btn"
              onClick={() => setStep(2)}
              disabled={analysisLoading || !analysis}
            >
              Review Insights
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {analysis?.warnings?.length ? warningsBlock(analysis.warnings) : null}
          {analysis?.fallback && (
            <div className="error">
              AI extraction returned limited results. Add manual insights if needed.
            </div>
          )}

          {groupedInsights.length === 0 && (
            <div className="muted">No insights detected yet.</div>
          )}

          {groupedInsights.map(([category, items]) => (
            <div key={category} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <strong>
                {CATEGORY_LABELS[category]} ({items.length} found)
              </strong>
              {items.map((item) => (
                <div
                  key={item.id}
                  className="card"
                  style={{ background: "#101522", borderColor: "#1f2638" }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={() => updateInsight(item.id, { selected: !item.selected })}
                    />
                    <span className="muted" style={{ fontSize: 12 }}>
                      {item.confidence} confidence
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      Evidence: {item.evidence_count}
                    </span>
                    {item.origin === "manual" && (
                      <span className="badge" style={{ fontSize: 11 }}>
                        Manual
                      </span>
                    )}
                  </div>
                  <textarea
                    className="input"
                    rows={2}
                    value={item.text}
                    onChange={(e) => updateInsight(item.id, { text: e.target.value })}
                  />
                </div>
              ))}
            </div>
          ))}

          <div className="card" style={{ background: "#0f1320", borderColor: "#1f2638" }}>
            <div className="fieldLabel muted">Add manual insight</div>
            <div style={{ display: "grid", gap: 8 }}>
              <select
                className="select"
                value={manualCategory}
                onChange={(e) => setManualCategory(e.target.value as InsightCategory)}
              >
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <textarea
                className="input"
                rows={2}
                placeholder="Write a single-sentence insight"
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
              />
              <button className="btnSecondary" onClick={addManualInsight}>
                Add Insight
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btnSecondary" onClick={() => setStep(0)}>
              Back
            </button>
            <button className="btn" onClick={() => void startDraftGeneration()}>
              Generate Draft
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {draftLoading && <div className="spinner" />}
            <strong>Generating draft...</strong>
          </div>
          {draftLoading && <div className="loadingBar" />}
          {draftFallbackWarnings.length > 0 && (
            <div className="notice">
              <strong>Preserving your existing content while merging new insights.</strong>
              <div className="muted" style={{ marginTop: 4 }}>
                Preserved: current constitution text. Added: {acceptedInsights.length} selected
                insight{acceptedInsights.length === 1 ? "" : "s"}.
              </div>
            </div>
          )}
          {draftOtherWarnings.length ? warningsBlock(draftOtherWarnings) : null}
          {!draftLoading && draft && (
            <textarea className="input" rows={10} value={draft} readOnly />
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btnSecondary" onClick={() => setStep(2)} disabled={draftLoading}>
              Back
            </button>
            <button className="btn" onClick={() => setStep(4)} disabled={draftLoading || !draft}>
              Edit and Save
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {saveError && <div className="error">{saveError}</div>}
          {saveNotice && <div className="badge">{saveNotice}</div>}
          <div className="field">
            <div className="fieldLabel muted">Final constitution draft</div>
            <textarea
              className="input"
              rows={18}
              value={finalDraft}
              onChange={(e) => setFinalDraft(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btnSecondary" onClick={() => setStep(3)} disabled={saving}>
              Back
            </button>
            <button className="btn" onClick={() => void saveDraft()} disabled={saving}>
              {saving ? "Saving..." : "Save Constitution"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
