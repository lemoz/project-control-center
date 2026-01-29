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

export type VoiceSettings = {
  apiKey: string | null;
  agentId: string | null;
};

export type VoiceSettingsPatch = {
  apiKey?: string | null;
  agentId?: string | null;
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

const VoiceSettingsPatchSchema = z
  .object({
    apiKey: z.string().nullable().optional(),
    agentId: z.string().nullable().optional(),
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
