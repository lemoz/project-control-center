export type ProviderName = "codex" | "claude_code" | "gemini_cli";

export type ProviderSettings = {
  provider: ProviderName;
  model: string;
  cliPath?: string;
};

export type WorkOrderInput = {
  id: string;
  title: string;
  goal: string;
  acceptanceCriteria: string[];
  stopConditions: string[];
  repoPath: string;
};

export type BuilderResult = {
  summary: string;
  filesChanged: string[];
  diff: string;
  tests: { command: string; passed: boolean; output?: string }[];
  risks: string[];
};

export type ReviewVerdict =
  | { status: "approved"; notes: string[] }
  | { status: "changes_requested"; notes: string[] };

