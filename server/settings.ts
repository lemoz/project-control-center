import { z } from "zod";
import {
  deleteNetworkWhitelistRow,
  getAgentMonitoringSettingsRow,
  getSetting,
  getShiftSchedulerSettingsRow,
  listNetworkWhitelistRows,
  setAgentMonitoringSettingsRow,
  setSetting,
  setShiftSchedulerSettingsRow,
  upsertNetworkWhitelistRow,
} from "./db.js";
import { readControlMetadata } from "./sidecar.js";

export const PROVIDERS = ["codex", "claude_code", "gemini_cli"] as const;
export type ProviderName = (typeof PROVIDERS)[number];
export const UTILITY_PROVIDERS = ["codex", "claude_cli"] as const;
export type UtilityProviderName = (typeof UTILITY_PROVIDERS)[number];

const DEFAULT_TRUSTED_HOSTS = [
  "github.com",
  "raw.githubusercontent.com",
  "api.github.com",
  "registry.npmjs.org",
  "npmjs.com",
  "pypi.org",
  "files.pythonhosted.org",
  "crates.io",
  "static.crates.io",
  "pkg.go.dev",
  "golang.org",
  "developer.mozilla.org",
];

export type ProviderSettings = {
  provider: ProviderName;
  model: string;
  cliPath: string;
};

export type UtilitySettings = {
  provider: UtilityProviderName;
  model: string;
  cliPath: string;
};

export type ChatSettings = ProviderSettings & {
  trusted_hosts: string[];
};

export type RunnerSettings = {
  builder: ProviderSettings;
  reviewer: ProviderSettings;
  useWorktree: boolean;
  maxBuilderIterations: number;
};

export type ShiftSchedulerSettings = {
  enabled: boolean;
  interval_minutes: number;
  cooldown_minutes: number;
  max_shifts_per_day: number;
  quiet_hours_start: string;
  quiet_hours_end: string;
};

export type AgentType = "builder" | "reviewer" | "shift_agent" | "global_agent";

export type AgentMonitoringSettings = {
  builder: {
    networkAccess: "sandboxed" | "whitelist";
    monitorEnabled: boolean;
    autoKillOnThreat: boolean;
  };
  reviewer: {
    networkAccess: "sandboxed";
    monitorEnabled: boolean;
    autoKillOnThreat: boolean;
  };
  shift_agent: {
    networkAccess: "full";
    monitorEnabled: boolean;
    autoKillOnThreat: boolean;
  };
  global_agent: {
    networkAccess: "full";
    monitorEnabled: boolean;
    autoKillOnThreat: boolean;
  };
};

export type NetworkWhitelistEntry = {
  domain: string;
  enabled: boolean;
  created_at: string;
};

export type RunnerSettingsResponse = {
  saved: RunnerSettings;
  effective: RunnerSettings;
  env_overrides: {
    codex_model?: string;
    codex_path?: string;
    max_builder_iterations?: number;
  };
};

export type UtilitySettingsResponse = {
  saved: UtilitySettings;
  effective: UtilitySettings;
  env_overrides: {
    utility_provider?: UtilityProviderName;
    utility_model?: string;
  };
};

export type ChatSettingsResponse = {
  saved: ChatSettings;
  effective: ChatSettings;
  env_overrides: {
    chat_codex_model?: string;
    chat_codex_path?: string;
    chat_trusted_hosts?: string[];
  };
};

const ProviderNameSchema = z.enum(PROVIDERS);
const UtilityProviderNameSchema = z.enum(UTILITY_PROVIDERS);
const TimeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, {
  message: "time must be HH:MM",
});

const ProviderSettingsSchema = z.object({
  provider: ProviderNameSchema.default("codex"),
  model: z.string().default(""),
  cliPath: z.string().default(""),
});

const UtilitySettingsSchema = z.object({
  provider: UtilityProviderNameSchema.default("codex"),
  model: z.string().default(""),
  cliPath: z.string().default(""),
});

const ChatSettingsSchema = ProviderSettingsSchema.extend({
  trusted_hosts: z.array(z.string()).default([]),
});

