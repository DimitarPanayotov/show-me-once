import test from "node:test";
import assert from "node:assert/strict";
import {
  ExternalRunController,
  externalDraft,
  prepareExternalDraft,
  externalStatus,
  type ExternalSession,
} from "./external-run.ts";
import { exampleDraft } from "./skill-catalog.ts";

test("switching agent tasks preserves both local and cloud edits without requiring a save", () => {
  const previous = {
    ...exampleDraft,
    sourceRecordingId: "my-recording",
    readOnly: false,
    dirty: true,
    markdown: exampleDraft.markdown + "\nMy local edit",
  };
  const next = prepareExternalDraft(
    previous,
    [],
    exampleDraft.markdown,
    "next-run",
  );
  assert.equal(next.skills[0], previous);
  assert.equal(next.skills[0]?.markdown, previous.markdown);
  assert.notEqual(next.draft, previous);
  const cloud = { ...previous, remoteSkillId: 'cloud', ownerId: 'owner' };
  const switched = prepareExternalDraft(cloud, [], exampleDraft.markdown, 'next-run');
  assert.equal(switched.skills[0], cloud);
  assert.equal(switched.skills[0]?.remoteSkillId, 'cloud');
  assert.equal(switched.skills[0]?.savedVersion, cloud.savedVersion);
  assert.equal(switched.skills[0]?.markdown, previous.markdown);

});
import {
  applyStepOutcome,
  canAutoAdvance,
  recoverInterruptedRun,
} from "./run-state.ts";
import { type RunState, type SkillPlan } from "@show-me-once/shared";
import { withMcpInstructions } from "@show-me-once/shared/mcp";

test("external runs preserve matching edited drafts and reject replacing unrelated unsaved work", () => {
  const f = fixture();
  const previous = {
    sourceRecordingId: "recording",
    name: "My edited title",
    description: "My edited description",
    markdown: f.markdown,
    dirty: true,
  };
  assert.equal(
    externalDraft(previous, withMcpInstructions(f.markdown), "run").draft,
    previous,
  );
  assert.equal(
    externalDraft(previous, f.markdown, "run").skillKey,
    "recording",
  );
  assert.throws(() =>
    externalDraft(
      { ...previous, markdown: f.markdown + "\nUnsaved edits" },
      f.markdown,
      "run",
    ),
  );
  assert.equal(
    externalDraft(
      { ...previous, dirty: false },
      f.markdown + "\nDifferent skill",
      "run",
    ).skillKey,
    "mcp:run",
  );
});

