import { z } from "zod";
import { getSetting, setSetting } from "./db.js";
import { readControlMetadata } from "./sidecar.js";

export const PROVIDERS = ["codex", "claude_code", "gemini_cli"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export type ProviderSettings = {
  provider: ProviderName;
  model: string;
  cliPath: string;
};

export type ChatSettings = ProviderSettings;

export type RunnerSettings = {
  builder: ProviderSettings;
  reviewer: ProviderSettings;
};

export type RunnerSettingsResponse = {
  saved: RunnerSettings;
  effective: RunnerSettings;
  env_overrides: {
    codex_model?: string;
    codex_path?: string;
  };
};

export type ChatSettingsResponse = {
  saved: ChatSettings;
  effective: ChatSettings;
  env_overrides: {
    chat_codex_model?: string;
    chat_codex_path?: string;
  };
};

const ProviderNameSchema = z.enum(PROVIDERS);

const ProviderSettingsSchema = z.object({
  provider: ProviderNameSchema.default("codex"),
  model: z.string().default(""),
  cliPath: z.string().default(""),
});

const RunnerSettingsSchema = z.object({
  builder: ProviderSettingsSchema,
  reviewer: ProviderSettingsSchema,
});

const RunnerSettingsPatchSchema = z
  .object({
    builder: ProviderSettingsSchema.partial().optional(),
    reviewer: ProviderSettingsSchema.partial().optional(),
  })
  .strict();

const SidecarRunnerOverrideSchema = z
  .object({
    builder: ProviderSettingsSchema.partial().optional(),
    reviewer: ProviderSettingsSchema.partial().optional(),
  })
  .passthrough();

const SETTINGS_KEY = "runner_settings";
const CHAT_SETTINGS_KEY = "chat_settings";

function defaults(): RunnerSettings {
  return {
    builder: { provider: "codex", model: "", cliPath: "" },
    reviewer: { provider: "codex", model: "", cliPath: "" },
  };
}

function chatDefaults(): ChatSettings {
  return { provider: "codex", model: "", cliPath: "" };
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
  const parsed = ProviderSettingsSchema.safeParse(value ?? {});
  if (parsed.success) return parsed.data;
  const merged = {
    ...chatDefaults(),
    ...(typeof value === "object" && value ? value : {}),
  };
  return ProviderSettingsSchema.parse(merged);
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
    effective: {
      builder: apply(settings.builder),
      reviewer: apply(settings.reviewer),
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

  if (settings.provider !== "codex") {
    return {
      chat_codex_model,
      chat_codex_path,
      effective: settings,
    };
  }

  return {
    chat_codex_model,
    chat_codex_path,
    effective: {
      ...settings,
      model: chat_codex_model ?? settings.model,
      cliPath: chat_codex_path ?? settings.cliPath,
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
    },
  };
}

export function patchRunnerSettings(input: unknown): RunnerSettingsResponse {
  const saved = loadSavedSettings();
  const patch = RunnerSettingsPatchSchema.parse(input ?? {});
  const merged = normalizeSettings({
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
    },
  };
}

export function patchChatSettings(input: unknown): ChatSettingsResponse {
  const saved = loadSavedChatSettings();
  const patch = ProviderSettingsSchema.partial().parse(input ?? {});
  const merged = normalizeChatSettings({ ...saved, ...patch });
  const stored = saveChatSettings(merged);
  const env = applyChatEnvOverrides(stored);
  return {
    saved: stored,
    effective: env.effective,
    env_overrides: {
      chat_codex_model: env.chat_codex_model,
      chat_codex_path: env.chat_codex_path,
    },
  };
}

export function resolveChatSettings(): ChatSettingsResponse {
  return getChatSettingsResponse();
}
