import fs from "fs";
import path from "path";
import {
  findProjectById,
  listProjects,
  listProjectsByPath,
  mergeProjectsByPath,
  upsertProject,
  type ProjectRow,
} from "./db.js";
import { discoverGitRepos, loadDiscoveryConfig } from "./discovery.js";
import { readControlMetadata, type ControlSuccessMetric } from "./sidecar.js";
import { stableRepoId } from "./utils.js";
import { topActiveWorkOrders, type WorkOrderStatus } from "./work_orders.js";

export type RepoSummary = {
  id: string;
  name: string;
  description: string | null;
  path: string;
  type: "prototype" | "long_term";
  stage: string;
  status: "active" | "blocked" | "parked";
  priority: number;
  starred: boolean;
  hidden: boolean;
  tags: string[];
  next_work_orders: Array<{
    id: string;
    title: string;
    status: WorkOrderStatus;
    priority: number;
  }>;
};

type DiscoveryCache = { ts: number; repos: string[] };
let discoveryCache: DiscoveryCache | null = null;

export function invalidateDiscoveryCache(): void {
  discoveryCache = null;
}

function safeParseStringArrayJson(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function normalizeSuccessCriteria(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function isSuccessMetric(value: unknown): value is ControlSuccessMetric {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || !record.name.trim()) return false;
  if (!(typeof record.target === "number" || typeof record.target === "string")) return false;
  if ("current" in record) {
    if (
      !(
        record.current === null ||
        record.current === undefined ||
        typeof record.current === "number" ||
        typeof record.current === "string"
      )
    ) {
      return false;
    }
  }
  return true;
}

function safeParseSuccessMetrics(value: unknown): ControlSuccessMetric[] {
  if (Array.isArray(value)) {
    return value.filter(isSuccessMetric);
  }
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSuccessMetric);
  } catch {
    return [];
  }
}

function selectProjectId(
  resolvedPath: string,
  sidecarId: string | undefined,
  autoId: string,
  discoveredResolved: Set<string>
): string {
  if (!sidecarId) return autoId;
  const existingBySidecarId = findProjectById(sidecarId);
  if (!existingBySidecarId) return sidecarId;

  const existingPath = path.resolve(existingBySidecarId.path);
  if (existingPath === resolvedPath) return sidecarId;

  const existingGitDir = path.join(existingPath, ".git");
  const existingLooksLikeGitRepo = (() => {
    try {
      const stat = fs.statSync(existingGitDir);
      return stat.isDirectory() || stat.isFile();
    } catch {
      return false;
    }
  })();

  if (!discoveredResolved.has(existingPath) || !existingLooksLikeGitRepo) {
    // Repo likely moved/renamed. Keep stable sidecar id and let the upsert update the stored path.
    return sidecarId;
  }

  // Guard against `.control.yml` id collisions across distinct repos.
  // eslint-disable-next-line no-console
  console.warn(
    `[discovery] ignoring .control.yml id "${sidecarId}" at ${resolvedPath} (already used by ${existingBySidecarId.path}); using auto id "${autoId}"`
  );
  return autoId;
}

function selectLatestTimestamp(values: Array<string | null | undefined>): string | null {
  let bestValue: string | null = null;
  let bestMs = -Infinity;

  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) continue;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) continue;
    if (ms > bestMs) {
      bestMs = ms;
      bestValue = value;
    }
  }

  if (bestValue) return bestValue;
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function getDiscoveredRepos(): string[] {
  const ttlMs = Number(process.env.CONTROL_CENTER_SCAN_TTL_MS || 60_000);
  const now = Date.now();
  if (discoveryCache && now - discoveryCache.ts < ttlMs) {
    return discoveryCache.repos;
  }

  const config = loadDiscoveryConfig();
  const repos = discoverGitRepos(config);
  discoveryCache = { ts: now, repos };
  return repos;
}

export function getDiscoveredRepoPaths(params?: { forceRescan?: boolean }): string[] {
  if (params?.forceRescan) invalidateDiscoveryCache();
  return getDiscoveredRepos();
}

