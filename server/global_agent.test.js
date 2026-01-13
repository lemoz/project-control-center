import assert from "node:assert/strict";
import { test } from "node:test";

const { parseGlobalDecision } = await import("./global_agent.ts");

test("parseGlobalDecision parses delegate payloads", () => {
  const input = JSON.stringify({
    action: "delegate",
    project_id: "alpha",
    reason: "prioritize alpha",
  });
  const result = parseGlobalDecision(input);
  assert.ok(result);
  assert.equal(result.action, "DELEGATE");
  if (result.action === "DELEGATE") {
    assert.equal(result.project_id, "alpha");
    assert.equal(result.reason, "prioritize alpha");
  }
});

test("parseGlobalDecision reads fenced JSON", () => {
  const payload = {
    action: "RESOLVE",
    escalation_id: "esc-1",
    resolution: { token: "abc123" },
  };
  const input = `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
  const result = parseGlobalDecision(input);
  assert.ok(result);
  assert.equal(result.action, "RESOLVE");
  if (result.action === "RESOLVE") {
    assert.equal(result.escalation_id, "esc-1");
    assert.deepEqual(result.resolution, { token: "abc123" });
  }
});

test("parseGlobalDecision tolerates trailing text after JSON", () => {
  const payload = {
    action: "WAIT",
    reason: "idle",
  };
  const input = `${JSON.stringify(payload)}\n\nExtra commentary.`;
  const result = parseGlobalDecision(input);
  assert.ok(result);
  assert.equal(result.action, "WAIT");
  if (result.action === "WAIT") {
    assert.equal(result.reason, "idle");
  }
});

test("parseGlobalDecision rejects incomplete payloads", () => {
  const input = JSON.stringify({ action: "DELEGATE" });
  const result = parseGlobalDecision(input);
  assert.equal(result, null);
});
