"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Scope = "global" | "project";
type InsightScope = "global" | "project";
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
  scope?: InsightScope;
};

type InsightItem = {
  id: string;
  category: InsightCategory;
  text: string;
  confidence: "high" | "medium" | "low";
  evidence_count: number;
  selected: boolean;
  origin: "ai" | "manual";
  scope: InsightScope;
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

type DraftPayload = {
  draft: string;
  warnings: string[];
  used_ai: boolean;
};

type DraftResponse = {
  drafts: {
    global: DraftPayload;
    project: DraftPayload | null;
  };
  warnings?: string[];
};

const STEP_LABELS = [
  "Source Selection",
  "Analysis",
  "Review Insights",
  "Generate Drafts",
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

const SCOPE_LABELS: Record<InsightScope, string> = {
  global: "Global",
  project: "Project",
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

function makeEmptyDraftPayload(): DraftPayload {
  return { draft: "", warnings: [], used_ai: false };
}

function splitDraftWarnings(warnings: string[]) {
  if (warnings.length === 0) {
    return { fallbackWarnings: [], otherWarnings: [] };
  }
  const fallbackWarnings: string[] = [];
  const otherWarnings: string[] = [];
  for (const warning of warnings) {
    const normalized = warning.toLowerCase();
    if (normalized.includes("falling back to local")) {
      fallbackWarnings.push(warning);
    } else {
      otherWarnings.push(warning);
    }
  }
  return { fallbackWarnings, otherWarnings };
}

const NEGATION_WORDS = new Set([
  "avoid",
  "ban",
  "cant",
  "cannot",
  "disallow",
  "dont",
  "exclude",
  "forbid",
  "forbidden",
  "never",
  "no",
  "not",
  "omit",
  "prohibit",
  "prohibited",
  "skip",
  "without",
]);

const ACTION_WORDS = new Set([
  "add",
  "allow",
  "apply",
  "build",
  "call",
  "choose",
  "create",
  "do",
  "ensure",
  "enforce",
  "favor",
  "follow",
  "include",
  "keep",
  "make",
  "prefer",
  "pick",
  "require",
  "rely",
  "stick",
  "use",
]);

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "if",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "over",
  "that",
  "the",
  "their",
  "then",
  "these",
  "this",
  "to",
  "when",
  "with",
  "within",
]);

function tokenizeConflictText(value: string): string[] {
  const normalized = value
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9'\s]+/g, " ")
    .trim();
  return normalized
    .split(/\s+/)
    .map((token) => token.replace(/'/g, ""))
    .filter(Boolean);
}

function normalizeConflictText(value: string): string {
  return tokenizeConflictText(value).join(" ");
}

function normalizeConflictKey(value: string): { key: string; negated: boolean } {
  const tokens = tokenizeConflictText(value);
  const negated = tokens.some((token) => NEGATION_WORDS.has(token));
  const coreTokens = tokens.filter(
    (token) =>
      !NEGATION_WORDS.has(token) && !ACTION_WORDS.has(token) && !STOP_WORDS.has(token)
  );
  const filtered = coreTokens.length
    ? coreTokens
    : tokens.filter((token) => !NEGATION_WORDS.has(token) && !STOP_WORDS.has(token));
  const unique = Array.from(new Set(filtered));
  unique.sort();
  return { key: unique.join(" "), negated };
}

function extractBulletStatements(value: string): string[] {
  const lines = value.split(/\r?\n/);
  const statements: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const match = /^[-*]\s+(.*)$/.exec(line.trim());
    const text = match?.[1]?.trim() ?? "";
    if (!text) continue;
    const normalized = normalizeConflictText(text);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    statements.push(text);
  }
  return statements;
}

function buildConflictMap(
  projectInsights: InsightItem[],
  globalStatements: string[]
): Map<string, string> {
  const globalIndex = new Map<string, Array<{ negated: boolean; statement: string }>>();
  for (const statement of globalStatements) {
    const { key, negated } = normalizeConflictKey(statement);
    if (!key) continue;
    const existing = globalIndex.get(key) ?? [];
    existing.push({ negated, statement });
    globalIndex.set(key, existing);
  }

  const conflicts = new Map<string, string>();
  for (const insight of projectInsights) {
    const { key, negated } = normalizeConflictKey(insight.text);
    if (!key) continue;
    const matches = globalIndex.get(key) ?? [];
    const conflict = matches.find((match) => match.negated !== negated);
    if (conflict) {
      conflicts.set(insight.id, conflict.statement);
    }
  }

  return conflicts;
}

export function ConstitutionGenerationWizard(props: {
  scope: Scope;
  projectId?: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { scope, projectId, onClose, onSaved } = props;
  const hasProjectScope = scope === "project" && Boolean(projectId);
  const defaultInsightScope: InsightScope = hasProjectScope ? "project" : "global";
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
  const [manualScope, setManualScope] = useState<InsightScope>(defaultInsightScope);
  const [manualText, setManualText] = useState("");
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftWarnings, setDraftWarnings] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<{ global: DraftPayload; project: DraftPayload }>(
    () => ({
      global: makeEmptyDraftPayload(),
      project: makeEmptyDraftPayload(),
    })
  );
  const [finalDrafts, setFinalDrafts] = useState({ global: "", project: "" });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [baseGlobal, setBaseGlobal] = useState("");
  const [baseProject, setBaseProject] = useState("");

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
    const groups = new Map<InsightScope, Map<InsightCategory, InsightItem[]>>();
    for (const item of insights) {
      const scopeGroup = groups.get(item.scope) ?? new Map<InsightCategory, InsightItem[]>();
      const list = scopeGroup.get(item.category) ?? [];
      list.push(item);
      scopeGroup.set(item.category, list);
      groups.set(item.scope, scopeGroup);
    }
    const scopeOrder: InsightScope[] = hasProjectScope ? ["global", "project"] : ["global"];
    return scopeOrder.map((scopeKey) => {
      const scopeGroup = groups.get(scopeKey) ?? new Map<InsightCategory, InsightItem[]>();
      const categories = Array.from(scopeGroup.entries()).sort(([a], [b]) =>
        sortInsightCategories(a, b)
      );
      const count = Array.from(scopeGroup.values()).reduce((sum, items) => sum + items.length, 0);
      return { scope: scopeKey, categories, count };
    });
  }, [hasProjectScope, insights]);

  const acceptedInsights = useMemo(
    () =>
      insights
        .filter((item) => item.selected && item.text.trim())
        .map((item) => ({
          category: item.category,
          text: item.text.trim(),
          scope: item.scope,
        })),
    [insights]
  );

  const acceptedCounts = useMemo(
    () => ({
      global: insights.filter(
        (item) => item.selected && item.text.trim() && item.scope === "global"
      ).length,
      project: insights.filter(
        (item) => item.selected && item.text.trim() && item.scope === "project"
      ).length,
    }),
    [insights]
  );
  const shouldSkipProjectDraft =
    hasProjectScope && acceptedCounts.project === 0 && baseProject.trim().length === 0;
  const requiresProjectDraft = hasProjectScope && !shouldSkipProjectDraft;
  const showProjectDraft = hasProjectScope && !shouldSkipProjectDraft;

  const globalStatements = useMemo(() => {
    const baseStatements = extractBulletStatements(baseGlobal);
    const insightStatements = insights
      .filter((item) => item.selected && item.scope === "global" && item.text.trim())
      .map((item) => item.text.trim());
    const combined = [...baseStatements, ...insightStatements];
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const statement of combined) {
      const normalized = normalizeConflictText(statement);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      unique.push(statement);
    }
    return unique;
  }, [baseGlobal, insights]);

  const conflictById = useMemo(() => {
    if (!hasProjectScope) return new Map<string, string>();
    const projectItems = insights.filter(
      (item) => item.scope === "project" && item.text.trim()
    );
    return buildConflictMap(projectItems, globalStatements);
  }, [globalStatements, hasProjectScope, insights]);

  const projectConflicts = useMemo(() => {
    if (!hasProjectScope) return [] as Array<{ id: string; text: string; global: string }>;
    return insights
      .filter((item) => item.selected && item.scope === "project" && item.text.trim())
      .map((item) => ({
        id: item.id,
        text: item.text.trim(),
        global: conflictById.get(item.id) ?? null,
      }))
      .filter(
        (item): item is { id: string; text: string; global: string } => Boolean(item.global)
      );
  }, [conflictById, hasProjectScope, insights]);
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
          projectId: hasProjectScope ? projectId : null,
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
  }, [hasProjectScope, projectId, rangeValue]);

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
        setBaseGlobal(json.global ?? "");
        setBaseProject(json.local ?? "");
      } else {
        setBaseGlobal(json.global ?? "");
        setBaseProject("");
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
    setManualScope(defaultInsightScope);
  }, [defaultInsightScope]);

  useEffect(() => {
    setFinalDrafts({ global: drafts.global.draft, project: drafts.project.draft });
  }, [drafts.global.draft, drafts.project.draft]);

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
        scope: manualScope,
      },
    ]);
    setManualText("");
  }, [manualCategory, manualScope, manualText]);

  const startAnalysis = useCallback(async () => {
    setStep(1);
    setAnalysisLoading(true);
    setAnalysisError(null);
    setAnalysis(null);
    setDrafts({ global: makeEmptyDraftPayload(), project: makeEmptyDraftPayload() });
    setFinalDrafts({ global: "", project: "" });
    setInsights([]);
    setDraftWarnings([]);
    try {
      const res = await fetch("/api/constitution/generation/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: hasProjectScope ? projectId : null,
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
        scope: item.scope ?? defaultInsightScope,
      }));
      setAnalysis(json);
      setInsights(nextInsights);
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setAnalysisLoading(false);
    }
  }, [defaultInsightScope, hasProjectScope, projectId, rangeValue, selection]);

  const startDraftGeneration = useCallback(async () => {
    setStep(3);
    setDraftLoading(true);
    setDraftWarnings([]);
    setDrafts({ global: makeEmptyDraftPayload(), project: makeEmptyDraftPayload() });
    setSaveNotice(null);
    setSaveError(null);
    try {
      const res = await fetch("/api/constitution/generation/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: hasProjectScope ? projectId : null,
          insights: acceptedInsights,
          baseGlobal,
          baseProject,
        }),
      });
      const json = (await res.json().catch(() => null)) as DraftResponse | null;
      if (!res.ok || !json) {
        throw new Error("Draft generation failed.");
      }
      const globalDraft = json.drafts?.global ?? makeEmptyDraftPayload();
      const projectDraft = json.drafts?.project ?? makeEmptyDraftPayload();
      setDrafts({
        global: {
          draft: globalDraft.draft ?? "",
          warnings: globalDraft.warnings ?? [],
          used_ai: globalDraft.used_ai ?? false,
        },
        project: {
          draft: projectDraft.draft ?? "",
          warnings: projectDraft.warnings ?? [],
          used_ai: projectDraft.used_ai ?? false,
        },
      });
      setDraftWarnings(json.warnings ?? []);
    } catch (err) {
      setDraftWarnings([err instanceof Error ? err.message : "Draft generation failed."]);
    } finally {
      setDraftLoading(false);
    }
  }, [acceptedInsights, baseGlobal, baseProject, hasProjectScope, projectId]);

  const saveDraft = useCallback(async () => {
    const globalDraft = finalDrafts.global.trim();
    const projectDraft = finalDrafts.project.trim();
    if (!globalDraft) {
      setSaveError("Global draft is empty.");
      return;
    }
    if (hasProjectScope && acceptedCounts.project > 0 && !projectDraft) {
      setSaveError("Project draft is empty.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      const globalRes = await fetch("/api/constitution/global", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: finalDrafts.global, source: "generator" }),
      });
      const globalJson = (await globalRes.json().catch(() => null)) as { error?: string } | null;
      if (!globalRes.ok) {
        throw new Error(globalJson?.error || "Save failed.");
      }
      let savedProject = false;
      if (
        !shouldSkipProjectDraft &&
        hasProjectScope &&
        projectId &&
        (acceptedCounts.project > 0 || projectDraft)
      ) {
        const projectRes = await fetch(
          `/api/repos/${encodeURIComponent(projectId)}/constitution`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: finalDrafts.project, source: "generator" }),
          }
        );
        const projectJson = (await projectRes.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (!projectRes.ok) {
          throw new Error(projectJson?.error || "Save failed.");
        }
        savedProject = true;
      }
      const completionRequests = [
        fetch("/api/constitution/generation/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: null }),
        }),
      ];
      if (savedProject && projectId) {
        completionRequests.push(
          fetch("/api/constitution/generation/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId }),
          })
        );
      }
      await Promise.all(completionRequests).catch(() => null);
      setSaveNotice(
        savedProject ? "Saved global and project constitutions." : "Saved global constitution."
      );
      setBaseGlobal(finalDrafts.global);
      if (savedProject) {
        setBaseProject(finalDrafts.project);
      }
      if (onSaved) onSaved();
      void loadSources();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [
    acceptedCounts.project,
    finalDrafts.global,
    finalDrafts.project,
    hasProjectScope,
    loadSources,
    onSaved,
    projectId,
    shouldSkipProjectDraft,
  ]);

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
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h3 style={{ margin: 0 }}>Generate Constitution</h3>
          <span className="badge" style={{ fontSize: 11 }}>
            Scope: {hasProjectScope ? "Global + Project" : "Global"}
          </span>
        </div>
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

  const globalDraftWarnings = splitDraftWarnings(drafts.global.warnings);
  const projectDraftWarnings = splitDraftWarnings(drafts.project.warnings);

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

          {insights.length === 0 && (
            <div className="muted">No insights detected yet.</div>
          )}

          {groupedInsights.map((group) => (
            <div key={group.scope} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <strong>{SCOPE_LABELS[group.scope]} Insights</strong>
                <span className="muted" style={{ fontSize: 12 }}>
                  {group.count} total
                </span>
              </div>

              {group.count === 0 && (
                <div className="muted" style={{ fontSize: 12 }}>
                  No insights for this scope yet.
                </div>
              )}

              {group.categories.map(([category, items]) => (
                <div
                  key={`${group.scope}-${category}`}
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <strong>
                    {CATEGORY_LABELS[category]} ({items.length} found)
                  </strong>
                  {items.map((item) => {
                    const conflictStatement = conflictById.get(item.id);
                    return (
                      <div
                        key={item.id}
                        className="card"
                        style={{ background: "#101522", borderColor: "#1f2638" }}
                      >
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
                          {hasProjectScope ? (
                            <select
                              className="select"
                              value={item.scope}
                              onChange={(e) =>
                                updateInsight(item.id, { scope: e.target.value as InsightScope })
                              }
                              style={{ maxWidth: 140 }}
                            >
                              {Object.entries(SCOPE_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="badge" style={{ fontSize: 11 }}>
                              {SCOPE_LABELS[item.scope]}
                            </span>
                          )}
                          {item.origin === "manual" && (
                            <span className="badge" style={{ fontSize: 11 }}>
                              Manual
                            </span>
                          )}
                          {conflictStatement && (
                            <span
                              className="badge"
                              style={{
                                fontSize: 11,
                                background: "#2b1414",
                                borderColor: "#d97777",
                                color: "#f6b5b5",
                              }}
                            >
                              Conflicts with global
                            </span>
                          )}
                        </div>
                        {conflictStatement && (
                          <div className="muted" style={{ fontSize: 12, color: "#f6b5b5" }}>
                            Conflicts with: &quot;{conflictStatement}&quot;
                          </div>
                        )}
                        <textarea
                          className="input"
                          rows={2}
                          value={item.text}
                          onChange={(e) => updateInsight(item.id, { text: e.target.value })}
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}

          <div className="card" style={{ background: "#0f1320", borderColor: "#1f2638" }}>
            <div className="fieldLabel muted">Add manual insight</div>
            <div style={{ display: "grid", gap: 8 }}>
              {hasProjectScope && (
                <select
                  className="select"
                  value={manualScope}
                  onChange={(e) => setManualScope(e.target.value as InsightScope)}
                >
                  {Object.entries(SCOPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
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
          {draftWarnings.length ? warningsBlock(draftWarnings) : null}

          {!draftLoading && (
            <>
              <div className="field">
                <div className="fieldLabel muted">Global constitution draft</div>
                {globalDraftWarnings.fallbackWarnings.length > 0 && (
                  <div className="notice">
                    <strong>Preserving your existing content while merging new insights.</strong>
                    <div className="muted" style={{ marginTop: 4 }}>
                      Preserved: current constitution text. Added: {acceptedCounts.global} selected
                      insight{acceptedCounts.global === 1 ? "" : "s"}.
                    </div>
                  </div>
                )}
                {globalDraftWarnings.otherWarnings.length
                  ? warningsBlock(globalDraftWarnings.otherWarnings)
                  : null}
                {drafts.global.draft ? (
                  <textarea className="input" rows={10} value={drafts.global.draft} readOnly />
                ) : (
                  <div className="muted" style={{ fontSize: 12 }}>
                    No global draft generated yet.
                  </div>
                )}
              </div>

              {hasProjectScope && shouldSkipProjectDraft && (
                <div className="notice">
                  No project insights selected and no project constitution exists yet; skipping the
                  project draft. Only the global constitution will be saved.
                </div>
              )}

              {showProjectDraft && (
                <div className="field">
                  <div className="fieldLabel muted">Project constitution draft</div>
                  {projectDraftWarnings.fallbackWarnings.length > 0 && (
                    <div className="notice">
                      <strong>Preserving your existing content while merging new insights.</strong>
                      <div className="muted" style={{ marginTop: 4 }}>
                        Preserved: current constitution text. Added: {acceptedCounts.project} selected
                        insight{acceptedCounts.project === 1 ? "" : "s"}.
                      </div>
                    </div>
                  )}
                  {projectDraftWarnings.otherWarnings.length
                    ? warningsBlock(projectDraftWarnings.otherWarnings)
                    : null}
                  {drafts.project.draft ? (
                    <textarea className="input" rows={10} value={drafts.project.draft} readOnly />
                  ) : (
                    <div className="muted" style={{ fontSize: 12 }}>
                      No project draft generated yet.
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btnSecondary" onClick={() => setStep(2)} disabled={draftLoading}>
              Back
            </button>
            <button
              className="btn"
              onClick={() => setStep(4)}
              disabled={
                draftLoading ||
                !drafts.global.draft.trim() ||
                (requiresProjectDraft && !drafts.project.draft.trim())
              }
            >
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
            <div className="fieldLabel muted">Global constitution draft</div>
            <textarea
              className="input"
              rows={14}
              value={finalDrafts.global}
              onChange={(e) => setFinalDrafts((prev) => ({ ...prev, global: e.target.value }))}
            />
          </div>
          {hasProjectScope && shouldSkipProjectDraft && (
            <div className="notice">
              No project insights selected and no project constitution exists yet; skipping the
              project draft. Only the global constitution will be saved.
            </div>
          )}
          {showProjectDraft && (
            <div className="field">
              <div className="fieldLabel muted">Project constitution draft</div>
              {projectConflicts.length > 0 && (
                <div className="error">
                  <strong>Project items conflict with global rules.</strong>
                  {projectConflicts.map((conflict) => (
                    <div key={conflict.id}>
                      {conflict.text} vs. {conflict.global}
                    </div>
                  ))}
                </div>
              )}
              <textarea
                className="input"
                rows={14}
                value={finalDrafts.project}
                onChange={(e) => setFinalDrafts((prev) => ({ ...prev, project: e.target.value }))}
              />
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btnSecondary" onClick={() => setStep(3)} disabled={saving}>
              Back
            </button>
            <button className="btn" onClick={() => void saveDraft()} disabled={saving}>
              {saving
                ? "Saving..."
                : hasProjectScope
                  ? showProjectDraft
                    ? "Save Constitutions"
                    : "Save Global Constitution"
                  : "Save Constitution"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
