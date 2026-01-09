import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeConstitutionWithInsights } from "./constitution.ts";
import { draftPreservesBase } from "./constitution_generation.ts";

test("mergeConstitutionWithInsights preserves existing bullets and adds new ones", () => {
  const base = [
    "# Constitution",
    "",
    "## Style & Taste",
    "- Use TypeScript",
    "",
    "## Communication",
    "Keep it short.",
  ].join("\n");

  const merged = mergeConstitutionWithInsights({
    base,
    insights: [
      { category: "style", text: "Prefer concise naming" },
      { category: "style", text: "Use TypeScript" },
      { category: "communication", text: "Ask before acting" },
    ],
  });

  assert.match(merged, /- Use TypeScript/);
  assert.match(merged, /- Prefer concise naming/);
  const occurrences = merged.match(/- Use TypeScript/g) ?? [];
  assert.equal(occurrences.length, 1);
});

test("mergeConstitutionWithInsights merges anti-patterns without duplicating headings", () => {
  const base = [
    "# Constitution",
    "",
    "## Anti-Patterns",
    "- Avoid implicit any",
  ].join("\n");

  const merged = mergeConstitutionWithInsights({
    base,
    insights: [
      { category: "anti", text: "Avoid implicit any" },
      { category: "anti", text: "Avoid deeply nested callbacks" },
    ],
  });

  const headings = merged.match(/## Anti-Patterns/g) ?? [];
  assert.equal(headings.length, 1);
  assert.match(merged, /- Avoid deeply nested callbacks/);
  assert.ok(!merged.includes("Anti-Patterns (Learned Failures)"));
});

test("draftPreservesBase accepts drafts that keep base headings and bullets", () => {
  const base = [
    "# Constitution",
    "",
    "## Style & Taste",
    "- Use TypeScript",
    "",
    "## Communication",
    "Keep it short.",
  ].join("\n");
  const draft = [
    "# Constitution",
    "",
    "## Style & Taste",
    "* Use TypeScript",
    "- Prefer concise naming",
    "",
    "## Communication",
    "Keep it short.",
  ].join("\n");

  assert.equal(draftPreservesBase({ base, draft }), true);
});

test("draftPreservesBase rejects drafts that omit base content", () => {
  const base = [
    "# Constitution",
    "",
    "## Style & Taste",
    "- Use TypeScript",
    "",
    "## Communication",
    "Keep it short.",
  ].join("\n");
  const draft = [
    "# Constitution",
    "",
    "## Style & Taste",
    "- Prefer concise naming",
    "",
    "## Communication",
    "Keep it short.",
  ].join("\n");

  assert.equal(draftPreservesBase({ base, draft }), false);
});
