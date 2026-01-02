import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

const dirs = [
  path.join(repoRoot, ".next", "types"),
  path.join(repoRoot, ".next-dev", "types"),
  path.join(repoRoot, ".system", "next-e2e", "types"),
];

for (const dir of dirs) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

