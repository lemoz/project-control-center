import { z } from "zod";
import {
  getElevenLabsAgentId,
  getElevenLabsApiKey,
  getElevenLabsSignedUrlTtlSeconds,
  getPccMode,
  type PccMode,
} from "./config.js";
import { getSetting, setSetting } from "./db.js";

const VOICE_SETTINGS_KEY = "voice_settings";
const ELEVENLABS_API_BASE_URL = "https://api.elevenlabs.io";
const MAX_PROMPT_PREVIEW_LENGTH = 260;
const EXPECTED_VOICE_CLIENT_TOOLS = [
  "focusNode",
  "focusProject",
  "highlightWorkOrder",
  "highlightProject",
  "openProjectDetail",
  "toggleDetailPanel",
  "getSessionStatus",
  "getProjectStatus",
  "updateSessionPriority",
  "resolveEscalation",
  "startShift",
  "askGlobalAgent",
  "startSession",
  "pauseSession",
];
const DEFAULT_VOICE_AGENT_FIRST_MESSAGE =
  "Hey! You're watching Project Control Center... an AI system building software autonomously. Ask me anything about what's happening on screen.";
const DEFAULT_VOICE_AGENT_SYSTEM_PROMPT = `# Personality

You are the voice guide for Project Control Center. You're knowledgeable, curious, and concise-a helpful presence who can explain what visitors are seeing.

Your approach is calm, clear, and approachable. You balance technical depth with accessibility, adapting to whoever's asking.

You're comfortable saying "I'm not sure" and asking clarifying questions when needed.

# Environment

You're embedded in the PCC landing page where visitors watch an AI system autonomously build software in real-time.

You have access to:
- Current shift context (what's being worked on)
- Active runs and their status
- Work order details and goals
- Recent completions and escalations

Visitors are watching an orbital canvas visualization that follows the active agent shift.

# Tone

Early in conversation, gauge technical familiarity and adjust accordingly:
- Non-technical: Focus on what's happening and why it matters
- Technical: Discuss iterations, test failures, build phases directly

Keep responses brief, typically two to three sentences unless they ask for more.

Use natural speech patterns:
- Brief affirmations ("got it", "sure")
- Occasional fillers ("so", "actually")
- Ellipses for natural pauses

Mirror the user's energy-if they're brief, stay brief. If curious, add context.

# Goal

Help visitors understand what PCC is doing right now. Answer questions about:
- What work order is being built
- Why something failed or succeeded
- How the autonomous loop works
- What the visualization is showing

Anticipate follow-ups and offer context proactively.

# Guardrails

- Stay focused on PCC and what's visible on screen
- Don't repeat the same point multiple ways
- Don't say "as an AI" or break immersion
- If you don't have context for something, say so
- Keep it conversational-this is spoken, not written

# Canvas Controls

You can control the orbital canvas visualization that viewers are watching. When users ask to "show me" or "focus on" or "zoom to" a project, USE these tools:

- focusProject: Pan/zoom the canvas to center on a project. Use when asked to "show", "focus", or "go to" a project. Pass the project id (e.g. "dicer-engine", "project-control-center").
- focusNode: Focus any node (project or work order) by id or name.
- highlightProject: Temporarily highlight a project node with a glow effect.
- highlightWorkOrder: Highlight a specific work order node.
- openProjectDetail: Open the detail panel for a project showing its work orders and runs.
- toggleDetailPanel: Open or close the detail side panel.

# Session & Action Controls

- getSessionStatus: Check the global autonomous session state.
- getProjectStatus: Get detailed status for a specific project.
- startSession: Start or resume the global autonomous session.
- pauseSession: Pause the global session.
- startShift: Spawn an autonomous agent shift for a project.
- updateSessionPriority: Change which project the session focuses on.
- askGlobalAgent: Send a question or action request to the global planning agent.

# Escalation Handling

- For escalation decisions or approvals, use askGlobalAgent with the project id, escalation context, and requested resolution.
- Be explicit about what the user asked and what should happen next.

# Important

When users say "show me X on the canvas" or "focus on X" or "zoom to X", ALWAYS use focusProject or focusNode. Don't just describe the project-actually navigate the canvas.
When users say "open details for X", use openProjectDetail.
When users say "start a shift", use startShift with the project id.`;