const RunnerSettingsSchema = z.object({
  builder: ProviderSettingsSchema,
  reviewer: ProviderSettingsSchema,
  useWorktree: z.boolean().default(true),
  maxBuilderIterations: z.number().int().min(1).max(20).default(10),
});

const ShiftSchedulerSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  interval_minutes: z.number().int().min(1).max(1440).default(120),
  cooldown_minutes: z.number().int().min(0).max(1440).default(30),
  max_shifts_per_day: z.number().int().min(1).max(48).default(6),
  quiet_hours_start: TimeOfDaySchema.default("02:00"),
  quiet_hours_end: TimeOfDaySchema.default("06:00"),
});

const BuilderMonitoringSchema = z.object({
  networkAccess: z.enum(["sandboxed", "whitelist"]).default("sandboxed"),
  monitorEnabled: z.boolean().default(true),
  autoKillOnThreat: z.boolean().default(true),
});

const ReviewerMonitoringSchema = z.object({
  networkAccess: z.literal("sandboxed").default("sandboxed"),
  monitorEnabled: z.boolean().default(true),
  autoKillOnThreat: z.boolean().default(true),
});

const ShiftMonitoringSchema = z.object({
  networkAccess: z.literal("full").default("full"),
  monitorEnabled: z.boolean().default(true),
  autoKillOnThreat: z.boolean().default(true),
});

const AgentMonitoringSettingsSchema = z.object({
  builder: BuilderMonitoringSchema,
  reviewer: ReviewerMonitoringSchema,
  shift_agent: ShiftMonitoringSchema,
  global_agent: ShiftMonitoringSchema,
});

const RunnerSettingsPatchSchema = z
  .object({
    builder: ProviderSettingsSchema.partial().optional(),
    reviewer: ProviderSettingsSchema.partial().optional(),
    useWorktree: z.boolean().optional(),
    maxBuilderIterations: z.number().int().min(1).max(20).optional(),
  })
  .strict();

const AgentMonitoringSettingsPatchSchema = z
  .object({
    builder: BuilderMonitoringSchema.partial().optional(),
    reviewer: ReviewerMonitoringSchema.partial().optional(),
    shift_agent: ShiftMonitoringSchema.partial().optional(),
    global_agent: ShiftMonitoringSchema.partial().optional(),
  })
  .strict();

const ShiftSchedulerSettingsPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    interval_minutes: z.number().int().min(1).max(1440).optional(),
    cooldown_minutes: z.number().int().min(0).max(1440).optional(),
    max_shifts_per_day: z.number().int().min(1).max(48).optional(),
    quiet_hours_start: TimeOfDaySchema.optional(),
    quiet_hours_end: TimeOfDaySchema.optional(),
  })
  .strict();

const UtilitySettingsPatchSchema = z
  .object({
    provider: UtilityProviderNameSchema.optional(),
    model: z.string().optional(),
    cliPath: z.string().optional(),
  })
  .strict();

const SidecarRunnerOverrideSchema = z
  .object({
    builder: ProviderSettingsSchema.partial().optional(),
    reviewer: ProviderSettingsSchema.partial().optional(),
    useWorktree: z.boolean().optional(),
    maxBuilderIterations: z.number().int().min(1).max(20).optional(),
  })
  .passthrough();

const SETTINGS_KEY = "runner_settings";
const CHAT_SETTINGS_KEY = "chat_settings";
const UTILITY_SETTINGS_KEY = "utility_settings";
const UTILITY_PROVIDER_SET = new Set<string>(UTILITY_PROVIDERS);

function defaults(): RunnerSettings {
  return {
    builder: { provider: "codex", model: "", cliPath: "" },
    reviewer: { provider: "codex", model: "", cliPath: "" },
    useWorktree: true,
    maxBuilderIterations: 10,
  };
}

function chatDefaults(): ChatSettings {
  return {
    provider: "codex",
    model: "",
    cliPath: "",
    trusted_hosts: [...DEFAULT_TRUSTED_HOSTS],
  };
}

