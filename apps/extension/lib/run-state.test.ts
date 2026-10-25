import assert from "node:assert/strict";
import test from "node:test";
import type { RunState, SkillPlan } from "@show-me-once/shared";
import {
  applyStepOutcome,
  canAutoAdvance,
  recoverInterruptedRun,
} from "./run-state.ts";

const plan: SkillPlan = {
  schemaVersion: 1,
  parameters: [],
  steps: [
    {
      kind: "click",
      url: "https://example.com",
      selector: "button:nth-of-type(1)",
    },
    { kind: "navigation", url: "https://example.com/…" },
  ],
};
const run: RunState = {
  id: "run",
  tabId: 1,
  active: true,
  mode: "automatic",
  nextStep: 0,
  totalSteps: 2,
  logs: [],
};

test("automatic execution pauses before a confirmation and cannot skip the protected step", () => {
  const paused = applyStepOutcome(
    run,
    plan,
    "confirmation-required",
    "Confirmation required.",
  );
  assert.equal(paused.nextStep, 0);
  assert.equal(paused.confirmationStep, 0);
  assert.equal(paused.pauseReason, "confirmation");
  assert.equal(canAutoAdvance(paused), false);
  const confirmed = applyStepOutcome(paused, plan, "done", "Click dispatched.");
  assert.equal(confirmed.nextStep, 1);
  assert.equal(confirmed.confirmationStep, undefined);
  assert.equal(canAutoAdvance(confirmed), true);
});

test("a missing or ambiguous target pauses automation without advancing", () => {
  const blocked = applyStepOutcome(run, plan, "blocked", "Target unavailable.");
  assert.equal(blocked.nextStep, 0);
  assert.equal(blocked.pauseReason, "blocked");
  assert.equal(canAutoAdvance(blocked), false);
});

test("navigation is awaited after an action and completion prevents further automatic steps", () => {
  const navigating = applyStepOutcome(
    run,
    plan,
    "done",
    "Click dispatched.",
    1000,
  );
  assert.equal(navigating.awaitingNavigation, true);
  assert.equal(navigating.navigationObserved, false);
  assert.equal(navigating.navigationStartedAt, 1000);
  const completed = applyStepOutcome(
    { ...navigating, navigationObserved: true },
    plan,
    "done",
    "Checkpoint matched.",
    2000,
  );
  assert.equal(completed.active, false);
  assert.equal(completed.nextStep, 2);
  assert.equal(completed.awaitingNavigation, false);
  assert.equal(canAutoAdvance(completed), false);
});

test("manual mode, user pause, and Stop never trigger automatic execution", () => {
  assert.equal(canAutoAdvance({ ...run, mode: "manual" }), false);
  assert.equal(canAutoAdvance({ ...run, pauseReason: "user" }), false);
  assert.equal(canAutoAdvance({ ...run, active: false }), false);
  assert.equal(canAutoAdvance(null), false);
});

test("worker recovery never automatically repeats an action with an unknown outcome", () => {
  const interrupted = { ...run, inFlightStep: 0, confirmationStep: 0 };
  assert.equal(canAutoAdvance(interrupted), false);
  const recovered = recoverInterruptedRun(interrupted, plan);
  assert.equal(recovered.nextStep, 0);
  assert.equal(recovered.pauseReason, "blocked");
  assert.equal(recovered.confirmationStep, undefined);
  assert.equal(recovered.inFlightStep, undefined);
  assert.equal(canAutoAdvance(recovered), false);
  assert.match(recovered.logs[0]!.detail, /may have executed/);
});