export function syncAndListRepoSummaries(params?: { forceRescan?: boolean }): RepoSummary[] {
  const discovered = getDiscoveredRepoPaths({ forceRescan: params?.forceRescan });
  const discoveredResolved = new Set(discovered.map((repoPath) => path.resolve(repoPath)));
  const now = new Date().toISOString();

  for (const repoPath of discovered) {
    const resolvedPath = path.resolve(repoPath);
    const meta = readControlMetadata(resolvedPath);
    const autoId = stableRepoId(resolvedPath);
    const canonicalId = selectProjectId(resolvedPath, meta?.id, autoId, discoveredResolved);
    const existingById = findProjectById(canonicalId);
    const existingByPath = listProjectsByPath(resolvedPath);
    const anyStarred = existingByPath.some((p) => p.starred === 1);
    const anyHidden = existingByPath.some((p) => p.hidden === 1);
    const existingFallback =
      existingById ??
      existingByPath
        .slice()
        .sort((a, b) => {
          if (a.starred !== b.starred) return b.starred - a.starred;
          if (a.priority !== b.priority) return a.priority - b.priority;
          return String(a.created_at).localeCompare(String(b.created_at));
        })
        .at(0);

    const name = meta?.name || existingFallback?.name || path.basename(resolvedPath);
    const description =
      meta?.description ||
      existingById?.description ||
      existingByPath.find((p) => p.description)?.description ||
      null;
    const type = meta?.type || existingFallback?.type || ("prototype" as const);
    const stage = meta?.stage || existingFallback?.stage || "idea";
    const status = meta?.status || existingFallback?.status || ("active" as const);
    const priority = meta?.priority ?? existingFallback?.priority ?? 3;
    const tags = JSON.stringify(meta?.tags ?? safeParseStringArrayJson(existingFallback?.tags));
    const success_criteria =
      normalizeSuccessCriteria(meta?.success_criteria) ??
      normalizeSuccessCriteria(existingFallback?.success_criteria) ??
      null;
    const success_metrics = JSON.stringify(
      meta?.success_metrics !== undefined
        ? safeParseSuccessMetrics(meta.success_metrics)
        : safeParseSuccessMetrics(existingFallback?.success_metrics)
    );
    const isolation_mode = existingFallback?.isolation_mode || "local";
    const vm_size = existingFallback?.vm_size || "medium";
    const persistedStarred = Boolean(existingById?.starred) || anyStarred;
    const starred =
      meta?.starred !== undefined ? (meta.starred ? 1 : 0) : persistedStarred ? 1 : 0;

    const persistedHidden = Boolean(existingById?.hidden) || anyHidden;
    const hidden = persistedHidden ? 1 : 0;

    const lastRunAtCandidates = [
      existingById?.last_run_at,
      ...existingByPath.map((p) => p.last_run_at),
    ];
    const lastRunAt = selectLatestTimestamp(lastRunAtCandidates);

    upsertProject({
      id: canonicalId,
      name,
      description,
      path: resolvedPath,
      type,
      stage,
      status,
      priority,
      starred,
      hidden,
      tags,
      success_criteria,
      success_metrics,
      isolation_mode,
      vm_size,
      last_run_at: lastRunAt,
      created_at: now,
      updated_at: now,
    });

    mergeProjectsByPath(resolvedPath, canonicalId);
  }

  const discoveredSet = new Set(discovered.map((p) => path.resolve(p)));
  const projects = listProjects().filter((p) => discoveredSet.has(path.resolve(p.path)));
  const uniqueProjects: ProjectRow[] = [];
  const seenPaths = new Set<string>();
  for (const p of projects) {
    const rp = path.resolve(p.path);
    if (seenPaths.has(rp)) continue;
    seenPaths.add(rp);
    uniqueProjects.push(p);
  }

  return uniqueProjects.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    path: p.path,
    type: p.type,
    stage: p.stage,
    status: p.status,
    priority: p.priority,
    starred: Boolean(p.starred),
    hidden: Boolean(p.hidden),
    tags: safeParseStringArrayJson(p.tags),
    next_work_orders: topActiveWorkOrders(p.path, 3),
  }));
}