function utilityDefaults(): UtilitySettings {
  return {
    provider: "codex",
    model: "",
    cliPath: "",
  };
}

function shiftSchedulerDefaults(): ShiftSchedulerSettings {
  return {
    enabled: false,
    interval_minutes: 120,
    cooldown_minutes: 30,
    max_shifts_per_day: 6,
    quiet_hours_start: "02:00",
    quiet_hours_end: "06:00",
  };
}

function monitoringDefaults(): AgentMonitoringSettings {
  return {
    builder: {
      networkAccess: "sandboxed",
      monitorEnabled: true,
      autoKillOnThreat: true,
    },
    reviewer: {
      networkAccess: "sandboxed",
      monitorEnabled: true,
      autoKillOnThreat: true,
    },
    shift_agent: {
      networkAccess: "full",
      monitorEnabled: true,
      autoKillOnThreat: true,
    },
    global_agent: {
      networkAccess: "full",
      monitorEnabled: true,
      autoKillOnThreat: true,
    },
  };
}

function parseHostList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeWhitelistDomain(value: string): string {
  let domain = value.trim().toLowerCase();
  if (!domain) return "";
  if (domain.startsWith("http://")) {
    domain = domain.slice("http://".length);
  } else if (domain.startsWith("https://")) {
    domain = domain.slice("https://".length);
  }
  domain = domain.split("/")[0] ?? "";
  domain = domain.split("?")[0] ?? "";
  domain = domain.split("#")[0] ?? "";
  return domain.trim();
}

function normalizeSettings(value: unknown): RunnerSettings {
  const parsed = RunnerSettingsSchema.safeParse(value ?? {});
  if (parsed.success) return parsed.data;
  const merged = { ...defaults(), ...(typeof value === "object" && value ? value : {}) };
  return RunnerSettingsSchema.parse(merged);
}

function loadSavedSettings(): RunnerSettings {
  const row = getSetting(SETTINGS_KEY);
  if (!row) return defaults();
  try {
    return normalizeSettings(JSON.parse(row.value));
  } catch {
    return defaults();
  }
}

function normalizeChatSettings(value: unknown): ChatSettings {
  const candidate = typeof value === "object" && value ? (value as Record<string, unknown>) : {};
  const trusted_hosts =
    "trusted_hosts" in candidate ? parseHostList(candidate.trusted_hosts) : chatDefaults().trusted_hosts;
  const merged = {
    ...chatDefaults(),
    ...candidate,
    trusted_hosts,
  };
  return ChatSettingsSchema.parse(merged);
}

function normalizeUtilitySettings(value: unknown): UtilitySettings {
  const parsed = UtilitySettingsSchema.safeParse(value ?? {});
  if (parsed.success) return parsed.data;
  const merged = { ...utilityDefaults(), ...(typeof value === "object" && value ? value : {}) };
  return UtilitySettingsSchema.parse(merged);
}

function normalizeShiftSchedulerSettings(value: unknown): ShiftSchedulerSettings {
  const parsed = ShiftSchedulerSettingsSchema.safeParse(value ?? {});
  if (parsed.success) return parsed.data;
  const merged = {
    ...shiftSchedulerDefaults(),
    ...(typeof value === "object" && value ? value : {}),
  };
  return ShiftSchedulerSettingsSchema.parse(merged);
}

function mergeMonitoringSettings(
  base: AgentMonitoringSettings,
  patch: Partial<AgentMonitoringSettings>
): AgentMonitoringSettings {
  return {
    builder: { ...base.builder, ...(patch.builder || {}) },
    reviewer: { ...base.reviewer, ...(patch.reviewer || {}) },
    shift_agent: { ...base.shift_agent, ...(patch.shift_agent || {}) },
    global_agent: { ...base.global_agent, ...(patch.global_agent || {}) },
  };
}

function normalizeAgentMonitoringSettings(value: unknown): AgentMonitoringSettings {
  const parsed = AgentMonitoringSettingsSchema.safeParse(value ?? {});
  if (parsed.success) return parsed.data;
  const merged = mergeMonitoringSettings(
    monitoringDefaults(),
    typeof value === "object" && value ? (value as Partial<AgentMonitoringSettings>) : {}
  );
  return AgentMonitoringSettingsSchema.parse(merged);
}

