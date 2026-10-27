import test from "node:test";
import assert from "node:assert/strict";
import {
  ExternalRunController,
  externalDraft,
  externalStatus,
  type ExternalSession,
} from "./external-run.ts";
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
      perform: async () => {
        dispatches++;
        return (run = applyStepOutcome(
          run!,
          plan,
          run!.nextStep === 2 ? "confirmation-required" : "done",
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
    advanceClock() {
      at += 16000;
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
test("external run uses the shared state machine, bound inputs and extension-only approval", async () => {
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
  // The extension's existing approval path supplies this outcome; MCP has no approval verb.
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
