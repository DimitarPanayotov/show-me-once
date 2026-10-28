import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { randomUUID, webcrypto } from "node:crypto";
import { rolldown } from "rolldown";
import { createSkillMarkdown, sanitizeUrl } from "@show-me-once/shared";
import {
  hostedProvider,
  checkedInput,
} from "../../../packages/agent/src/providers.ts";

const build = await rolldown({
  input: new URL(
    "../entrypoints/background.ts",
    import.meta.url,
  ).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  transform: {
    define: {
      "import.meta.env.WXT_API_BASE_URL": JSON.stringify(
        "https://library.example",
      ),
    },
  },
  plugins: [
    {
      name: "worker-chrome",
      resolveId(id) {
        if (id === "wxt/browser") return "\0browser";
      },
      load(id) {
        if (id === "\0browser")
          return "export const browser = globalThis.__browser;";
      },
    },
  ],
});
const output = await build.generate({ format: "iife", name: "workerFixture" });
await build.close();
const code = output.output.find((x) => x.type === "chunk").code;
const markdown = createSkillMarkdown(
  {
    id: "recorded",
    tabId: 1,
    active: false,
    startedAt: "",
    actions: [
      { id: "1", at: "", kind: "navigation", url: "https://example.com" },
      {
        id: "2",
        at: "",
        kind: "input",
        inputKind: "search",
        selector: "input:nth-of-type(1)",
        url: "https://example.com",
      },
      {
        id: "3",
        at: "",
        kind: "click",
        selector: "button:nth-of-type(1)",
        url: "https://example.com",
      },
      { id: "4", at: "", kind: "navigation", url: "https://example.com/…" },
    ],
  },
  "search-example",
  "Search for a new topic.",
);
const key = "test-only-key-never-a-live-credential";
async function until(check) {
  for (let n = 0; n < 500; n++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail("Worker did not reach the expected state.");
}

async function fixture({ holdModel = false, provider = "openai" } = {}) {
  const local = { agentConfig: { provider, model: "test-model" } },
    session = {
      account: {
        token: "test-session",
        user: { id: "owner", email: "owner@example.test" },
      },
      ...(provider === "openai"
        ? { agentApiKey: { provider: "openai", key } }
        : {}),
    };
  const area = (store) => ({
    get: async (keys) =>
      structuredClone(
        keys == null
          ? store
          : Object.fromEntries(
              (Array.isArray(keys) ? keys : [keys]).map((k) => [k, store[k]]),
            ),
      ),
    set: async (values) => Object.assign(store, structuredClone(values)),
    remove: async (keys) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
    },
    setAccessLevel: async () => {},
  });
  const timers = new Set(),
    history = [],
    dispatches = [],
    decisions = [];
  let handler,
    tabUpdated,
    tabUrl = "https://example.com",
    value = "",
    selection,
    modelStarted = false;
  const schedule = (fn, delay) => {
    const timer = setTimeout(
      () => {
        timers.delete(timer);
        fn();
      },
      Math.min(delay, 15),
    );
    timers.add(timer);
    return timer;
  };
  function decisionFor(request) {
    const step = request.plan.steps[request.stepIndex];
    return step.kind === "input"
      ? {
          action: "fill",
          targetId: "c1",
          parameter: step.parameter,
          value: request.request.split(" ").at(-1),
        }
      : { action: "click", targetId: "c2", parameter: null, value: null };
  }
  const browser = {
    storage: { local: area(local), session: area(session) },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
    },
    scripting: { executeScript: async () => {} },
    alarms: {
      get: async () => undefined,
      clear: async () => true,
      create: async () => {},
      onAlarm: { addListener() {} },
    },
    runtime: {
      id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      getURL: (path) =>
        "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/" + path,
      onMessage: {
        addListener: (fn) => {
          handler = fn;
        },
      },
      onStartup: { addListener() {} },
      connectNative(name) {
        assert.equal(name, "com.show_me_once.agent");
        let receive,
          disconnect,
          closed = false;
        return {
          onMessage: {
            addListener: (fn) => {
              receive = fn;
            },
          },
          onDisconnect: {
            addListener: (fn) => {
              disconnect = fn;
            },
          },
          disconnect() {
            closed = true;
            disconnect?.();
          },
          postMessage(message) {
            if (message.type === "status")
              return queueMicrotask(() => {
                if (!closed) receive({ ready: true });
              });
            modelStarted = true;
            if (holdModel) return;
            decisions.push(message.input.stepIndex);
            queueMicrotask(() => {
              if (!closed) receive({ decision: decisionFor(message.input) });
            });
          },
        };
      },
    },
    tabs: {
      query: async () => [{ id: 1, url: tabUrl }],
      get: async () => ({ id: 1, url: tabUrl, status: "complete" }),
      onUpdated: {
        addListener: (fn) => {
          tabUpdated = fn;
        },
      },
      sendMessage: async (_id, m) => {
        if (m.type === "recorder-ping") return true;
        if (m.type === "check-run-page") return {};
        if (m.type === "observe-agent-page") {
          assert(Array.isArray(m.navigationScope));
          selection = {
            id: randomUUID(),
            url: sanitizeUrl(tabUrl),
            controls: [
              {
                id: "c1",
                role: "input",
                inputKind: "search",
                label: "Search",
                selector: "input:nth-of-type(2)",
              },
              {
                id: "c2",
                role: "button",
                label: "Search",
                selector: "button:nth-of-type(2)",
              },
            ],
          };
          return selection;
        }
        if (m.type === "execute-agent-action") {
          assert.equal(m.observationId, selection.id);
          assert(Array.isArray(m.navigationScope));
          if (m.step.kind === "input") {
            value = m.value;
            dispatches.push("fill");
            return { status: "done" };
          }
          if (!m.confirmed)
            return {
              status: "confirmation-required",
              confirmation: {
                token: "07118f12-a190-4ddd-9dd9-d7ee5e69f98b",
                intent: "search",
                interaction: "click",
                targetLabel: "Search",
                targetTag: "button",
                origin: "https://example.com",
              },
            };
          assert.equal(m.approvalToken, "07118f12-a190-4ddd-9dd9-d7ee5e69f98b");
          dispatches.push("submit");
          tabUrl = "https://example.com/results";
          schedule(
            () => tabUpdated(1, { status: "complete" }, { url: tabUrl }),
            1,
          );
          return { status: "done" };
        }
        throw new Error("Unexpected content operation " + m.type);
      },
    },
  };
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname.replace("/api/rpc/", "");
    const input = JSON.parse(options.body).json;
    const envelope = (json) => Response.json({ json });
    if (path === "skill/get")
      return envelope({ currentVersion: 1, versions: [{ markdown }] });
    if (path === "run/start") {
      assert.equal(input.version, 1);
      return envelope({ id: randomUUID() });
    }
    if (path === "run/log") {
      history.push(input);
      return envelope({ sequence: history.length });
    }
    if (path === "run/stop") return envelope({ stopped: true });
    if (path === "agent/decide") {
      assert.equal(input.apiKey, key);
      assert.equal(input.model, "test-model");
      const request = checkedInput(input.input);
      assert(request.observation.controls.every((x) => !("value" in x)));
      modelStarted = true;
      if (holdModel)
        await new Promise((_, reject) =>
          options.signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          ),
        );
      decisions.push(request.stepIndex);
      const decision = decisionFor(request);
      const provider = hostedProvider("openai", {
        key,
        model: "test-model",
        fetcher: async () =>
          Response.json({
            output: [
              {
                type: "function_call",
                name: "browser_action",
                arguments: JSON.stringify(decision),
              },
            ],
          }),
      });
      return envelope({ decision: await provider.decide(request) });
    }
    throw new Error("Unexpected backend operation " + path);
  };
  const context = vm.createContext({
    __browser: browser,
    defineBackground: (fn) => {
      fn();
      return {};
    },
    crypto: webcrypto,
    fetch: fetcher,
    URL,
    Response,
    AbortController,
    AbortSignal,
    console,
    setTimeout: schedule,
    clearTimeout: (timer) => {
      clearTimeout(timer);
      timers.delete(timer);
    },
    setInterval,
    clearInterval,
  });
  vm.runInContext(code, context);
  await until(() => !!handler);
  const sender = {
    id: browser.runtime.id,
    url: browser.runtime.getURL("popup.html"),
  };
  const post = (m) => Promise.resolve(handler(m, sender));
  return {
    local,
    session,
    history,
    dispatches,
    decisions,
    post,
    value: () => value,
    modelStarted: () => modelStarted,
    resumeModel: () => {
      holdModel = false;
    },
    resetPage: () => {
      tabUrl = "https://example.com";
      value = "";
    },
    untrusted: (m) =>
      handler(m, { id: browser.runtime.id, tab: { id: 1 }, url: tabUrl }),
    close: async () => {
      await post({ type: "stop-run" });
      for (const timer of timers) clearTimeout(timer);
    },
  };
}

