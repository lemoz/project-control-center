import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  normalizeToolArgs,
  parseCommandsFromLog,
  parseShellCommandsFromEvent,
} from "./chat_agent.ts";

test("normalizeToolArgs accepts plain strings and JSON strings", () => {
  assert.deepEqual(normalizeToolArgs("ls -la"), { command: "ls -la" });
  assert.deepEqual(normalizeToolArgs("\"pwd\""), { command: "pwd" });
  assert.deepEqual(
    normalizeToolArgs("{\"command\":\"echo hello\"}"),
    { command: "echo hello" }
  );
});

test("parseShellCommandsFromEvent handles camelCase toolName + tool_input JSON", () => {
  const event = {
    toolName: "shell_command",
    tool_input: "{\"command\":\"ls\"}",
  };
  assert.deepEqual(parseShellCommandsFromEvent(event), [{ command: "ls" }]);
});

test("parseShellCommandsFromEvent ignores non-shell tool arguments", () => {
  const event = {
    toolName: "read_file",
    arguments: "README.md",
  };
  assert.deepEqual(parseShellCommandsFromEvent(event), []);
});

test("parseShellCommandsFromEvent handles tool objects with inputs", () => {
  const event = {
    tool: { name: "shell_command", input: { command: "pwd", cwd: "/repo" } },
  };
  assert.deepEqual(parseShellCommandsFromEvent(event), [{ command: "pwd", cwd: "/repo" }]);
});

test("parseShellCommandsFromEvent handles codex command_execution items", () => {
  const started = {
    type: "item.started",
    item: {
      id: "item_1",
      type: "command_execution",
      command: "/bin/zsh -lc ls",
      aggregated_output: "",
      exit_code: null,
      status: "in_progress",
    },
  };
  const completed = {
    type: "item.completed",
    item: {
      id: "item_1",
      type: "command_execution",
      command: "/bin/zsh -lc ls",
      aggregated_output: "file\n",
      exit_code: 0,
      status: "completed",
    },
  };
  assert.deepEqual(parseShellCommandsFromEvent(started), [{ command: "/bin/zsh -lc ls" }]);
  assert.deepEqual(parseShellCommandsFromEvent(completed), []);
});

test("parseCommandsFromLog parses string args and cwd/dir variants", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-chat-"));
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  const logPath = path.join(tmpDir, "codex.jsonl");
  const lines = [
    JSON.stringify({
      toolName: "shell_command",
      tool_input: "{\"command\":\"ls\"}",
    }),
    JSON.stringify({
      tool_name: "shell_command",
      arguments: "ls -la",
      cwd: "/repo",
    }),
    JSON.stringify({
      tool_name: "shell_command",
      tool_input: "{\"cmd\":\"pwd\",\"dir\":\"/work\"}",
    }),
  ];
  fs.writeFileSync(logPath, `${lines.join("\n")}\n`, "utf8");

  assert.deepEqual(parseCommandsFromLog(logPath), [
    { command: "ls" },
    { command: "ls -la", cwd: "/repo" },
    { command: "pwd", cwd: "/work" },
  ]);
});

test("parseCommandsFromLog extracts codex command_execution started events only", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-chat-"));
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  const logPath = path.join(tmpDir, "codex.jsonl");
  const lines = [
    JSON.stringify({
      type: "item.started",
      item: {
        id: "item_1",
        type: "command_execution",
        command: "/bin/zsh -lc ls",
        aggregated_output: "",
        exit_code: null,
        status: "in_progress",
      },
    }),
    JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_1",
        type: "command_execution",
        command: "/bin/zsh -lc ls",
        aggregated_output: "file\n",
        exit_code: 0,
        status: "completed",
      },
    }),
  ];
  fs.writeFileSync(logPath, `${lines.join("\n")}\n`, "utf8");

  assert.deepEqual(parseCommandsFromLog(logPath), [{ command: "/bin/zsh -lc ls" }]);
});

test("parseCommandsFromLog preserves repeated commands in order", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-chat-"));
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  const logPath = path.join(tmpDir, "codex.jsonl");
  const lines = [
    JSON.stringify({
      tool_name: "shell_command",
      arguments: "ls",
      cwd: "/repo",
    }),
    JSON.stringify({
      tool_name: "shell_command",
      arguments: "ls",
      cwd: "/repo",
    }),
    JSON.stringify({
      tool_name: "shell_command",
      arguments: "pwd",
      cwd: "/repo",
    }),
  ];
  fs.writeFileSync(logPath, `${lines.join("\n")}\n`, "utf8");

  assert.deepEqual(parseCommandsFromLog(logPath), [
    { command: "ls", cwd: "/repo" },
    { command: "ls", cwd: "/repo" },
    { command: "pwd", cwd: "/repo" },
  ]);
});
