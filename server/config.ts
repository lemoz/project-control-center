import fs from "fs";
import path from "path";

export type PccMode = "local" | "cloud";

const STARTED_AT_MS = Date.now();
const VERSION = resolveVersion();
const TRUE_ENV_VALUES = new Set(["1", "true", "yes", "on"]);

function resolveMode(): PccMode {
  const raw = (process.env.PCC_MODE || "").trim().toLowerCase();
  if (raw === "cloud") return "cloud";
  return "local";
}

function parseEnvList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseNumberEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  return TRUE_ENV_VALUES.has(value.trim().toLowerCase());
}

function trimEnvValue(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function resolveDatabasePath(): string {
  const raw =
    (process.env.PCC_DATABASE_PATH || process.env.CONTROL_CENTER_DB_PATH || "").trim();
  if (raw) {
    return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  }
  return path.join(process.cwd(), "control-center.db");
}

function resolveReposPath(): string | null {
  const raw = (process.env.PCC_REPOS_PATH || "").trim();
  if (!raw) return null;
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function resolveVersion(): string {
  const npmVersion = (process.env.npm_package_version || "").trim();
  if (npmVersion) return npmVersion;
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    const parsed = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.trim()) {
      return parsed.version.trim();
    }
  } catch {
    // ignore
  }
  return "unknown";
}

export function getPccMode(): PccMode {
  return resolveMode();
}

export function getDatabasePath(): string {
  return resolveDatabasePath();
}

export function getReposPath(): string | null {
  return resolveReposPath();
}

export function getAppVersion(): string {
  return VERSION;
}

export function getServerStartedAt(): number {
  return STARTED_AT_MS;
}

export function getServerUptimeSeconds(): number {
  return Math.max(0, Math.floor((Date.now() - getServerStartedAt()) / 1000));
}

export function getServerPort(): number {
  return parseNumberEnv(process.env.CONTROL_CENTER_PORT, 4010);
}

export function getServerHost(): string {
  const raw = (process.env.CONTROL_CENTER_HOST || "127.0.0.1").trim();
  return raw || "127.0.0.1";
}

export function getAllowLan(): boolean {
  return process.env.CONTROL_CENTER_ALLOW_LAN === "1";
}

export function getAllowRemoteHealth(): boolean {
  return process.env.CONTROL_CENTER_ALLOW_REMOTE_HEALTH === "1";
}

export function getHealthToken(): string {
  return (process.env.CONTROL_CENTER_HEALTH_TOKEN || "").trim();
}

