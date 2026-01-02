import fs from "fs";
import path from "path";
import YAML from "yaml";
import { z } from "zod";

const controlSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    type: z.enum(["prototype", "long_term"]).optional(),
    stage: z.string().min(1).optional(),
    status: z.enum(["active", "blocked", "parked"]).optional(),
    priority: z.number().int().min(1).max(5).optional(),
    tags: z.array(z.string()).optional(),
    starred: z.boolean().optional(),
    description: z.string().optional(),
  })
  .passthrough();

export type ControlMetadata = z.infer<typeof controlSchema>;

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
