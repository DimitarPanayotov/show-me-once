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

async function fixture({ holdModel = false, provider = "openai", signedIn = true, mcp = false, initialTabUrl = 'https://example.com', draft, failMcpSession = false, focusedUrl, noWindow = false, holdStart = false, library } = {}) {
  const mcpBridgeId = randomUUID(), mcpConnectionId = randomUUID(), mcpControllerId = randomUUID();
  const mcpReplies = new Map();
  let mcpSocket;
  class Socket {
    static OPEN = 1;
    readyState = 0;
    constructor() { mcpSocket = this; queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
    send(text) {
      const value = JSON.parse(text);
      if (value.type === 'hello') queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'connected', bridgeId: mcpBridgeId, connectionId: mcpConnectionId }) }));
      else if (value.type === 'result') { mcpReplies.get(value.id)?.(value.result); mcpReplies.delete(value.id); }
    }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const local = { agentConfig: { provider, model: "test-model" },
      ...(draft ? { skillDraft: structuredClone(draft) } : {}),
      ...(mcp ? { mcpPair: { token: 'test-only-mcp-credential-that-is-long-enough', bridgeId: mcpBridgeId, instanceId: randomUUID() } } : {}),
    },
    session = {
      ...(signedIn ? { account: {
        token: "test-session",
        user: { id: "owner", email: "owner@example.test" },
      } } : {}),
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
    set: async (values) => {
      if (failMcpSession && store === session && values.externalSession) throw new Error('Private storage failure password=not-for-the-agent');
      return Object.assign(store, structuredClone(values));
    },
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
    tabUrl = initialTabUrl,
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
  const createdTabs = [];
  let taskTabUrl;
  let startComplete = !holdStart;
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
    windows: {
      onCreated: { addListener() {} },
      getAll: async () => noWindow ? [] : [{ id: 3, focused: true }],
      create: async (options) => { createdTabs.push({ ...options, id: 19 }); taskTabUrl = options.url; return { tabs: [{ id: 19 }] }; },
    },
    tabs: {
      create: async (options) => { createdTabs.push({ ...options, id: 19 }); taskTabUrl = options.url; return { id: 19 }; },
      query: async (query) => query.windowType === 'normal'
        ? [{ id: 1, url: tabUrl }, ...(focusedUrl ? [{ id: 2, url: focusedUrl }] : [])]
        : [{ id: focusedUrl ? 2 : 1, url: focusedUrl ?? tabUrl }],
      get: async id => id === 19
        ? { id, url: startComplete ? taskTabUrl : 'about:blank', status: startComplete ? 'complete' : 'loading' }
        : ({ id: 1, url: tabUrl, status: "complete" }),
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
          if (_id === 19) taskTabUrl = tabUrl;
          schedule(
            () => tabUpdated(_id, { status: "complete" }, { url: tabUrl }),
            1,
          );
          return { status: "done" };
        }
        throw new Error("Unexpected content operation " + m.type);
      },
    },
  };
  const fetcher = async (url, options) => {
    if (url === 'http://127.0.0.1:4320/pair') return Response.json({ bridgeId: mcpBridgeId });
    const path = new URL(url).pathname.replace("/api/rpc/", "");
    const input = JSON.parse(options.body).json;
    const envelope = (json) => Response.json({ json });
    if (path === 'skill/list') return envelope(library ? [library] : []);
    if (path === "skill/get")
      return envelope(library ?? { currentVersion: 1, versions: [{ markdown }] });
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
    WebSocket: Socket,
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
    createdTabs,
    finishStart: () => { startComplete = true; },
    post,
    async callMcp(command) {
      await post({ type: 'mcp-connect' });
      const id = randomUUID();
      return new Promise(resolve => {
        mcpReplies.set(id, resolve);
        mcpSocket.onmessage({ data: JSON.stringify({ type: 'command', id, controllerId: mcpControllerId, bridgeId: mcpBridgeId, connectionId: mcpConnectionId, command }) });
      });
    },
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
      await post({ type: 'mcp-disconnect' });
      for (const timer of timers) clearTimeout(timer);
    },
  };
}