for (const provider of ["openai", "codex-local"])
  test(`actual worker automatically runs two ${provider} requests, waits for approval and syncs parameter-free backend steps`, async () => {
    const f = await fixture({ provider });
    try {
      for (const term of ["Alpha", "Beta"]) {
        f.resetPage();
        await f.post({
          type: "start-run",
          engine: "agent",
          mode: "automatic",
          markdown,
          taskRequest: "Search for " + term,
          remoteSkillId: "saved",
          skillKey: "saved",
        });
        await until(() => f.local.runState?.confirmationStep === 2);
        assert.equal(f.value(), term);
        assert.equal(
          f.dispatches.filter((x) => x === "submit").length,
          term === "Alpha" ? 0 : 1,
        );
        assert.equal(f.session.runConfirmation.details.targetLabel, "Search");
        await f.post({
          type: "run-next-step",
          confirm: true,
          approvalToken: "07118f12-a190-4ddd-9dd9-d7ee5e69f98b",
        });
        await until(() => f.local.runState?.active === false);
        assert.equal(f.local.runState.nextStep, 4);
        assert.equal(f.session.agentSession, undefined);
        assert.equal(f.session.runParameters, undefined);
        assert.equal(JSON.stringify(f.local).includes(term), false);
      }
      assert.equal(f.dispatches.filter((x) => x === "submit").length, 2);
      assert.equal(f.history.length, 10);
      assert.equal(JSON.stringify(f.history).includes(key), false);
      assert.equal(JSON.stringify(f.history).includes("Alpha"), false);
      assert.equal(JSON.stringify(f.local).includes(key), false);
    } finally {
      await f.close();
    }
  });