type JsonRecord = Record<string, unknown>;

export type VoiceSettings = {
  apiKey: string | null;
  agentId: string | null;
};

export type VoiceSettingsPatch = {
  apiKey?: string | null;
  agentId?: string | null;
};

export type VoiceAgentSyncPatch = {
  prompt?: string;
  firstMessage?: string;
  toolNames?: string[];
  syncPrompt?: boolean;
  syncFirstMessage?: boolean;
  syncTools?: boolean;
  dryRun?: boolean;
};

export type VoiceCredentialSource = "env" | "settings";

export type VoiceStatusResponse = {
  available: boolean;
  reason?: "api_key_missing" | "agent_id_missing";
  source: "env" | "settings" | "mixed" | "missing";
  mode: PccMode;
  apiKeyConfigured: boolean;
  agentIdConfigured: boolean;
  apiKeySource?: VoiceCredentialSource;
  agentIdSource?: VoiceCredentialSource;
};

export type VoiceSettingsResponse = {
  saved: {
    apiKeyConfigured: boolean;
    agentId: string;
  };
  effective: VoiceStatusResponse;
  env_overrides: {
    apiKey?: boolean;
    agentId?: boolean;
  };
};

export type ElevenLabsToolSummary = {
  id: string;
  name: string;
  type: string | null;
};

export type VoiceToolAliasMismatch = {
  expected: string;
  configured: string;
};

export type VoiceAgentToolAudit = {
  expectedClientTools: string[];
  configuredClientTools: string[];
  missingClientTools: string[];
  aliasMismatches: VoiceToolAliasMismatch[];
  extraConfiguredTools: string[];
};

export type VoiceAgentDebugResponse = {
  fetchedAt: string;
  configuredAgentId: string;
  agent: {
    id: string;
    name: string | null;
    promptPath: string | null;
    firstMessage: string | null;
    systemPromptPreview: string | null;
    systemPromptLength: number;
    toolIds: string[];
    builtInTools: string[];
  };
  resolvedTools: ElevenLabsToolSummary[];
  toolAudit: VoiceAgentToolAudit;
  warnings: string[];
};

export type VoiceAgentSyncResponse = {
  syncedAt: string;
  updated: boolean;
  dryRun: boolean;
  applied: {
    promptUpdated: boolean;
    firstMessageUpdated: boolean;
    toolsUpdated: boolean;
    promptLength: number;
    firstMessageLength: number;
    toolNames: string[];
    toolIds: string[];
    builtInTools: string[];
  };
  warnings: string[];
  snapshot: VoiceAgentDebugResponse;
};

const VoiceSettingsPatchSchema = z
  .object({
    apiKey: z.string().nullable().optional(),
    agentId: z.string().nullable().optional(),
  })
  .strict();