test('signed-out MCP opens the built-in task automatically without model or backend access', async () => {
  const f = await fixture({ signedIn: false, mcp: true, initialTabUrl: 'https://github.com/search/advanced' });
  try {
    const skill = await f.callMcp({ kind: 'get_skill', skillId: 'example:github-issue-triage' });
    const result = await f.callMcp({ kind: 'start', markdown: skill.skill.markdown, parameters: { repository: 'microsoft/vscode', topic: 'terminal', state: 'open', label: 'bug' } });
    assert.equal(result.status, 'waiting'); assert.ok(result.runId);
    assert.equal(f.local.runState.engine, 'external'); assert.equal(f.session.account, undefined);
    assert.deepEqual(f.decisions, []); assert.deepEqual(f.history, []);
    assert.equal(f.session.mcpLastError, undefined);
    assert.equal(f.createdTabs.length, 1);
    assert.equal(f.createdTabs[0].url, 'https://github.com/search/advanced');
    const repeated = await f.callMcp({ kind: 'start', markdown: skill.skill.markdown, parameters: { repository: 'microsoft/vscode', topic: 'terminal', state: 'open', label: 'bug' } });
    assert.equal(repeated.errorCode, 'ACTIVE_TASK'); assert.equal(repeated.status, 'blocked');
    assert.equal(f.createdTabs.length, 1);
  } finally { await f.close(); }
});

test('MCP opens a dedicated tab or normal window, waits for initial loading, and never uses the unrelated focused tab', async () => {
  for (const noWindow of [false, true]) {
    const f = await fixture({ signedIn: false, mcp: true, initialTabUrl: 'https://example.com/private', focusedUrl: 'https://other.example', noWindow, holdStart: true });
    try {
      const result = await f.callMcp({ kind: 'start', skillId: 'example:github-issue-triage', parameters: { repository: 'microsoft/vscode', topic: 'terminal', state: 'open', label: 'bug' } });
      assert.equal(result.status, 'waiting'); assert.equal(f.local.runState.tabId, 19);
      assert.equal(f.createdTabs.length, 1);
      assert.equal(f.createdTabs[0].url, 'https://github.com/search/advanced');
      assert.equal(f.createdTabs[0].windowId, noWindow ? undefined : 3);
      assert.equal((await f.callMcp({ kind: 'observe', runId: result.runId })).status, 'waiting');
      f.finishStart(); // No onUpdated event: polling must recover a raced event.
      assert.equal((await f.callMcp({ kind: 'status', runId: result.runId })).status, 'ready');
      const observed = await f.callMcp({ kind: 'observe', runId: result.runId });
      assert.equal(observed.observation.url, 'https://github.com/…/…');
      assert.doesNotMatch(JSON.stringify(f.local.runState), /private|other.example|search\/advanced/);
      assert.deepEqual(f.decisions, []); assert.deepEqual(f.history, []);
    } finally { await f.close(); }
  }
});

test('a session-write failure after persisting a run reports its real ID as uncertain without exposing exception text', async () => {
  const f = await fixture({ signedIn: false, mcp: true, initialTabUrl: 'https://github.com/search/advanced', failMcpSession: true });
  try {
    const skill = await f.callMcp({ kind: 'get_skill', skillId: 'example:github-issue-triage' });
    const result = await f.callMcp({ kind: 'start', markdown: skill.skill.markdown, parameters: { repository: 'microsoft/vscode', topic: 'terminal', state: 'open', label: 'bug' } });
    assert.equal(result.status, 'unknown_outcome'); assert.equal(result.errorCode, 'START_OUTCOME_UNKNOWN');
    assert.equal(result.runId, f.local.runState.id);
    assert.doesNotMatch(JSON.stringify(result), /not-for-the-agent|password=/);
    assert.deepEqual(f.dispatches, []);
  } finally { await f.close(); }
});