function fixture() {
  const plan: SkillPlan = {
    schemaVersion: 1,
    parameters: [{ name: "search_1", type: "string" }],
    steps: [
      { kind: "navigation", url: "https://www.wikipedia.org" },
      {
        kind: "input",
        url: "https://www.wikipedia.org",
        selector: "input:nth-of-type(1)",
        inputKind: "search",
        parameter: "search_1",
      },
      {
        kind: "click",
        url: "https://www.wikipedia.org",
        selector: "button:nth-of-type(1)",
      },
    ],
  };
  const markdown = `---\nname: wikipedia-search\ndescription: Search\n---\n\n\`\`\`json show-me-once\n${JSON.stringify(plan)}\n\`\`\``;
  let run: RunState | null = null,
    session: ExternalSession | undefined,
    at = 1000,
    dispatches = 0;
  let confirmation: import('./confirmation.ts').PendingConfirmation = { runId: 'run-one', step: 2, details: {
    token: '07118f12-a190-4ddd-9dd9-d7ee5e69f98b', intent: 'search', interaction: 'click', targetLabel: 'Search', targetTag: 'button', origin: 'https://www.wikipedia.org',
  } };
  const identity = {
    controllerId: "client-one",
    bridgeId: "bridge-one",
    connectionId: "connection-one",
  };
  const controller = new ExternalRunController(
    {
      readRun: async () => run,
      readSession: async () => session,
      saveSession: async (s) => {
        session = s;
      },
      start: async () =>
        (run = {
          id: "run-one",
          tabId: 7,
          engine: "external",
          mode: "automatic",
          active: true,
          nextStep: 0,
          totalSteps: 3,
          logs: [],
        }),
      observe: async (_run, step) => ({
        id: "snapshot",
        url: step.url,
        controls: [
          {
            id: "c1",
            role: step.kind === "input" ? "input" : "button",
            label: "Search",
            selector:
              step.kind === "input"
                ? "input:nth-of-type(1)"
                : "button:nth-of-type(1)",
            ...(step.kind === "input" ? { inputKind: "search" } : {}),
          },
        ],
      }),
      readConfirmation: async () => confirmation,
      perform: async (approved, token) => {
        dispatches++;
        return (run = applyStepOutcome(
          run!,
          plan,
          run!.nextStep === 2 && !(approved && token === confirmation.details.token) ? "confirmation-required" : "done",
          "Generic outcome.",
        ));
      },
      stop: async () => (run = { ...run!, active: false }),
    },
    () => at,
  );
  const call = (command: unknown, who = identity) =>
    controller.handle(who, command);
  return {
    call,
    identity,
    review: (who = identity) => controller.review(who, 'run-one'),
    decide: (id: string, approved: boolean, who = identity) => controller.decide(who, 'run-one', id, approved),
    changePreview: () => { confirmation = { ...confirmation, details: { ...confirmation.details, token: crypto.randomUUID(), targetLabel: 'Different action' } }; },
    markdown,
    plan,
    get run() {
      return run!;
    },
    set run(v: RunState) {
      run = v;
    },
    get session() {
      return session!;
    },
    set session(v: ExternalSession) {
      session = v;
    },
    get dispatches() {
      return dispatches;
    },
    advanceClock(ms = 16000) {
      at += ms;
    },
  };
}
async function start(f: ReturnType<typeof fixture>) {
  await f.call({
    kind: "start",
    markdown: f.markdown,
    parameters: { search_1: "Grace Hopper" },
  });
}
async function act(
  f: ReturnType<typeof fixture>,
  action: string,
  targetId?: string,
) {
  const observed = await f.call({ kind: "observe", runId: f.run.id });
  return f.call({
    kind: "act",
    runId: f.run.id,
    stepIndex: f.run.nextStep,
    observationId: observed.observation!.id,
    action,
    ...(targetId ? { targetId } : {}),
  });
}
test("external run uses the shared state machine and cannot approve through ordinary action arguments", async () => {
  const f = fixture();
  await start(f);
  assert.equal(canAutoAdvance(f.run), false);
  await act(f, "checkpoint");
  await act(f, "fill", "c1");
  assert.equal((await act(f, "click", "c1")).status, "needs_approval");
  assert.equal(
    (await f.call({ kind: "observe", runId: f.run.id })).observation,
    undefined,
  );
  assert.equal(
    (
      await f.call({
        kind: "act",
        runId: f.run.id,
        stepIndex: 2,
        observationId: "snapshot",
        action: "click",
        targetId: "c1",
      })
    ).status,
    "needs_approval",
  );
  assert.equal(f.dispatches, 3);
  assert.ok(!JSON.stringify(f.run).includes("Grace Hopper"));
  // The existing extension approval remains available alongside native client confirmation.
  f.run = applyStepOutcome(f.run, f.plan, "done", "Approved in the extension.");
  assert.equal(
    (await f.call({ kind: "status", runId: f.run.id })).status,
    "completed",
  );
});
test("competing controllers, wrong run/step/tab/connection and stale observations cannot dispatch", async () => {
  const f = fixture();
  await start(f);
  await assert.rejects(() =>
    f.call({
      kind: "start",
      markdown: f.markdown,
      parameters: { search_1: "Other" },
    }),
  );
  await assert.rejects(() =>
    f.call(
      { kind: "status", runId: f.run.id },
      { ...f.identity, controllerId: "other" },
    ),
  );
  await assert.rejects(() => f.call({ kind: "observe", runId: "wrong" }));
  await f.call({ kind: "observe", runId: f.run.id });
  const command = {
    kind: "act",
    runId: f.run.id,
    stepIndex: 0,
    observationId: "snapshot",
    action: "checkpoint",
  };
  await assert.rejects(() => f.call({ ...command, stepIndex: 1 }));
  await assert.rejects(() =>
    f.call(command, { ...f.identity, connectionId: "new" }),
  );
  f.run = { ...f.run, tabId: 8 };
  await assert.rejects(() => f.call(command));
  f.run = { ...f.run, tabId: 7 };
  f.advanceClock();
  await assert.rejects(() => f.call(command));
  assert.equal(f.dispatches, 0);
});
test("observations are single use and unsupported targets/actions/approval flags are rejected", async () => {
  const f = fixture();
  await start(f);
  await act(f, "checkpoint");
  await f.call({ kind: "observe", runId: f.run.id });
  const command = {
    kind: "act",
    runId: f.run.id,
    stepIndex: 1,
    observationId: "snapshot",
    action: "fill",
    targetId: "c1",
  };
  await assert.rejects(() => f.call({ ...command, confirmed: true }));
  await assert.rejects(() => f.call({ ...command, targetId: "c99" }));
  await assert.rejects(() => f.call({ ...command, action: "click" }));
  await f.call(command);
  await assert.rejects(() => f.call(command));
  assert.equal(f.dispatches, 2);
});
test("Pause, Stop and uncertain worker recovery never dispatch a repeated action", async () => {
  const f = fixture();
  await start(f);
  await f.call({ kind: "observe", runId: f.run.id });
  f.run = { ...f.run, pauseReason: "user" };
  assert.equal(
    (await f.call({ kind: "observe", runId: f.run.id })).status,
    "paused",
  );
  f.run = recoverInterruptedRun(
    { ...f.run, pauseReason: undefined, inFlightStep: 0 },
    f.plan,
  );
  assert.equal(f.run.pauseReason, "blocked");
  assert.equal(f.run.nextStep, 0);
  assert.equal(
    (await f.call({ kind: "observe", runId: f.run.id })).status,
    "blocked",
  );
  await f.call({ kind: "stop", runId: f.run.id });
  assert.equal(externalStatus(f.run).status, "stopped");
  assert.equal(f.dispatches, 0);
});