function loadSavedChatSettings(): ChatSettings {
  const row = getSetting(CHAT_SETTINGS_KEY);
  if (!row) return chatDefaults();
  try {
    return normalizeChatSettings(JSON.parse(row.value));
  } catch {
    return chatDefaults();
  }
}

function loadSavedUtilitySettings(): UtilitySettings {
  const row = getSetting(UTILITY_SETTINGS_KEY);
  if (!row) return utilityDefaults();
  try {
    return normalizeUtilitySettings(JSON.parse(row.value));
  } catch {
    return utilityDefaults();
  }
}

function loadSavedShiftSchedulerSettings(): ShiftSchedulerSettings {
  const row = getShiftSchedulerSettingsRow();
  return normalizeShiftSchedulerSettings({
    enabled: row.enabled === 1,
    interval_minutes: row.interval_minutes,
    cooldown_minutes: row.cooldown_minutes,
    max_shifts_per_day: row.max_shifts_per_day,
    quiet_hours_start: row.quiet_hours_start,
    quiet_hours_end: row.quiet_hours_end,
  });
}

function loadSavedAgentMonitoringSettings(): AgentMonitoringSettings {
  const row = getAgentMonitoringSettingsRow();
  return normalizeAgentMonitoringSettings({
    builder: {
      networkAccess: row.builder_network_access,
      monitorEnabled: row.builder_monitor_enabled === 1,
      autoKillOnThreat: row.builder_auto_kill_on_threat === 1,
    },
    reviewer: {
      networkAccess: row.reviewer_network_access,
      monitorEnabled: row.reviewer_monitor_enabled === 1,
      autoKillOnThreat: row.reviewer_auto_kill_on_threat === 1,
    },
    shift_agent: {
      networkAccess: row.shift_agent_network_access,
      monitorEnabled: row.shift_agent_monitor_enabled === 1,
      autoKillOnThreat: row.shift_agent_auto_kill_on_threat === 1,
    },
    global_agent: {
      networkAccess: row.global_agent_network_access,
      monitorEnabled: row.global_agent_monitor_enabled === 1,
      autoKillOnThreat: row.global_agent_auto_kill_on_threat === 1,
    },
  });
}