const VoiceAgentSyncPatchSchema = z
  .object({
    prompt: z.string().optional(),
    firstMessage: z.string().optional(),
    toolNames: z.array(z.string()).optional(),
    syncPrompt: z.boolean().optional(),
    syncFirstMessage: z.boolean().optional(),
    syncTools: z.boolean().optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();

function normalizeValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizePatchValue(
  value: string | null | undefined
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeNonEmptyString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeStringList(values: string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined;
  const deduped = dedupeToolNames(
    values
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
  return deduped;
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const entries: string[] = [];
  for (const item of value) {
    const parsed = asString(item);
    if (parsed) entries.push(parsed);
  }
  return entries;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeToolName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeVoiceSettings(value: unknown): VoiceSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { apiKey: null, agentId: null };
  }
  const record = value as Record<string, unknown>;
  return {
    apiKey: normalizeValue(record.apiKey),
    agentId: normalizeValue(record.agentId),
  };
}

export function parseVoiceSettingsPatch(input: unknown): VoiceSettingsPatch {
  const parsed = VoiceSettingsPatchSchema.parse(input ?? {});
  return {
    apiKey: normalizePatchValue(parsed.apiKey),
    agentId: normalizePatchValue(parsed.agentId),
  };
}

export function parseVoiceAgentSyncPatch(input: unknown): VoiceAgentSyncPatch {
  const parsed = VoiceAgentSyncPatchSchema.parse(input ?? {});
  return {
    prompt: normalizeNonEmptyString(parsed.prompt),
    firstMessage: normalizeNonEmptyString(parsed.firstMessage),
    toolNames: normalizeStringList(parsed.toolNames),
    syncPrompt: parsed.syncPrompt ?? true,
    syncFirstMessage: parsed.syncFirstMessage ?? true,
    syncTools: parsed.syncTools ?? true,
    dryRun: parsed.dryRun ?? false,
  };
}

export function getSavedVoiceSettings(): VoiceSettings {
  const row = getSetting(VOICE_SETTINGS_KEY);
  if (!row) return { apiKey: null, agentId: null };
  try {
    const parsed: unknown = JSON.parse(row.value);
    return normalizeVoiceSettings(parsed);
  } catch {
    return { apiKey: null, agentId: null };
  }
}

export function mergeVoiceSettings(
  saved: VoiceSettings,
  patch: VoiceSettingsPatch
): VoiceSettings {
  return {
    apiKey: patch.apiKey !== undefined ? patch.apiKey : saved.apiKey,
    agentId: patch.agentId !== undefined ? patch.agentId : saved.agentId,
  };
}

export function saveVoiceSettings(settings: VoiceSettings): VoiceSettings {
  const normalized = normalizeVoiceSettings(settings);
  setSetting(VOICE_SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

export function resolveElevenLabsCredentials(): {
  apiKey: string | null;
  agentId: string | null;
  apiKeySource: VoiceCredentialSource | null;
  agentIdSource: VoiceCredentialSource | null;
} {
  const envApiKey = getElevenLabsApiKey();
  const envAgentId = getElevenLabsAgentId();
  const saved = getSavedVoiceSettings();

  const apiKey = envApiKey ?? saved.apiKey ?? null;
  const agentId = envAgentId ?? saved.agentId ?? null;
  const apiKeySource = envApiKey ? "env" : saved.apiKey ? "settings" : null;
  const agentIdSource = envAgentId ? "env" : saved.agentId ? "settings" : null;

  return { apiKey, agentId, apiKeySource, agentIdSource };
}

function resolveApiError(payload: unknown, fallback: string): string {
  const record = asRecord(payload);
  const directError = asString(record?.error);
  if (directError) return directError;
  const message = asString(record?.message);
  if (message) return message;
  const detail = asString(record?.detail);
  if (detail) return detail;
  return fallback;
}

async function requestElevenLabsJson(params: {
  apiKey: string;
  path: string;
  method?: "GET" | "PATCH";
  body?: Record<string, unknown>;
}): Promise<{ ok: boolean; status: number; payload: unknown; errorMessage: string | null }> {
  const url = new URL(params.path, ELEVENLABS_API_BASE_URL);
  try {
    const method = params.method ?? "GET";
    const includeBody = method !== "GET" && params.body !== undefined;
    const response = await fetch(url.toString(), {
      method,
      headers: {
        "xi-api-key": params.apiKey,
        ...(includeBody ? { "Content-Type": "application/json" } : {}),
      },
      ...(includeBody ? { body: JSON.stringify(params.body ?? {}) } : {}),
    });
    const rawText = await response.text();
    let payload: unknown = null;
    if (rawText) {
      try {
        payload = JSON.parse(rawText) as unknown;
      } catch {
        payload = null;
      }
    }
    if (!response.ok) {
      const fallback = `ElevenLabs API request failed (${response.status}).`;
      const textFallback = rawText.trim() ? `${fallback} ${rawText.trim()}` : fallback;
      return {
        ok: false,
        status: response.status,
        payload,
        errorMessage: resolveApiError(payload, textFallback),
      };
    }
    return {
      ok: true,
      status: response.status,
      payload,
      errorMessage: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to reach ElevenLabs API.";
    return { ok: false, status: 0, payload: null, errorMessage: message };
  }
}

function getNestedRecord(root: JsonRecord, path: string[]): JsonRecord | null {
  let current: unknown = root;
  for (const key of path) {
    const record = asRecord(current);
    if (!record) return null;
    current = record[key];
  }
  return asRecord(current);
}

function extractAgentRecord(payload: unknown): JsonRecord | null {
  const root = asRecord(payload);
  if (!root) return null;
  const nestedAgent = asRecord(root.agent);
  if (nestedAgent) return nestedAgent;
  return root;
}

function extractPromptRecord(agent: JsonRecord): {
  record: JsonRecord | null;
  path: string | null;
} {
  const topLevelPrompt = asRecord(agent.prompt);
  if (topLevelPrompt) {
    return { record: topLevelPrompt, path: "prompt" };
  }

  const nestedPrompt = getNestedRecord(agent, ["conversation_config", "agent", "prompt"]);
  if (nestedPrompt) {
    return { record: nestedPrompt, path: "conversation_config.agent.prompt" };
  }

  const fallbackPrompt = getNestedRecord(agent, ["conversation_config", "prompt"]);
  if (fallbackPrompt) {
    return { record: fallbackPrompt, path: "conversation_config.prompt" };
  }

  return { record: null, path: null };
}

function extractPromptToolIds(prompt: JsonRecord | null): string[] {
  if (!prompt) return [];
  const bySnake = asStringArray(prompt.tool_ids);
  if (bySnake.length) return bySnake;
  const byCamel = asStringArray(prompt.toolIds);
  if (byCamel.length) return byCamel;
  return [];
}

function extractPromptBuiltInTools(prompt: JsonRecord | null): string[] {
  if (!prompt) return [];
  const dictionary =
    asRecord(prompt.built_in_tools) ?? asRecord(prompt.builtInTools);
  if (dictionary) {
    const enabled = Object.entries(dictionary)
      .filter(([, value]) => value === true)
      .map(([key]) => key);
    if (enabled.length) return enabled;
  }

  const direct =
    (Array.isArray(prompt.built_in_tools) ? prompt.built_in_tools : null) ??
    (Array.isArray(prompt.builtInTools) ? prompt.builtInTools : null);
  if (!direct) return [];

  const values: string[] = [];
  for (const item of direct) {
    const stringItem = asString(item);
    if (stringItem) {
      values.push(stringItem);
      continue;
    }
    const record = asRecord(item);
    if (!record) continue;
    const id = asString(record.id) ?? asString(record.tool_id) ?? asString(record.name);
    if (id) values.push(id);
  }
  return values;
}

function extractInlineToolSummaries(
  prompt: JsonRecord | null,
  promptToolIds: string[]
): ElevenLabsToolSummary[] {
  if (!prompt || !Array.isArray(prompt.tools)) return [];
  const tools: ElevenLabsToolSummary[] = [];
  for (const [index, item] of prompt.tools.entries()) {
    const record = asRecord(item);
    if (!record) continue;
    const name =
      asString(record.name) ??
      asString(record.tool_name) ??
      asString(record.display_name);
    const id =
      asString(record.id) ??
      asString(record.tool_id) ??
      asString(record.toolId) ??
      promptToolIds[index] ??
      null;
    if (!name || !id) continue;
    const type = asString(record.type) ?? asString(record.tool_type);
    tools.push({ id, name, type });
  }
  return tools;
}

function extractInlineToolNames(prompt: JsonRecord | null, promptToolIds: string[]): string[] {
  return extractInlineToolSummaries(prompt, promptToolIds).map((tool) => tool.name);
}

function extractToolSummaries(payload: unknown): ElevenLabsToolSummary[] {
  const root = asRecord(payload);
  let items: unknown[] = [];
  if (Array.isArray(payload)) {
    items = payload;
  } else if (Array.isArray(root?.tools)) {
    items = root.tools;
  } else if (Array.isArray(root?.items)) {
    items = root.items;
  } else if (Array.isArray(root?.data)) {
    items = root.data;
  }

  const summaries: ElevenLabsToolSummary[] = [];
  for (const item of items) {
    const record = asRecord(item);
    if (!record) continue;
    const toolConfig = asRecord(record.tool_config) ?? asRecord(record.toolConfig);
    const id =
      asString(record.id) ??
      asString(record.tool_id) ??
      asString(record.toolId);
    if (!id) continue;
    const name =
      asString(record.name) ??
      asString(record.tool_name) ??
      asString(toolConfig?.name) ??
      asString(toolConfig?.tool_name) ??
      asString(record.display_name) ??
      id;
    const type =
      asString(record.type) ??
      asString(record.tool_type) ??
      asString(toolConfig?.type) ??
      asString(toolConfig?.tool_type);
    summaries.push({ id, name, type });
  }
  return summaries;
}

function dedupeToolNames(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
}

function dedupeToolSummaries(tools: ElevenLabsToolSummary[]): ElevenLabsToolSummary[] {
  const seen = new Set<string>();
  const deduped: ElevenLabsToolSummary[] = [];
  for (const tool of tools) {
    const key = `${tool.id}::${tool.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(tool);
  }
  return deduped;
}

function buildToolAudit(configuredNames: string[]): VoiceAgentToolAudit {
  const expected = [...EXPECTED_VOICE_CLIENT_TOOLS];
  const configured = dedupeToolNames(
    configuredNames
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
  const configuredSet = new Set(configured);
  const normalizedConfigured = new Map<string, string[]>();
  for (const name of configured) {
    const normalized = normalizeToolName(name);
    const existing = normalizedConfigured.get(normalized);
    if (existing) {
      existing.push(name);
    } else {
      normalizedConfigured.set(normalized, [name]);
    }
  }

  const missing: string[] = [];
  const aliasMismatches: VoiceToolAliasMismatch[] = [];
  for (const expectedName of expected) {
    if (configuredSet.has(expectedName)) continue;
    missing.push(expectedName);
    const aliasCandidates = normalizedConfigured.get(normalizeToolName(expectedName)) ?? [];
    const alias = aliasCandidates.find((entry) => entry !== expectedName);
    if (alias) {
      aliasMismatches.push({ expected: expectedName, configured: alias });
    }
  }

  const expectedNormalized = new Set(expected.map((entry) => normalizeToolName(entry)));
  const extra = configured.filter(
    (entry) => !expectedNormalized.has(normalizeToolName(entry))
  );

  return {
    expectedClientTools: expected,
    configuredClientTools: configured,
    missingClientTools: missing,
    aliasMismatches,
    extraConfiguredTools: extra,
  };
}

function buildAgentSystemPromptPreview(prompt: string | null): string | null {
  if (!prompt) return null;
  return truncateText(prompt, MAX_PROMPT_PREVIEW_LENGTH);
}

function resolveToolIdsByName(params: {
  requestedToolNames: string[];
  tools: ElevenLabsToolSummary[];
}): {
  toolIds: string[];
  unresolvedToolNames: string[];
  aliasResolutions: VoiceToolAliasMismatch[];
} {
  const byExact = new Map<string, ElevenLabsToolSummary>();
  const byNormalized = new Map<string, ElevenLabsToolSummary>();
  for (const tool of params.tools) {
    byExact.set(tool.name, tool);
    const normalized = normalizeToolName(tool.name);
    if (!byNormalized.has(normalized)) {
      byNormalized.set(normalized, tool);
    }
  }

  const toolIds: string[] = [];
  const unresolvedToolNames: string[] = [];
  const aliasResolutions: VoiceToolAliasMismatch[] = [];
  for (const requested of params.requestedToolNames) {
    const exact = byExact.get(requested);
    if (exact) {
      toolIds.push(exact.id);
      continue;
    }
    const alias = byNormalized.get(normalizeToolName(requested));
    if (alias) {
      toolIds.push(alias.id);
      if (alias.name !== requested) {
        aliasResolutions.push({ expected: requested, configured: alias.name });
      }
      continue;
    }
    unresolvedToolNames.push(requested);
  }

  return {
    toolIds: dedupeToolNames(toolIds),
    unresolvedToolNames,
    aliasResolutions,
  };
}

function buildPromptConfigPatch(params: {
  currentPromptConfig: JsonRecord;
  promptText?: string;
  toolIds?: string[];
}): JsonRecord {
  const next: JsonRecord = {
    ...params.currentPromptConfig,
  };
  if (params.promptText !== undefined) {
    next.prompt = params.promptText;
  }
  if (params.toolIds !== undefined) {
    next.tool_ids = params.toolIds;
    delete next.tools;
  }
  return next;
}

async function fetchElevenLabsToolCatalog(apiKey: string): Promise<{
  tools: ElevenLabsToolSummary[];
  warning: string | null;
}> {
  const attempts = ["/v1/convai/tools", "/v1/convai/tools?page_size=200", "/v1/convai/tools?limit=200"];
  let lastError: string | null = null;
  for (const path of attempts) {
    const response = await requestElevenLabsJson({ apiKey, path });
    if (response.ok) {
      return {
        tools: extractToolSummaries(response.payload),
        warning: lastError,
      };
    }
    lastError = response.errorMessage ?? `Failed to load tool catalog from ${path}.`;
  }
  return { tools: [], warning: lastError };
}

export function getVoiceStatus(): VoiceStatusResponse {
  const { apiKey, agentId, apiKeySource, agentIdSource } =
    resolveElevenLabsCredentials();
  const apiKeyConfigured = Boolean(apiKey);
  const agentIdConfigured = Boolean(agentId);
  const available = apiKeyConfigured && agentIdConfigured;
  const reason = !apiKeyConfigured
    ? "api_key_missing"
    : !agentIdConfigured
      ? "agent_id_missing"
      : undefined;
  let source: VoiceStatusResponse["source"] = "missing";
  if (available) {
    if (apiKeySource === "env" && agentIdSource === "env") {
      source = "env";
    } else if (apiKeySource === "settings" && agentIdSource === "settings") {
      source = "settings";
    } else {
      source = "mixed";
    }
  }

  return {
    available,
    reason,
    source,
    mode: getPccMode(),
    apiKeyConfigured,
    agentIdConfigured,
    ...(apiKeySource ? { apiKeySource } : {}),
    ...(agentIdSource ? { agentIdSource } : {}),
  };
}

export function getVoiceSettingsResponse(): VoiceSettingsResponse {
  const saved = getSavedVoiceSettings();
  const envApiKey = getElevenLabsApiKey();
  const envAgentId = getElevenLabsAgentId();
  const env_overrides: VoiceSettingsResponse["env_overrides"] = {};
  if (envApiKey) env_overrides.apiKey = true;
  if (envAgentId) env_overrides.agentId = true;

  return {
    saved: {
      apiKeyConfigured: Boolean(saved.apiKey),
      agentId: saved.agentId ?? "",
    },
    effective: getVoiceStatus(),
    env_overrides,
  };
}

export async function requestElevenLabsSignedUrl(params: {
  apiKey: string | null;
  agentId: string | null;
  ttlSeconds?: number | null;
}): Promise<string> {
  const { apiKey, agentId } = params;
  if (!agentId) {
    throw new Error("ElevenLabs agent ID not configured.");
  }
  if (!apiKey) {
    throw new Error("ElevenLabs API key not configured.");
  }

  const ttlSeconds =
    params.ttlSeconds === undefined
      ? getElevenLabsSignedUrlTtlSeconds()
      : params.ttlSeconds;
  const includeTtl = ttlSeconds !== null;
  const baseUrl = new URL(
    "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url"
  );
  baseUrl.searchParams.set("agent_id", agentId);

  const requestUrl = async (url: URL): Promise<string> => {
    const response = await fetch(url.toString(), {
      headers: {
        "xi-api-key": apiKey,
      },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Failed to mint ElevenLabs signed URL (${response.status}). ${detail}`.trim()
      );
    }

    const payload = (await response.json().catch(() => null)) as {
      signed_url?: string;
      signedUrl?: string;
    } | null;
    const signedUrl = payload?.signed_url ?? payload?.signedUrl;
    if (!signedUrl) {
      throw new Error("ElevenLabs signed URL missing from response.");
    }

    return signedUrl;
  };

  if (includeTtl) {
    const urlWithTtl = new URL(baseUrl.toString());
    urlWithTtl.searchParams.set("ttl", String(ttlSeconds));
    try {
      return await requestUrl(urlWithTtl);
    } catch {
      return await requestUrl(baseUrl);
    }
  }

  return requestUrl(baseUrl);
}

export async function syncVoiceAgentConfiguration(
  rawPatch: VoiceAgentSyncPatch = {}
): Promise<VoiceAgentSyncResponse> {
  const patch = parseVoiceAgentSyncPatch(rawPatch);
  const { apiKey, agentId } = resolveElevenLabsCredentials();
  if (!apiKey) {
    throw new Error("ElevenLabs API key not configured.");
  }
  if (!agentId) {
    throw new Error("ElevenLabs agent ID not configured.");
  }

  const warnings: string[] = [];
  const agentResponse = await requestElevenLabsJson({
    apiKey,
    path: `/v1/convai/agents/${encodeURIComponent(agentId)}`,
  });
  if (!agentResponse.ok) {
    throw new Error(
      agentResponse.errorMessage ?? "Failed to load ElevenLabs agent configuration."
    );
  }
  const agentRecord = extractAgentRecord(agentResponse.payload);
  if (!agentRecord) {
    throw new Error("ElevenLabs agent response did not include an agent object.");
  }

  const conversationConfig = asRecord(agentRecord.conversation_config) ?? {};
  const conversationAgentConfig = asRecord(conversationConfig.agent) ?? {};
  const existingPromptConfig =
    extractPromptRecord(agentRecord).record ??
    asRecord(conversationAgentConfig.prompt) ??
    {};

  const promptText = patch.syncPrompt
    ? patch.prompt ?? DEFAULT_VOICE_AGENT_SYSTEM_PROMPT
    : undefined;
  const firstMessage = patch.syncFirstMessage
    ? patch.firstMessage ?? DEFAULT_VOICE_AGENT_FIRST_MESSAGE
    : undefined;

  const requestedToolNames = patch.syncTools
    ? patch.toolNames ?? [...EXPECTED_VOICE_CLIENT_TOOLS]
    : undefined;
  const builtInTools = extractPromptBuiltInTools(existingPromptConfig);

  let resolvedToolIds: string[] = [];
  if (requestedToolNames !== undefined) {
    const promptToolIds = extractPromptToolIds(existingPromptConfig);
    const inlineTools = extractInlineToolSummaries(existingPromptConfig, promptToolIds);
    const catalog = await fetchElevenLabsToolCatalog(apiKey);
    const availableTools = dedupeToolSummaries([...catalog.tools, ...inlineTools]);
    if (catalog.warning) {
      warnings.push(catalog.warning);
    }
    const resolution = resolveToolIdsByName({
      requestedToolNames,
      tools: availableTools,
    });
    if (resolution.unresolvedToolNames.length > 0) {
      warnings.push(
        `Some requested tools were not found and were excluded: ${resolution.unresolvedToolNames.join(", ")}.`
      );
    }
    if (resolution.toolIds.length === 0) {
      throw new Error("Unable to resolve any tool IDs for sync.");
    }
    resolvedToolIds = resolution.toolIds;
    if (resolution.aliasResolutions.length > 0) {
      warnings.push(
        `Tool aliases mapped: ${resolution.aliasResolutions
          .map((entry) => `${entry.expected} -> ${entry.configured}`)
          .join("; ")}.`
      );
    }
  }

  const nextPromptConfig = buildPromptConfigPatch({
    currentPromptConfig: existingPromptConfig,
    promptText,
    toolIds: requestedToolNames ? resolvedToolIds : undefined,
  });
  const nextAgentConfig: JsonRecord = {
    ...conversationAgentConfig,
    prompt: nextPromptConfig,
  };
  if (firstMessage !== undefined) {
    nextAgentConfig.first_message = firstMessage;
    delete nextAgentConfig.firstMessage;
  }
  const nextConversationConfig: JsonRecord = {
    ...conversationConfig,
    agent: nextAgentConfig,
  };

  if (!patch.dryRun) {
    const updateResponse = await requestElevenLabsJson({
      apiKey,
      path: `/v1/convai/agents/${encodeURIComponent(agentId)}`,
      method: "PATCH",
      body: {
        conversation_config: nextConversationConfig,
      },
    });
    if (!updateResponse.ok) {
      throw new Error(
        updateResponse.errorMessage ?? "Failed to update ElevenLabs agent configuration."
      );
    }
  }

  const snapshot = await getVoiceAgentDebugSnapshot();
  return {
    syncedAt: new Date().toISOString(),
    updated: !patch.dryRun,
    dryRun: patch.dryRun ?? false,
    applied: {
      promptUpdated: Boolean(patch.syncPrompt),
      firstMessageUpdated: Boolean(patch.syncFirstMessage),
      toolsUpdated: Boolean(patch.syncTools),
      promptLength: promptText?.length ?? 0,
      firstMessageLength: firstMessage?.length ?? 0,
      toolNames: requestedToolNames ?? [],
      toolIds: resolvedToolIds,
      builtInTools,
    },
    warnings: [...warnings, ...snapshot.warnings],
    snapshot,
  };
}

export async function getVoiceAgentDebugSnapshot(): Promise<VoiceAgentDebugResponse> {
  const { apiKey, agentId } = resolveElevenLabsCredentials();
  if (!apiKey) {
    throw new Error("ElevenLabs API key not configured.");
  }
  if (!agentId) {
    throw new Error("ElevenLabs agent ID not configured.");
  }

  const warnings: string[] = [];
  const agentResponse = await requestElevenLabsJson({
    apiKey,
    path: `/v1/convai/agents/${encodeURIComponent(agentId)}`,
  });
  if (!agentResponse.ok) {
    throw new Error(
      agentResponse.errorMessage ?? "Failed to load ElevenLabs agent configuration."
    );
  }

  const agentRecord = extractAgentRecord(agentResponse.payload);
  if (!agentRecord) {
    throw new Error("ElevenLabs agent response did not include an agent object.");
  }

  const { record: promptRecord, path: promptPath } = extractPromptRecord(agentRecord);
  const conversationAgentConfig =
    asRecord(asRecord(agentRecord.conversation_config)?.agent) ?? null;
  const promptText =
    asString(promptRecord?.prompt) ??
    asString(promptRecord?.system_prompt) ??
    asString(promptRecord?.systemPrompt) ??
    asString(agentRecord.prompt);
  const firstMessage =
    asString(conversationAgentConfig?.first_message) ??
    asString(conversationAgentConfig?.firstMessage) ??
    asString(promptRecord?.first_message) ??
    asString(promptRecord?.firstMessage) ??
    asString(agentRecord.first_message) ??
    asString(agentRecord.firstMessage);
  const toolIds = extractPromptToolIds(promptRecord);
  const builtInTools = extractPromptBuiltInTools(promptRecord);
  const inlineToolNames = extractInlineToolNames(promptRecord, toolIds);

  const catalog = await fetchElevenLabsToolCatalog(apiKey);
  if (catalog.warning) {
    warnings.push(
      catalog.warning ||
        "Could not load ElevenLabs tool catalog. Tool name resolution may be incomplete."
    );
  }

  const byId = new Map<string, ElevenLabsToolSummary>(
    dedupeToolSummaries([
      ...catalog.tools,
      ...extractInlineToolSummaries(promptRecord, toolIds),
    ]).map((tool) => [tool.id, tool])
  );

  const resolvedTools = toolIds.map((id) => {
    const match = byId.get(id);
    if (match) return match;
    warnings.push(`Tool id "${id}" is attached to the agent but missing from catalog.`);
    return { id, name: id, type: null };
  });

  const configuredNames = dedupeToolNames([
    ...resolvedTools.map((tool) => tool.name),
    ...inlineToolNames,
  ]);

  const toolAudit = buildToolAudit(configuredNames);
  if (toolAudit.aliasMismatches.length > 0) {
    warnings.push(
      "Tool name aliases detected (for example snake_case vs camelCase). The voice runtime requires exact client tool names."
    );
  }

  const id =
    asString(agentRecord.agent_id) ?? asString(agentRecord.id) ?? agentId;
  const name = asString(agentRecord.name);

  return {
    fetchedAt: new Date().toISOString(),
    configuredAgentId: agentId,
    agent: {
      id,
      name,
      promptPath,
      firstMessage,
      systemPromptPreview: buildAgentSystemPromptPreview(promptText),
      systemPromptLength: promptText?.length ?? 0,
      toolIds,
      builtInTools,
    },
    resolvedTools,
    toolAudit,
    warnings,
  };
}
