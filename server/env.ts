import fs from "fs";
import path from "path";

type EnvSource = {
  filePath: string;
  contents: string;
};

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseEnvContents(contents: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = normalized.indexOf("=");
    if (eq <= 0) continue;

    const key = normalized.slice(0, eq).trim();
    if (!key) continue;

    const value = stripQuotes(normalized.slice(eq + 1));
    out[key] = value;
  }

  return out;
}

function readEnvFile(filePath: string): EnvSource | null {
  try {
    const contents = fs.readFileSync(filePath, "utf8");
    return { filePath, contents };
  } catch {
    return null;
  }
}

export function loadDotEnv() {
  const root = process.cwd();
  const candidates = [
    path.join(root, ".env"),
    path.join(root, ".env.local"),
    path.join(root, ".env.development"),
    path.join(root, ".env.development.local"),
  ];

  for (const filePath of candidates) {
    const src = readEnvFile(filePath);
    if (!src) continue;
    const parsed = parseEnvContents(src.contents);
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] !== undefined) continue;
      process.env[key] = value;
    }
  }
}

loadDotEnv();

