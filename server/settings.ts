import { z } from "zod";
import { getSetting, setSetting } from "./db.js";
import { readControlMetadata } from "./sidecar.js";

export const PROVIDERS = ["codex", "claude_code", "gemini_cli"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

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

export type ChatSettings = ProviderSettings & {
  trusted_hosts: string[];
};

export type RunnerSettings = {
  builder: ProviderSettings;
  reviewer: ProviderSettings;
  useWorktree: boolean;
  maxBuilderIterations: number;
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

const ProviderSettingsSchema = z.object({
  provider: ProviderNameSchema.default("codex"),
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
  maxBuilderIterations: z.number().int().min(1).max(20).default(3),
});

const RunnerSettingsPatchSchema = z
  .object({
    builder: ProviderSettingsSchema.partial().optional(),
    reviewer: ProviderSettingsSchema.partial().optional(),
    useWorktree: z.boolean().optional(),
    maxBuilderIterations: z.number().int().min(1).max(20).optional(),
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

function defaults(): RunnerSettings {
  return {
    builder: { provider: "codex", model: "", cliPath: "" },
    reviewer: { provider: "codex", model: "", cliPath: "" },
    useWorktree: true,
    maxBuilderIterations: 3,
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

function loadSavedChatSettings(): ChatSettings {
  const row = getSetting(CHAT_SETTINGS_KEY);
  if (!row) return chatDefaults();
  try {
    return normalizeChatSettings(JSON.parse(row.value));
  } catch {
    return chatDefaults();
  }
}

function saveChatSettings(settings: ChatSettings): ChatSettings {
  const normalized = normalizeChatSettings(settings);
  setSetting(CHAT_SETTINGS_KEY, JSON.stringify(normalized));
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
