import crypto from "crypto";
import path from "path";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function stableRepoId(repoPath: string): string {
  const base = path.basename(repoPath);
  const slug = slugify(base) || "repo";
  const hash = crypto
    .createHash("sha1")
    .update(repoPath)
    .digest("hex")
    .slice(0, 6);
  return `${slug}-${hash}`;
}