test("Pause cancels a subscription decision; Resume continues automatically without a chat message", async () => {
  const f = await fixture({ provider: "codex-local", holdModel: true });
  try {
    await f.post({
      type: "start-run",
      engine: "agent",
      mode: "automatic",
      markdown,
      taskRequest: "Search Alpha",
      remoteSkillId: "saved",
    });
    await until(f.modelStarted);
    await f.post({ type: "pause-run" });
    assert.equal(f.local.runState.pauseReason, "user");
    assert.equal(f.dispatches.length, 0);
    f.resumeModel();
    await f.post({ type: "resume-run" });
    await until(() => f.local.runState.confirmationStep === 2);
    await f.post({
      type: "run-next-step",
      confirm: true,
      approvalToken: "07118f12-a190-4ddd-9dd9-d7ee5e69f98b",
    });
    await until(() => !f.local.runState.active);
    assert.deepEqual(f.dispatches, ["fill", "submit"]);
  } finally {
    await f.close();
  }
});

test("Stop cancels a pending model decision and prevents browser dispatch", async () => {
  const f = await fixture({ holdModel: true });
  try {
    await f.post({
      type: "start-run",
      engine: "agent",
      mode: "automatic",
      markdown,
      taskRequest: "Search Alpha",
      remoteSkillId: "saved",
    });
    await until(f.modelStarted);
    await f.post({ type: "stop-run" });
    assert.equal(f.local.runState.active, false);
    assert.equal(f.dispatches.length, 0);
    assert.equal(f.session.agentSession, undefined);
    assert.equal(f.session.runParameters, undefined);
    await assert.rejects(
      f.post({
        type: "run-next-step",
        confirm: true,
        approvalToken: "07118f12-a190-4ddd-9dd9-d7ee5e69f98b",
      }),
      /No active run/,
    );
  } finally {
    await f.close();
  }
});

test("web pages cannot change execution credentials, and keys survive only the trusted session", async () => {
  const f = await fixture();
  try {
    assert.throws(
      () =>
        f.untrusted({
          type: "agent-configure",
          provider: "openai",
          apiKey: key,
          model: "test",
        }),
      /Only extension pages/,
    );
    await f.post({
      type: "agent-configure",
      provider: "anthropic",
      apiKey: "test-only-anthropic-key",
      model: "claude-sonnet-4-6",
    });
    assert.equal(f.session.agentApiKey.provider, "anthropic");
    assert.equal(
      JSON.stringify(f.local).includes("test-only-anthropic-key"),
      false,
    );
    await f.post({ type: "agent-forget-key" });
    assert.equal(f.session.agentApiKey, undefined);
  } finally {
    await f.close();
  }
});