export function getEscalationTimeoutHours(): number {
  const raw = process.env.ESCALATION_TIMEOUT_HOURS;
  const parsed = raw ? Number.parseFloat(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 24;
}

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

/**
 * Get the sandbox mode for builder agents.
 * Controlled by PCC_BUILDER_SANDBOX env var.
 * Options: "read-only", "workspace-write", "danger-full-access"
 * Default: "workspace-write"
 *
 * Use "danger-full-access" when stream monitoring is enabled to allow
 * builders to access localhost APIs and write outside the worktree.
 */
export function getBuilderSandboxMode(): SandboxMode {
  const raw = (process.env.PCC_BUILDER_SANDBOX || "").trim().toLowerCase();
  if (raw === "danger-full-access" || raw === "full-access" || raw === "none") {
    return "danger-full-access";
  }
  if (raw === "read-only") {
    return "read-only";
  }
  return "workspace-write";
}

/**
 * Get the sandbox mode for reviewer agents.
 * Controlled by PCC_REVIEWER_SANDBOX env var.
 * Options: "read-only", "workspace-write", "danger-full-access"
 * Default: "read-only"
 */
export function getReviewerSandboxMode(): SandboxMode {
  const raw = (process.env.PCC_REVIEWER_SANDBOX || "").trim().toLowerCase();
  if (raw === "danger-full-access" || raw === "full-access" || raw === "none") {
    return "danger-full-access";
  }
  if (raw === "workspace-write") {
    return "workspace-write";
  }
  return "read-only";
}

export function getCorsAllowAllRequested(): boolean {
  return process.env.CONTROL_CENTER_CORS_ALLOW_ALL === "1";
}

export function getAllowedOrigins(): string[] {
  return parseEnvList(process.env.CONTROL_CENTER_ALLOWED_ORIGINS);
}

export function getNodeEnv(): string {
  return (process.env.NODE_ENV || "").trim();
}

export function getNodeEnvLabel(): string {
  return getNodeEnv() || "unknown";
}

export function isProductionEnv(): boolean {
  return getNodeEnv() === "production";
}

export function getFailRunsOnRestart(): boolean {
  return process.env.CONTROL_CENTER_FAIL_IN_PROGRESS_ON_RESTART === "1";
}

export function getElevenLabsWebhookSecret(): string | null {
  const raw = process.env.CONTROL_CENTER_ELEVENLABS_WEBHOOK_SECRET;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed || null;
}

export function getElevenLabsAgentId(): string | null {
  const raw =
    process.env.CONTROL_CENTER_ELEVENLABS_AGENT_ID ||
    process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed || null;
}

export function getElevenLabsApiKey(): string | null {
  const raw =
    process.env.CONTROL_CENTER_ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed || null;
}

export function getElevenLabsSignedUrlTtlSeconds(): number | null {
  const raw = process.env.CONTROL_CENTER_ELEVENLABS_SIGNED_URL_TTL_SECONDS;
  const parsed = raw === undefined ? 300 : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function getSlackClientId(): string | null {
  return trimEnvValue(process.env.CONTROL_CENTER_SLACK_CLIENT_ID);
}

export function getSlackClientSecret(): string | null {
  return trimEnvValue(process.env.CONTROL_CENTER_SLACK_CLIENT_SECRET);
}

export function getSlackSigningSecret(): string | null {
  return trimEnvValue(process.env.CONTROL_CENTER_SLACK_SIGNING_SECRET);
}

export function getSlackRedirectUri(): string | null {
  return trimEnvValue(process.env.CONTROL_CENTER_SLACK_REDIRECT_URI);
}

export function getSlackScopes(): string[] {
  const scopes = parseEnvList(process.env.CONTROL_CENTER_SLACK_SCOPES);
  if (scopes.length) return scopes;
  return [
    "chat:write",
    "im:history",
    "im:write",
    "app_mentions:read",
    "channels:history",
  ];
}

export function getSlackConversationTimeoutMinutes(): number {
  return parseNumberEnv(process.env.CONTROL_CENTER_SLACK_CONVERSATION_TIMEOUT_MINUTES, 10);
}

export function getScanRoots(): string[] {
  return parseEnvList(process.env.CONTROL_CENTER_SCAN_ROOTS);
}

export function getScanIgnoreDirs(): string[] {
  return parseEnvList(process.env.CONTROL_CENTER_IGNORE_DIRS);
}

export function getScanIgnoreDirsRemove(): string[] {
  return parseEnvList(process.env.CONTROL_CENTER_IGNORE_DIRS_REMOVE);
}

export function getScanMaxDepth(): number {
  const raw = process.env.CONTROL_CENTER_SCAN_MAX_DEPTH;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return 4;
}

export function getHomeDir(): string {
  const raw = (process.env.HOME || "").trim();
  return raw || process.cwd();
}

export function getProcessEnv(): NodeJS.ProcessEnv {
  return process.env;
}

export function getEnvironmentVariableNames(): string[] {
  return Object.keys(process.env).sort();
}

export function getPathEnv(): string {
  return process.env.PATH ?? "";
}

export function getPathExtEnv(): string {
  return process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM";
}

export function getScanTtlMs(): number {
  const raw = process.env.CONTROL_CENTER_SCAN_TTL_MS;
  if (raw === undefined || raw === "") return 60_000;
  return Number(raw);
}

export function getControlCenterApiUrl(): string | null {
  return trimEnvValue(process.env.CONTROL_CENTER_API_URL);
}

export function getShiftClaudePath(): string {
  return trimEnvValue(process.env.CONTROL_CENTER_SHIFT_CLAUDE_PATH) ?? "claude";
}

export function getShiftAllowedToolsOverride(): string | null {
  return trimEnvValue(process.env.CONTROL_CENTER_SHIFT_ALLOWED_TOOLS);
}

export function getShiftModelOverride(): string | null {
  return trimEnvValue(process.env.CONTROL_CENTER_SHIFT_MODEL);
}

export function getShiftPromptPathOverride(): string | null {
  return trimEnvValue(process.env.CONTROL_CENTER_SHIFT_PROMPT_FILE);
}

export function getCodexCliPathOverride(): string | null {
  return trimEnvValue(process.env.CONTROL_CENTER_CODEX_PATH);
}

export function getCodexCliPath(): string {
  return getCodexCliPathOverride() ?? "codex";
}

export function getClaudeCliPathOverride(): string | null {
  return trimEnvValue(process.env.CONTROL_CENTER_CLAUDE_PATH);
}

export function getClaudeCliPath(): string {
  return getClaudeCliPathOverride() ?? "claude";
}

export function getCodexModelOverride(): string | undefined {
  const raw = process.env.CONTROL_CENTER_CODEX_MODEL || process.env.CODEX_MODEL;
  const trimmed = raw ? raw.trim() : "";
  return trimmed ? trimmed : undefined;
}

export function getChatCodexModelOverride(): string | undefined {
  const raw =
    process.env.CONTROL_CENTER_CHAT_CODEX_MODEL ||
    process.env.CONTROL_CENTER_CODEX_MODEL ||
    process.env.CODEX_MODEL;
  const trimmed = raw ? raw.trim() : "";
  return trimmed ? trimmed : undefined;
}

export function getChatCodexPathOverride(): string | undefined {
  const raw =
    process.env.CONTROL_CENTER_CHAT_CODEX_PATH ||
    process.env.CONTROL_CENTER_CODEX_PATH;
  const trimmed = raw ? raw.trim() : "";
  return trimmed ? trimmed : undefined;
}

export function getChatTrustedHostsOverride(): string | undefined {
  const raw = process.env.CONTROL_CENTER_CHAT_TRUSTED_HOSTS;
  const trimmed = raw ? raw.trim() : "";
  return trimmed ? trimmed : undefined;
}

export function getMaxBuilderIterationsOverride(): number | undefined {
  const raw =
    process.env.CONTROL_CENTER_MAX_BUILDER_ITERATIONS ||
    process.env.CONTROL_CENTER_MAX_RUN_ITERATIONS;
  const parsed = raw ? Math.trunc(Number(raw)) : NaN;
  if (Number.isFinite(parsed) && parsed >= 1) {
    return Math.min(parsed, 20);
  }
  return undefined;
}

export function getUtilityProviderOverride(): string | undefined {
  const trimmed = trimEnvValue(process.env.CONTROL_CENTER_UTILITY_PROVIDER);
  return trimmed ?? undefined;
}

export function getUtilityModelOverride(): string | undefined {
  const trimmed = trimEnvValue(process.env.CONTROL_CENTER_UTILITY_MODEL);
  return trimmed ?? undefined;
}

export function getChatSuggestionContextMessageLimit(): number {
  const raw = Number(process.env.CONTROL_CENTER_CHAT_SUGGESTION_CONTEXT_MESSAGES);
  if (!Number.isFinite(raw)) return 10;
  const n = Math.trunc(raw);
  if (n <= 0) return 0;
  return Math.min(50, n);
}

export function getUseTsWorker(): boolean {
  return process.env.CONTROL_CENTER_USE_TS_WORKER === "1";
}

export function getRemoteTestTimeoutSeconds(): number {
  return parseNumberEnv(
    process.env.CONTROL_CENTER_REMOTE_TEST_TIMEOUT_SEC,
    900
  );
}

export function getOpenAiApiKey(): string | null {
  return trimEnvValue(process.env.OPENAI_API_KEY);
}

export function getGeminiApiKey(): string | null {
  const raw =
    process.env.CONTROL_CENTER_GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY;
  const trimmed = raw ? raw.trim() : "";
  return trimmed ? trimmed : null;
}

export function getElevenLabsNarrationVoiceId(): string | null {
  const raw =
    process.env.CONTROL_CENTER_ELEVENLABS_NARRATION_VOICE_ID ||
    process.env.ELEVENLABS_NARRATION_VOICE_ID;
  const trimmed = raw ? raw.trim() : "";
  return trimmed ? trimmed : null;
}

export function getElevenLabsNarrationModelId(): string | null {
  const raw = process.env.CONTROL_CENTER_ELEVENLABS_NARRATION_MODEL_ID;
  const trimmed = raw ? raw.trim() : "";
  return trimmed ? trimmed : null;
}

export function getGlobalAgentMaxIterations(): number | undefined {
  const raw = process.env.CONTROL_CENTER_GLOBAL_MAX_ITERATIONS;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.trunc(parsed);
  }
  return undefined;
}

export function getGlobalAgentType(): string {
  return trimEnvValue(process.env.CONTROL_CENTER_GLOBAL_AGENT_TYPE) ?? "claude_cli";
}

export function getGlobalAgentId(): string {
  return trimEnvValue(process.env.CONTROL_CENTER_GLOBAL_AGENT_ID) ?? "global-agent";
}

export function getGlobalAgentSessionMaxIterations(): number | null {
  const raw = process.env.CONTROL_CENTER_GLOBAL_SESSION_MAX_ITERATIONS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

export function getGlobalAgentSessionMaxDurationMinutes(): number | null {
  const raw = process.env.CONTROL_CENTER_GLOBAL_SESSION_MAX_DURATION_MINUTES;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

export function getGlobalAgentSessionCheckInMinutes(): number | null {
  const raw = process.env.CONTROL_CENTER_GLOBAL_SESSION_CHECKIN_MINUTES;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

export function getGlobalAgentSessionCheckInDecisions(): number | null {
  const raw = process.env.CONTROL_CENTER_GLOBAL_SESSION_CHECKIN_DECISIONS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

export function getGlobalAttentionMaxProjects(): number | null {
  const raw = process.env.CONTROL_CENTER_GLOBAL_ATTENTION_MAX_PROJECTS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

export function getBudgetUsedTodayOverride(): number {
  const raw = process.env.CONTROL_CENTER_BUDGET_USED_TODAY;
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}