async function pendingAction() {
  const f = fixture(); await start(f); await act(f, 'checkpoint'); await act(f, 'fill', 'c1'); await act(f, 'click', 'c1'); return f;
}

test('a native review describes the exact action and consumes one approval without exposing the browser token', async () => {
  const f = await pendingAction();
  const review = await f.review();
  assert.equal(review.approval?.title, 'Submit search on www.wikipedia.org');
  assert.match(review.approval!.target, /Search/);
  assert.doesNotMatch(JSON.stringify(review), /07118f12|Grace Hopper/);
  assert.equal(f.dispatches, 3);
  const outcome = await f.decide(review.approval!.reviewId, true);
  assert.equal(outcome.status, 'completed'); assert.equal(f.dispatches, 4);
  await f.decide(review.approval!.reviewId, true);
  assert.equal(f.dispatches, 4);
});

test('native approval cannot cross owners/connections/tabs, or survive a changed preview or expiry', async () => {
  const f = await pendingAction(), review = await f.review(), id = review.approval!.reviewId;
  await assert.rejects(f.decide(id, true, { ...f.identity, controllerId: 'other' }), /own/);
  await assert.rejects(f.decide(id, true, { ...f.identity, connectionId: 'other' }), /Connection changed/);
  f.run = { ...f.run, tabId: 8 }; await assert.rejects(f.decide(id, true), /preview changed/);
  f.run = { ...f.run, tabId: 7 }; f.changePreview();
  await assert.rejects(f.decide(id, true), /preview changed/);
  const fresh = await f.review(); f.advanceClock(120001);
  await assert.rejects(f.decide(fresh.approval!.reviewId, true), /preview changed/);
  assert.equal(f.dispatches, 3);
});

test('native cancellation, Pause and Stop cannot dispatch the pending action', async () => {
  const f = await pendingAction(), review = await f.review();
  assert.equal((await f.decide(review.approval!.reviewId, false)).status, 'needs_approval');
  await assert.rejects(f.decide(review.approval!.reviewId, true), /preview changed/);
  const again = await f.review(); f.run = { ...f.run, pauseReason: 'user' };
  assert.equal((await f.decide(again.approval!.reviewId, true)).status, 'paused');
  await f.call({ kind: 'stop', runId: f.run.id });
  assert.equal((await f.decide(again.approval!.reviewId, true)).status, 'stopped');
  assert.equal(f.dispatches, 3);
});
