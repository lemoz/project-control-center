import fs from "fs";
import path from "path";
import type { RunFailureCategory, RunRow } from "./db.js";

type TestResult = {
  command: string;
  passed: boolean;
  output?: string;
};

export type RunFailureReason = {
  category: RunFailureCategory;
  pattern: string;
  detail: string | null;
  source: "status" | "tests" | "error" | "log";
};

export type RunFailureContext = {
  run: RunRow;
  log_tail: string;
  tests_log_tail: string;
  test_results: TestResult[] | null;
  baseline_results: TestResult[] | null;
};

type FailurePatternRule = {
  id: string;
  category: RunFailureCategory;
  regex: RegExp;
};

const FAILURE_PATTERNS: FailurePatternRule[] = [
  {
    id: "baseline_tests_missing",
    category: "baseline_failure",
    regex: /baseline tests did not return results|baseline tests failing/i,
  },
  {
    id: "remote_sync_failed",
    category: "timeout_or_resource",
    regex: /remote (workspace|artifact|reviewer) .* failed|remote exec failed|ssh_failed/i,
  },
  {
    id: "vm_unavailable",
    category: "timeout_or_resource",
    regex: /VM (?:is )?(?:unavailable|not running|missing external IP)|Failed to start VM/i,
  },
  {
    id: "timeout",
    category: "timeout_or_resource",
    regex: /timed out|timeout|ETIMEDOUT/i,
  },
  {
    id: "out_of_memory",
    category: "timeout_or_resource",
    regex: /out of memory|ENOMEM/i,
  },
  {
    id: "disk_full",
    category: "timeout_or_resource",
    regex: /ENOSPC|no space left on device/i,
  },
  {
    id: "codex_exec_failed",
    category: "agent_error",
    regex: /codex exec failed/i,
  },
  {
    id: "builder_failed",
    category: "agent_error",
    regex: /builder failed|reviewer failed|runner worker pid unavailable|failed to start worker/i,
  },
  {
    id: "worktree_failed",
    category: "build_error",
    regex: /worktree creation failed|git checkout failed|git failed/i,
  },
  {
    id: "typescript_error",
    category: "build_error",
    regex: /TypeScript|tsc|TS\d{4}/i,
  },
  {
    id: "lint_error",
    category: "build_error",
    regex: /eslint/i,
  },
  {
    id: "build_failed",
    category: "build_error",
    regex: /build failed|next build|compile failed/i,
  },
  {
    id: "module_not_found",
    category: "build_error",
    regex: /module not found|cannot find module/i,
  },
];

const FAILURE_STATUSES = new Set(["failed", "baseline_failed", "merge_conflict", "canceled"]);

function readJsonIfExists<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function tailFile(filePath: string, maxBytes = 24_000): string {
  try {
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString("utf8");
  } catch {
    return "";
  }
}

function extractMatchLine(text: string, regex: RegExp): string | null {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (regex.test(line)) return line.trim();
  }
  return null;
}

function summarizeFailedTests(results: TestResult[] | null): string | null {
  if (!results) return null;
  const failed = results.filter((test) => !test.passed);
  if (!failed.length) return null;
  const commands = failed.map((test) => test.command).filter(Boolean);
  if (!commands.length) return "tests failed";
  const preview = commands.slice(0, 3).join(", ");
  const extra = commands.length > 3 ? ` (+${commands.length - 3} more)` : "";
  return `failed: ${preview}${extra}`;
}

function buildCombinedText(context: RunFailureContext): string {
  return [context.run.error, context.log_tail, context.tests_log_tail]
    .filter(Boolean)
    .join("\n");
}

export function buildFailureContext(run: RunRow): RunFailureContext {
  const testsDir = path.join(run.run_dir, "tests");
  const testsResultsPath = path.join(testsDir, "results.json");
  const baselineResultsPath = path.join(testsDir, "baseline-results.json");
  const testsLogPath = path.join(testsDir, "npm-test.log");

  return {
    run,
    log_tail: tailFile(run.log_path, 40_000),
    tests_log_tail: tailFile(testsLogPath, 24_000),
    test_results: readJsonIfExists<TestResult[]>(testsResultsPath),
    baseline_results: readJsonIfExists<TestResult[]>(baselineResultsPath),
  };
}

export function classifyRunFailure(context: RunFailureContext): RunFailureReason | null {
  const { run } = context;
  if (!FAILURE_STATUSES.has(run.status)) return null;

  if (run.status === "baseline_failed") {
    return {
      category: "baseline_failure",
      pattern: "baseline_tests_failed",
      detail: summarizeFailedTests(context.baseline_results) ?? run.error ?? null,
      source: "status",
    };
  }

  if (run.status === "merge_conflict") {
    return {
      category: "merge_conflict",
      pattern: "merge_conflict",
      detail: run.error ?? null,
      source: "status",
    };
  }

  if (run.status === "canceled") {
    return {
      category: "canceled",
      pattern: "canceled",
      detail: run.error ?? null,
      source: "status",
    };
  }

  const combined = buildCombinedText(context);
  for (const rule of FAILURE_PATTERNS) {
    if (!rule.regex.test(combined)) continue;
    return {
      category: rule.category,
      pattern: rule.id,
      detail: run.error ?? extractMatchLine(combined, rule.regex),
      source: run.error ? "error" : "log",
    };
  }

  const baselineSummary = summarizeFailedTests(context.baseline_results);
  if (baselineSummary) {
    return {
      category: "baseline_failure",
      pattern: "baseline_tests_failed",
      detail: baselineSummary,
      source: "tests",
    };
  }

  const testSummary = summarizeFailedTests(context.test_results);
  if (testSummary || /tests? failed/i.test(combined)) {
    return {
      category: "test_failure",
      pattern: "tests_failed",
      detail: testSummary ?? run.error ?? extractMatchLine(combined, /tests? failed/i),
      source: "tests",
    };
  }

  return {
    category: "unknown",
    pattern: "unknown",
    detail: run.error ?? null,
    source: run.error ? "error" : "log",
  };
}