function saveChatSettings(settings: ChatSettings): ChatSettings {
  const normalized = normalizeChatSettings(settings);
  setSetting(CHAT_SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

function saveUtilitySettings(settings: UtilitySettings): UtilitySettings {
  const normalized = normalizeUtilitySettings(settings);
  setSetting(UTILITY_SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

function saveShiftSchedulerSettings(
  settings: ShiftSchedulerSettings
): ShiftSchedulerSettings {
  const normalized = normalizeShiftSchedulerSettings(settings);
  setShiftSchedulerSettingsRow({
    enabled: normalized.enabled ? 1 : 0,
    interval_minutes: normalized.interval_minutes,
    cooldown_minutes: normalized.cooldown_minutes,
    max_shifts_per_day: normalized.max_shifts_per_day,
    quiet_hours_start: normalized.quiet_hours_start,
    quiet_hours_end: normalized.quiet_hours_end,
  });
  return normalized;
}

function saveAgentMonitoringSettings(
  settings: AgentMonitoringSettings
): AgentMonitoringSettings {
  const normalized = normalizeAgentMonitoringSettings(settings);
  setAgentMonitoringSettingsRow({
    id: "global",
    builder_network_access: normalized.builder.networkAccess,
    builder_monitor_enabled: normalized.builder.monitorEnabled ? 1 : 0,
    builder_auto_kill_on_threat: normalized.builder.autoKillOnThreat ? 1 : 0,
    reviewer_network_access: normalized.reviewer.networkAccess,
    reviewer_monitor_enabled: normalized.reviewer.monitorEnabled ? 1 : 0,
    reviewer_auto_kill_on_threat: normalized.reviewer.autoKillOnThreat ? 1 : 0,
    shift_agent_network_access: normalized.shift_agent.networkAccess,
    shift_agent_monitor_enabled: normalized.shift_agent.monitorEnabled ? 1 : 0,
    shift_agent_auto_kill_on_threat: normalized.shift_agent.autoKillOnThreat ? 1 : 0,
    global_agent_network_access: normalized.global_agent.networkAccess,
    global_agent_monitor_enabled: normalized.global_agent.monitorEnabled ? 1 : 0,
    global_agent_auto_kill_on_threat: normalized.global_agent.autoKillOnThreat ? 1 : 0,
  });
  return normalized;
}

function saveSettings(settings: RunnerSettings): RunnerSettings {
  const normalized = normalizeSettings(settings);
  setSetting(SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

function applyEnvOverrides(settings: RunnerSettings): RunnerSettingsResponse["env_overrides"] & {
  effective: RunnerSettings;
} {
  const codex_model = process.env.CONTROL_CENTER_CODEX_MODEL || process.env.CODEX_MODEL || undefined;
  const codex_path = process.env.CONTROL_CENTER_CODEX_PATH || undefined;
  const max_builder_iterations_raw =
    process.env.CONTROL_CENTER_MAX_BUILDER_ITERATIONS ||
    process.env.CONTROL_CENTER_MAX_RUN_ITERATIONS ||
    undefined;
  const max_builder_iterations_value = max_builder_iterations_raw
    ? Math.trunc(Number(max_builder_iterations_raw))
    : NaN;
  const max_builder_iterations =
    Number.isFinite(max_builder_iterations_value) && max_builder_iterations_value >= 1
      ? Math.min(max_builder_iterations_value, 20)
      : undefined;

  const apply = (s: ProviderSettings): ProviderSettings => {
    if (s.provider !== "codex") return s;
    return {
      ...s,
      model: codex_model ?? s.model,
      cliPath: codex_path ?? s.cliPath,
    };
  };

  return {
    codex_model,
    codex_path,
    max_builder_iterations,
    effective: {
      builder: apply(settings.builder),
      reviewer: apply(settings.reviewer),
      useWorktree: settings.useWorktree,
      maxBuilderIterations: max_builder_iterations ?? settings.maxBuilderIterations,
    },
  };
}

function applyChatEnvOverrides(settings: ChatSettings): ChatSettingsResponse["env_overrides"] & {
  effective: ChatSettings;
} {
  const chat_codex_model =
    process.env.CONTROL_CENTER_CHAT_CODEX_MODEL ||
    process.env.CONTROL_CENTER_CODEX_MODEL ||
    process.env.CODEX_MODEL ||
    undefined;
  const chat_codex_path =
    process.env.CONTROL_CENTER_CHAT_CODEX_PATH ||
    process.env.CONTROL_CENTER_CODEX_PATH ||
    undefined;
  const chat_trusted_hosts_raw = process.env.CONTROL_CENTER_CHAT_TRUSTED_HOSTS || undefined;
  const chat_trusted_hosts = chat_trusted_hosts_raw
    ? parseHostList(chat_trusted_hosts_raw)
    : undefined;

  const base: ChatSettings = {
    ...settings,
    trusted_hosts: chat_trusted_hosts ?? settings.trusted_hosts,
  };

  if (settings.provider !== "codex") {
    return {
      chat_codex_model,
      chat_codex_path,
      chat_trusted_hosts,
      effective: base,
    };
  }

  return {
    chat_codex_model,
    chat_codex_path,
    chat_trusted_hosts,
    effective: {
      ...base,
      model: chat_codex_model ?? base.model,
      cliPath: chat_codex_path ?? base.cliPath,
    },
  };
}

function applyUtilityEnvOverrides(settings: UtilitySettings): UtilitySettingsResponse["env_overrides"] & {
  effective: UtilitySettings;
} {
  const utility_provider_raw = process.env.CONTROL_CENTER_UTILITY_PROVIDER || "";
  const providerNormalized = utility_provider_raw.trim().toLowerCase();
  const utility_provider = UTILITY_PROVIDER_SET.has(providerNormalized)
    ? (providerNormalized as UtilityProviderName)
    : undefined;
  const utility_model_raw = process.env.CONTROL_CENTER_UTILITY_MODEL || "";
  const utility_model = utility_model_raw.trim() ? utility_model_raw.trim() : undefined;

  const provider = utility_provider ?? settings.provider;
  const model = utility_model ?? settings.model;
  const cliPath = settings.cliPath;

  return {
    utility_provider,
    utility_model,
    effective: {
      provider,
      model,
      cliPath,
    },
  };
}

function applySidecarOverrides(repoPath: string, settings: RunnerSettings): RunnerSettings {
  const meta = readControlMetadata(repoPath) as unknown;
  if (!meta || typeof meta !== "object") return settings;

  const candidate = (() => {
    const record = meta as Record<string, unknown>;
    if (record.runner && typeof record.runner === "object") return record.runner;
    if (record.runner_settings && typeof record.runner_settings === "object") return record.runner_settings;
    return null;
  })();
  if (!candidate) return settings;

  const parsed = SidecarRunnerOverrideSchema.safeParse(candidate);
  if (!parsed.success) return settings;

  const override = parsed.data;
  return normalizeSettings({
    ...settings,
    ...(override.useWorktree !== undefined ? { useWorktree: override.useWorktree } : {}),
    ...(override.maxBuilderIterations !== undefined
      ? { maxBuilderIterations: override.maxBuilderIterations }
      : {}),
    builder: { ...settings.builder, ...(override.builder || {}) },
    reviewer: { ...settings.reviewer, ...(override.reviewer || {}) },
  });
}

export function getRunnerSettingsResponse(): RunnerSettingsResponse {
  const saved = loadSavedSettings();
  const env = applyEnvOverrides(saved);
  return {
    saved,
    effective: env.effective,
    env_overrides: {
      codex_model: env.codex_model,
      codex_path: env.codex_path,
      max_builder_iterations: env.max_builder_iterations,
    },
  };
}

export function patchRunnerSettings(input: unknown): RunnerSettingsResponse {
  const saved = loadSavedSettings();
  const patch = RunnerSettingsPatchSchema.parse(input ?? {});
  const merged = normalizeSettings({
    ...saved,
    ...(patch.useWorktree !== undefined ? { useWorktree: patch.useWorktree } : {}),
    ...(patch.maxBuilderIterations !== undefined
      ? { maxBuilderIterations: patch.maxBuilderIterations }
      : {}),
    builder: { ...saved.builder, ...(patch.builder || {}) },
    reviewer: { ...saved.reviewer, ...(patch.reviewer || {}) },
  });

  // v0: only Codex is runnable, but we still store other providers if set.
  const stored = saveSettings(merged);
  const env = applyEnvOverrides(stored);
  return {
    saved: stored,
    effective: env.effective,
    env_overrides: {
      codex_model: env.codex_model,
      codex_path: env.codex_path,
      max_builder_iterations: env.max_builder_iterations,
    },
  };
}

export function resolveRunnerSettingsForRepo(repoPath: string): RunnerSettingsResponse {
  const saved = loadSavedSettings();
  const repoMerged = applySidecarOverrides(repoPath, saved);
  const env = applyEnvOverrides(repoMerged);
  return {
    saved: repoMerged,
    effective: env.effective,
    env_overrides: {
      codex_model: env.codex_model,
      codex_path: env.codex_path,
      max_builder_iterations: env.max_builder_iterations,
    },
  };
}

export function getUtilitySettingsResponse(): UtilitySettingsResponse {
  const saved = loadSavedUtilitySettings();
  const env = applyUtilityEnvOverrides(saved);
  return {
    saved,
    effective: env.effective,
    env_overrides: {
      utility_provider: env.utility_provider,
      utility_model: env.utility_model,
    },
  };
}

export function patchUtilitySettings(input: unknown): UtilitySettingsResponse {
  const saved = loadSavedUtilitySettings();
  const patch = UtilitySettingsPatchSchema.parse(input ?? {});
  const merged = normalizeUtilitySettings({ ...saved, ...patch });
  const stored = saveUtilitySettings(merged);
  const env = applyUtilityEnvOverrides(stored);
  return {
    saved: stored,
    effective: env.effective,
    env_overrides: {
      utility_provider: env.utility_provider,
      utility_model: env.utility_model,
    },
  };
}

export function resolveUtilitySettings(): UtilitySettingsResponse {
  return getUtilitySettingsResponse();
}

export function getShiftSchedulerSettings(): ShiftSchedulerSettings {
  return loadSavedShiftSchedulerSettings();
}

export function patchShiftSchedulerSettings(input: unknown): ShiftSchedulerSettings {
  const saved = loadSavedShiftSchedulerSettings();
  const patch = ShiftSchedulerSettingsPatchSchema.parse(input ?? {});
  const merged = normalizeShiftSchedulerSettings({ ...saved, ...patch });
  return saveShiftSchedulerSettings(merged);
}

export function getAgentMonitoringSettings(): AgentMonitoringSettings {
  return loadSavedAgentMonitoringSettings();
}

export function patchAgentMonitoringSettings(input: unknown): AgentMonitoringSettings {
  const saved = loadSavedAgentMonitoringSettings();
  const patch = AgentMonitoringSettingsPatchSchema.parse(input ?? {});
  const merged = normalizeAgentMonitoringSettings(
    mergeMonitoringSettings(saved, patch as Partial<AgentMonitoringSettings>)
  );
  return saveAgentMonitoringSettings(merged);
}

export function getMonitoringSettings(
  agentType: AgentType
): AgentMonitoringSettings[AgentType] {
  const settings = loadSavedAgentMonitoringSettings();
  return settings[agentType];
}

export function listNetworkWhitelistEntries(): NetworkWhitelistEntry[] {
  return listNetworkWhitelistRows().map((row) => ({
    domain: row.domain,
    enabled: row.enabled === 1,
    created_at: row.created_at,
  }));
}

export function upsertNetworkWhitelistEntry(input: {
  domain?: string;
  enabled?: boolean;
}): NetworkWhitelistEntry {
  const rawDomain = typeof input.domain === "string" ? input.domain : "";
  const domain = normalizeWhitelistDomain(rawDomain);
  if (!domain) {
    throw new Error("domain is required");
  }
  const enabled = typeof input.enabled === "boolean" ? input.enabled : true;
  const row = upsertNetworkWhitelistRow({
    domain,
    enabled: enabled ? 1 : 0,
  });
  return {
    domain: row.domain,
    enabled: row.enabled === 1,
    created_at: row.created_at,
  };
}

export function deleteNetworkWhitelistEntry(domainInput: string): boolean {
  const domain = normalizeWhitelistDomain(domainInput);
  if (!domain) {
    throw new Error("domain is required");
  }
  return deleteNetworkWhitelistRow(domain);
}

export function getChatSettingsResponse(): ChatSettingsResponse {
  const saved = loadSavedChatSettings();
  const env = applyChatEnvOverrides(saved);
  return {
    saved,
    effective: env.effective,
    env_overrides: {
      chat_codex_model: env.chat_codex_model,
      chat_codex_path: env.chat_codex_path,
      chat_trusted_hosts: env.chat_trusted_hosts,
    },
  };
}

export function patchChatSettings(input: unknown): ChatSettingsResponse {
  const saved = loadSavedChatSettings();
  const patch = typeof input === "object" && input ? (input as Record<string, unknown>) : {};
  const merged = normalizeChatSettings({ ...saved, ...patch });
  const stored = saveChatSettings(merged);
  const env = applyChatEnvOverrides(stored);
  return {
    saved: stored,
    effective: env.effective,
    env_overrides: {
      chat_codex_model: env.chat_codex_model,
      chat_codex_path: env.chat_codex_path,
      chat_trusted_hosts: env.chat_trusted_hosts,
    },
  };
}

export function resolveChatSettings(): ChatSettingsResponse {
  return getChatSettingsResponse();
}