test('the actual worker starts the example signed out while preserving unfinished cloud edits and restores them only to their owner', async () => {
  const pending = { sourceRecordingId: 'cloud-recording', remoteSkillId: 'cloud', ownerId: 'owner', savedVersion: 2,
    dirty: true, readOnly: false, name: 'unfinished-task', description: 'Unfinished private edits.', markdown: '---\nname: "unfinished' };
  const library = { id: 'cloud', title: 'Saved version', description: 'Saved description.', ownerId: 'owner', currentVersion: 2, versions: [{ markdown }] };
  const f = await fixture({ signedIn: false, mcp: true, draft: pending, library });
  try {
    const skill = await f.callMcp({ kind: 'get_skill', skillId: 'example:github-issue-triage' });
    const started = await f.callMcp({ kind: 'start', markdown: skill.skill.markdown,
      parameters: { repository: 'microsoft/vscode', topic: 'terminal', state: 'open', label: 'bug' } });
    assert.equal(started.status, 'waiting'); assert.ok(started.runId);
    assert.equal(f.createdTabs.length, 1);
    assert.deepEqual(f.local.localSkills, [pending]);
    assert.equal(f.session.account, undefined); assert.equal(f.session.mcpLastError, undefined);
    const listed = await f.callMcp({ kind: 'list_skills' });
    assert.doesNotMatch(JSON.stringify(listed), /unfinished|private|cloud/);
    assert.deepEqual(f.history, []); assert.deepEqual(f.decisions, []);
    await f.callMcp({ kind: 'stop', runId: started.runId });
    await assert.rejects(f.post({ type: 'mcp-open-skill', skillId: 'library:cloud' }), /Sign in/);
    f.session.account = { token: 'test-session', user: { id: 'other', email: 'other@example.test' } };
    const shared = await f.post({ type: 'mcp-open-skill', skillId: 'library:cloud' });
    assert.equal(shared.readOnly, true); assert.equal(shared.markdown, markdown);
    assert.ok(f.local.localSkills.some(d => d.markdown === pending.markdown));
    f.session.account.user.id = 'owner';
    const restored = await f.post({ type: 'mcp-open-skill', skillId: 'library:cloud' });
    assert.equal(restored.markdown, pending.markdown); assert.equal(restored.name, pending.name);
    assert.equal(restored.remoteSkillId, 'cloud'); assert.equal(restored.savedVersion, 2);
    assert.equal(f.local.localSkills.some(d => d.remoteSkillId === 'cloud'), false);
    const invalid = await f.callMcp({ kind: 'get_skill', skillId: 'library:cloud' });
    assert.notEqual(invalid.status, 'ready');
    assert.doesNotMatch(JSON.stringify(invalid), /unfinished|private/);
  } finally { await f.close(); }
});

test('arbitrary undiscovered Markdown is still blocked before opening any tab', async () => {
  const f = await fixture({ signedIn: false, mcp: true });
  try {
    const result = await f.callMcp({ kind: 'start', markdown, parameters: { search_1: 'Alpha' } });
    assert.equal(result.status, 'blocked'); assert.equal(result.errorCode, 'SKILL_REFRESH_REQUIRED');
    assert.equal(result.runId, undefined); assert.equal(f.createdTabs.length, 0);
  } finally { await f.close(); }
});

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
    for (const type of ['mcp-begin', 'mcp-approve', 'mcp-disconnect'])
      assert.throws(() => f.untrusted({ type, pairingId: 'fake' }), /Only extension pages/);
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

