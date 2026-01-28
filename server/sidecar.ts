import fs from "fs";
import path from "path";
import YAML from "yaml";
import { z } from "zod";
import { PROJECT_LIFECYCLE_STATUSES } from "./db.js";

const successMetricSchema = z
  .object({
    name: z.string().min(1),
    target: z.union([z.number(), z.string()]),
    current: z.union([z.number(), z.string()]).nullable().optional(),
    notes: z.string().optional(),
  })
  .passthrough();

const controlSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    type: z.enum(["prototype", "long_term"]).optional(),
    stage: z.string().min(1).optional(),
    status: z.enum(["active", "blocked", "parked"]).optional(),
    lifecycle_status: z.enum(PROJECT_LIFECYCLE_STATUSES).optional(),
    priority: z.number().int().min(1).max(5).optional(),
    tags: z.array(z.string()).optional(),
    starred: z.boolean().optional(),
    description: z.string().optional(),
    success_criteria: z.string().optional(),
    success_metrics: z.array(successMetricSchema).optional(),
  })
  .passthrough();

export type ControlMetadata = z.infer<typeof controlSchema>;
export type ControlSuccessMetric = z.infer<typeof successMetricSchema>;
export type ControlSuccessPatch = {
  success_criteria?: string | null;
  success_metrics?: ControlSuccessMetric[] | null;
};

export function readControlMetadata(repoPath: string): ControlMetadata | null {
  const candidates = [".control.yml", ".control.yaml"];
  for (const fileName of candidates) {
    const filePath = path.join(repoPath, fileName);
    if (!fs.existsSync(filePath)) continue;
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = YAML.parse(raw);
      const res = controlSchema.safeParse(parsed ?? {});
      if (res.success) return res.data;
      // If invalid, return only valid known keys (best-effort).
      return controlSchema.partial().parse(parsed ?? {});
    } catch {
      return null;
    }
  }
  return null;
}

function resolveControlFilePath(repoPath: string): string {
  const candidates = [".control.yml", ".control.yaml"];
  for (const fileName of candidates) {
    const filePath = path.join(repoPath, fileName);
    if (fs.existsSync(filePath)) return filePath;
  }
  return path.join(repoPath, candidates[0]);
}

function normalizeSuccessCriteria(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeSuccessMetrics(metrics: ControlSuccessMetric[] | null | undefined): ControlSuccessMetric[] {
  if (!Array.isArray(metrics)) return [];
  return metrics.filter((metric) => successMetricSchema.safeParse(metric).success);
}

export function updateControlSuccess(
  repoPath: string,
  patch: ControlSuccessPatch
): ControlMetadata | null {
  const filePath = resolveControlFilePath(repoPath);
  let parsed: unknown = {};
  if (fs.existsSync(filePath)) {
    try {
      parsed = YAML.parse(fs.readFileSync(filePath, "utf8")) ?? {};
    } catch (err) {
      throw new Error(
        `Failed to parse ${path.basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  const recordSource =
    parsed === null
      ? {}
      : parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
  if (!recordSource) {
    throw new Error(`${path.basename(filePath)} must contain a YAML map at the root.`);
  }
  const record = { ...recordSource };

  if ("success_criteria" in patch) {
    const normalized = normalizeSuccessCriteria(patch.success_criteria ?? null);
    if (normalized) {
      record.success_criteria = normalized;
    } else {
      delete record.success_criteria;
    }
  }

  if ("success_metrics" in patch) {
    const normalized = normalizeSuccessMetrics(patch.success_metrics ?? null);
    if (normalized.length) {
      record.success_metrics = normalized;
    } else {
      delete record.success_metrics;
    }
  }

  const nextYaml = `${YAML.stringify(record).trimEnd()}\n`;
  fs.writeFileSync(filePath, nextYaml, "utf8");

  const parsedMeta = controlSchema.safeParse(record);
  if (parsedMeta.success) return parsedMeta.data;
  const parsedPartial = controlSchema.partial().safeParse(record);
  return parsedPartial.success ? parsedPartial.data : null;
}
