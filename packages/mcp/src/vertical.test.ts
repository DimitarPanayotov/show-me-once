import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { WebSocket } from "ws";
import { createBridge } from "./bridge.ts";
import { SkillCatalog } from "../../../apps/extension/lib/skill-catalog.ts";
import {
  ExternalRunController,
  type ExternalSession,
} from "../../../apps/extension/lib/external-run.ts";
import { applyStepOutcome } from "../../../apps/extension/lib/run-state.ts";
import type { RunState, SkillPlan } from "@show-me-once/shared";

test("non-browser vertical slice: real MCP transport, actual controller, two inputs, approval, competing controller and Stop", async () => {
  const bridge = createBridge(
    "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    { port: 0 },
  );
  const port = await bridge.listen();
  const folder = await mkdtemp(join(tmpdir(), "smo-vertical-")),
    file = join(folder, "connection.json");
  await writeFile(
    file,
    JSON.stringify({
      url: `http://127.0.0.1:${port}`,
      token: bridge.agentToken,
      bridgeId: bridge.bridgeId,
    }),
  );
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
      { kind: "navigation", url: "https://en.wikipedia.org/…/…" },
    ],
  };
  const markdown = `---\nname: wikipedia-search\ndescription: Search\n---\n\n\`\`\`json show-me-once\n${JSON.stringify(plan)}\n\`\`\``;
  const catalog = new SkillCatalog({
    readLocal: async () => ({
      draft: {
        sourceRecordingId: "demo",
        name: "Recorded search",
        description: "Search",
        markdown,
      },
    }),
    listLibrary: async () => [],
    getLibrary: async () => {
      throw new Error("Not signed in");
    },
    userId: async () => undefined,
  });
  let run: RunState | null = null,
    session: ExternalSession | undefined,
    parameters: Record<string, string | boolean> = {},
    field = "",
    result = "",
    dispatches = 0;
  const controller = new ExternalRunController({
    readRun: async () => run,
    readSession: async () => session,
    saveSession: async (s) => {
      session = s;
    },
    start: async (_md, p) => {
      parameters = p;
      field = "";
      result = "";
      return (run = {
        id: randomUUID(),
        tabId: 9,
        engine: "external",
        mode: "automatic",
        active: true,
        nextStep: 0,
        totalSteps: 4,
        logs: [],
      });
    },
    observe: async (_r, step) => ({
      id: randomUUID(),
      url: step.url,
      controls:
        step.kind === "navigation"
          ? []
          : [
              {
                id: "c1",
                role: step.kind === "input" ? "input" : "button",
                label: "Search",
                selector: "input:nth-of-type(1)",
                ...(step.kind === "input" ? { inputKind: "search" } : {}),
              },
            ],
    }),
    perform: async () => {
      const step = plan.steps[run!.nextStep];
      if (step.kind === "input") {
        field = parameters.search_1 as string;
        dispatches++;
      }
      return (run = applyStepOutcome(
        run!,
        plan,
        step.kind === "click" ? "confirmation-required" : "done",
        "Generic step result.",
      ));
    },
    stop: async () => (run = { ...run!, active: false }),
  });
  const socket = new WebSocket(`ws://127.0.0.1:${port}/extension`, {
    origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  await once(socket, "open");
  socket.send(
    JSON.stringify({
      type: "hello",
      bridgeId: bridge.bridgeId,
      token: bridge.extensionToken,
      instanceId: randomUUID(),
    }),
  );
  await once(socket, "message");
  socket.on("message", (bytes) => {
    const m = JSON.parse(String(bytes));
    if (m.type === "command")
      void (
        m.command.kind === "list_skills"
          ? catalog.list()
          : m.command.kind === "get_skill"
            ? catalog.get(m.command.skillId)
            : controller.handle(
                {
                  controllerId: m.controllerId,
                  bridgeId: m.bridgeId,
                  connectionId: m.connectionId,
                },
                m.command,
              )
      )
        .catch(() => ({ status: "blocked" }))
        .then((value) =>
          socket.send(
            JSON.stringify({ type: "result", id: m.id, result: value }),
          ),
        );
    if (
      m.type === "controller_disconnected" &&
      session &&
      session.controllerId === m.controllerId &&
      run?.active
    ) {
      run = { ...run, pauseReason: "user" };
      session = { ...session, observation: undefined, selected: undefined };
    }
  });
  const clients: Client[] = [];
  async function client() {
    const c = new Client({ name: "vertical-test", version: "1.0" });
    clients.push(c);
    await c.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--experimental-strip-types", resolve("src/server.ts")],
        env: { ...process.env, SMO_MCP_CONNECTION_FILE: file } as Record<
          string,
          string
        >,
        stderr: "pipe",
      }),
    );
    return c;
  }
  const c = await client(),
    other = await client();
  const call = async (name: string, args: Record<string, unknown>) =>
    (await c.callTool({ name, arguments: args })).structuredContent as Record<
      string,
      any
    >;
  try {
    const discovered = await call("list_skills", {});
    assert.ok(
      discovered.skills.some(
        (skill: { id: string }) => skill.id === "local:demo",
      ),
    );
    const document = await call("get_skill", { skillId: "local:demo" });
    for (const value of ["Grace Hopper", "Alan Turing"]) {
      const started = await call("start_skill", {
          markdown: document.skill.markdown,
          parameters: { search_1: value },
        }),
        runId = started.runId;
      assert.equal(
        (
          (
            await other.callTool({
              name: "get_run_status",
              arguments: { runId },
            })
          ).structuredContent as { status: string }
        ).status,
        "blocked",
      );
      assert.equal(
        (
          (
            await other.callTool({
              name: "start_skill",
              arguments: { markdown, parameters: { search_1: "Other" } },
            })
          ).structuredContent as { status: string }
        ).status,
        "blocked",
      );
      for (const action of ["checkpoint", "fill", "click"]) {
        const observed = await call("observe_run", { runId });
        assert.ok(!JSON.stringify(observed).includes(value));
        const outcome = await call("act", {
          runId,
          stepIndex: observed.stepIndex,
          observationId: observed.observation.id,
          action,
          ...(action === "checkpoint" ? {} : { targetId: "c1" }),
        });
        if (action === "click") assert.equal(outcome.status, "needs_approval");
      }
      assert.equal(field, value);
      assert.equal(result, "");
      assert.equal(
        (await call("get_run_status", { runId })).status,
        "needs_approval",
      );
      // Simulate the extension UI's consent; no MCP tool supplies approval.
      result = field;
      dispatches++;
      run = applyStepOutcome(run!, plan, "done", "Approved in UI.");
      run = { ...run, navigationObserved: true };
      const observed = await call("observe_run", { runId });
      assert.equal(
        (
          await call("act", {
            runId,
            stepIndex: observed.stepIndex,
            observationId: observed.observation.id,
            action: "checkpoint",
          })
        ).status,
        "completed",
      );
      assert.equal(result, value);
      assert.ok(!JSON.stringify(run).includes(value));
    }
    const stopped = await call("start_skill", {
      markdown,
      parameters: { search_1: "Stop test" },
    });
    assert.equal(
      (await call("stop_run", { runId: stopped.runId })).status,
      "stopped",
    );
    assert.equal(
      (await call("observe_run", { runId: stopped.runId })).status,
      "stopped",
    );
    assert.equal(dispatches, 4);
    const disconnected = await call("start_skill", {
      markdown,
      parameters: { search_1: "Disconnect test" },
    });
    await c.close();
    for (let n = 0; n < 20 && run?.pauseReason !== "user"; n++)
      await new Promise((r) => setTimeout(r, 25));
    assert.equal(run?.id, disconnected.runId);
    assert.equal(run?.pauseReason, "user");
    assert.equal(dispatches, 4);
  } finally {
    for (const c of clients) await c.close();
    socket.terminate();
    await bridge.close();
    await rm(file);
    await rmdir(folder);
  }
});