test('a legacy skill asks for its redacted starting route in chat and opens a supplied public route without logging it', async () => {
  const legacy = createSkillMarkdown({ id: 'legacy', tabId: 1, active: false, startedAt: '', actions: [{ id: '1', at: '', kind: 'navigation', url: 'https://example.org/…/…' }] }, 'legacy-task', 'Public task.');
  const f = await fixture({ signedIn: false, mcp: true, draft: { sourceRecordingId: 'legacy', name: 'legacy-task', description: 'Public task.', markdown: legacy } });
  try {
    const skill = await f.callMcp({ kind: 'get_skill', skillId: 'local:legacy' });
    assert.equal(skill.skill.startUrl, '');
    const missing = await f.callMcp({ kind: 'start', skillId: 'local:legacy', parameters: {} });
    assert.equal(missing.errorCode, 'START_ADDRESS_REQUIRED'); assert.match(missing.message, /in chat/);
    assert.equal(f.createdTabs.length, 0);
    const started = await f.callMcp({ kind: 'start', skillId: 'local:legacy', parameters: {}, startUrl: 'https://example.org/search/advanced' });
    assert.equal(started.status, 'waiting'); assert.equal(f.createdTabs.length, 1);
    assert.equal(f.createdTabs[0].url, 'https://example.org/search/advanced');
    assert.doesNotMatch(JSON.stringify(f.local.runState), /search\/advanced/);
    assert.doesNotMatch(f.session.externalSession.markdown, /search\/advanced/);
  } finally { await f.close(); }
});

test('actual worker gates native MCP approval, preserves the browser fallback and completes an automatic run after one explicit decision', async () => {
  const f = await fixture({ signedIn: false, mcp: true, draft: { sourceRecordingId: 'recorded', name: 'search-example', description: 'Search for a new topic.', markdown } });
  try {
    const started = await f.callMcp({ kind: 'start', skillId: 'local:recorded', parameters: { search_1: 'Alpha' } });
    const runId = started.runId;
    const act = async (action, targetId) => {
      const page = await f.callMcp({ kind: 'observe', runId });
      return f.callMcp({ kind: 'act', runId, stepIndex: page.stepIndex, observationId: page.observation.id, action, ...(targetId ? { targetId } : {}) });
    };
    await act('checkpoint'); await act('fill', 'c1');
    assert.equal((await act('click', 'c2')).status, 'needs_approval');
    const pending = await f.callMcp({ kind: 'approval_preview', runId });
    assert.equal(pending.approval.title, 'Submit search on example.com');
    assert.match(pending.approval.target, /Search/);
    assert.doesNotMatch(JSON.stringify(pending), /07118f12|Alpha/);
    assert.equal((await f.callMcp({ kind: 'status', runId })).approval, undefined);
    assert.equal(f.session.runConfirmation.details.token, '07118f12-a190-4ddd-9dd9-d7ee5e69f98b');
    const cancelled = await f.callMcp({ kind: 'approval_decide', runId, reviewId: pending.approval.reviewId, approved: false });
    assert.equal(cancelled.status, 'needs_approval'); assert.deepEqual(f.dispatches, ['fill']);
    const retry = await f.callMcp({ kind: 'approval_decide', runId, reviewId: pending.approval.reviewId, approved: true });
    assert.equal(retry.errorCode, 'STALE_APPROVAL'); assert.deepEqual(f.dispatches, ['fill']);
    const fresh = await f.callMcp({ kind: 'approval_preview', runId });
    const approved = await f.callMcp({ kind: 'approval_decide', runId, reviewId: fresh.approval.reviewId, approved: true });
    assert.equal(approved.stepIndex, 3); assert.deepEqual(f.dispatches, ['fill', 'submit']);
    await until(() => f.local.runState.navigationObserved);
    assert.equal((await act('checkpoint')).status, 'completed');
    await f.callMcp({ kind: 'approval_decide', runId, reviewId: fresh.approval.reviewId, approved: true });
    assert.deepEqual(f.dispatches, ['fill', 'submit']);
    assert.doesNotMatch(JSON.stringify(f.local.runState.logs), /Alpha|Search|07118f12/);
    assert.equal(f.session.account, undefined); assert.deepEqual(f.history, []); assert.deepEqual(f.decisions, []);
  } finally { await f.close(); }
});
