import assert from "node:assert/strict";
import { test } from "node:test";

const {
  getEscalationDeferral,
  getPreferredReviewDeferral,
  isWithinQuietHours,
  minutesUntilQuietEnd,
  parsePreferencesPatch,
} = await import("./user_preferences.ts");

test("parsePreferencesPatch validates preference fields", () => {
  const result = parsePreferencesPatch({
    quiet_hours: { start: "21:30", end: "07:15" },
    priority_projects: [" alpha ", "beta", "alpha"],
    escalation_batch_minutes: 45,
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.patch.quiet_hours, { start: "21:30", end: "07:15" });
  assert.deepEqual(result.patch.priority_projects, ["alpha", "beta"]);
  assert.equal(result.patch.escalation_batch_minutes, 45);
});

test("parsePreferencesPatch rejects invalid quiet hours", () => {
  const result = parsePreferencesPatch({ quiet_hours: { start: "7am", end: "08:00" } });
  assert.equal(result.ok, false);
});

test("quiet hours evaluation handles overnight ranges", () => {
  const quiet = { start: "22:00", end: "08:00" };
  const late = new Date(2026, 0, 12, 23, 30);
  const early = new Date(2026, 0, 13, 6, 0);
  const midday = new Date(2026, 0, 13, 12, 0);
  assert.equal(isWithinQuietHours(quiet, late), true);
  assert.equal(isWithinQuietHours(quiet, early), true);
  assert.equal(isWithinQuietHours(quiet, midday), false);
  assert.equal(minutesUntilQuietEnd(quiet, late), 510);
  assert.equal(minutesUntilQuietEnd(quiet, early), 120);
});

test("getEscalationDeferral applies batch window", () => {
  const now = new Date(2026, 0, 12, 15, 0);
  const last = new Date(2026, 0, 12, 14, 30).toISOString();
  const deferral = getEscalationDeferral({
    preferences: {
      quiet_hours: { start: "22:00", end: "08:00" },
      priority_projects: [],
      escalation_batch_minutes: 60,
    },
    lastEscalationAt: last,
    now,
  });
  assert.ok(deferral);
  if (!deferral) return;
  assert.equal(deferral.reason, "batch_window");
  assert.equal(deferral.retry_after_minutes, 30);
});

test("preferred review deferral waits for the review window", () => {
  const preferred = "09:00";
  const before = new Date(2026, 0, 12, 8, 30);
  const deferral = getPreferredReviewDeferral({
    preferredReviewTime: preferred,
    now: before,
  });
  assert.ok(deferral);
  if (!deferral) return;
  assert.equal(deferral.reason, "preferred_review_time");
  assert.equal(deferral.retry_after_minutes, 30);

  const within = new Date(2026, 0, 12, 9, 15);
  assert.equal(
    getPreferredReviewDeferral({ preferredReviewTime: preferred, now: within }),
    null
  );
});
