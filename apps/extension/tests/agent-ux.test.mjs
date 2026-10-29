import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { rolldown } from "rolldown";
import { Window } from "happy-dom";
import {
  SkillCatalog,
  exampleDraft,
  EXAMPLE_ID,
  keepLocalDraft,
} from "../lib/skill-catalog.ts";
import { parseSkillPlan, readSkillMetadata } from "@show-me-once/shared";

// Execute the actual popup against an in-memory document. No Chrome or browser-control tool.
const build = await rolldown({
  input: new URL(
    "../entrypoints/popup/main.ts",
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
      name: "in-memory-extension",
      resolveId(id) {
        if (id === "wxt/browser") return "\0browser";
        if (id.endsWith(".css")) return "\0style";
      },
      load(id) {
        if (id === "\0browser")
          return "export const browser = globalThis.__smoBrowser;";
        if (id === "\0style") return "";
      },
    },
  ],
});
const { output } = await build.generate({ format: "iife" });
const code = output.find((item) => item.type === "chunk").code;
await build.close();
const html = await readFile(
  new URL("../entrypoints/popup/index.html", import.meta.url),
  "utf8",
);
async function until(check) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Popup did not reach the expected state.");
}
async function fixture({
  connected = true,
  draft,
  run,
  confirmation,
  signedIn = false,
  provider = "openai",
  nativeReady = true,
  beforeSave = async () => {},
  mcpState = { paired: connected, connected },
} = {}) {
  const window = new Window({ url: "https://extension.example/popup.html" });
  window.document.write(html.replace(/<script[\s\S]*?<\/script>/, ""));
  const local = {
    agentConfig: {
      provider,
      model: provider === "openai" ? "gpt-5.4-mini" : "",
    },
    ...(draft ? { skillDraft: draft } : {}),
    ...(run
      ? { runState: run, runPlan: parseSkillPlan(exampleDraft.markdown) }
      : {}),
  };
  const session = {
    ...(provider !== "codex-local"
      ? {
          agentApiKey: { provider, key: "test-only-key-not-a-live-credential" },
        }
      : {}),
    ...(confirmation ? { runConfirmation: confirmation } : {}),
  };
  const listeners = [],
    messages = [],
    tabs = [];
  let clipboard = "",
    user = signedIn ? { id: "user-one", email: "reviewer@example.test" } : null;
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  Object.defineProperty(window.navigator, "clipboard", {
    value: {
      writeText: async (text) => {
        clipboard = text;
      },
    },
  });
  const area = (store, name) => ({
    get: async (keys) =>
      Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map((key) => [
          key,
          structuredClone(store[key]),
        ]),
      ),
    set: async (values) => {
      const changes = Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key,
          { newValue: value, oldValue: store[key] },
        ]),
      );
      Object.assign(store, structuredClone(values));
      for (const listener of listeners) listener(changes, name);
    },
    remove: async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
    },
  });
  const storage = {
    local: area(local, "local"),
    session: area(session, "session"),
    onChanged: { addListener: (fn) => listeners.push(fn) },
  };
  const catalog = new SkillCatalog({
    readLocal: async () => ({
      draft: local.skillDraft,
      skills: local.localSkills,
    }),
    listLibrary: async () => [],
    getLibrary: async () => {
      throw new Error("Not signed in");
    },
    userId: async () => user?.id,
  });
  const browser = {
    storage,
    tabs: {
      query: async () => [{ id: 17, url: 'https://github.com/search/advanced' }],
      create: async (value) => {
        tabs.push(value);
        return {};
      },
    },
    runtime: {
      id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      getURL: (path) =>
        "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" + path,
      sendMessage: async (message) => {
        messages.push(message);
        if (message.type === "mcp-status")
          return structuredClone(mcpState);
        if (message.type === 'mcp-begin') return structuredClone(mcpState);

        if (message.type === 'mcp-approve') {
          assert.equal(message.pairingId, mcpState.pending.id);
          mcpState.connected = true; mcpState.paired = true; delete mcpState.pending;
          return structuredClone(mcpState);
        }
        if (message.type === 'mcp-disconnect') {
          mcpState.connected = false; mcpState.paired = false; delete mcpState.pending;
          return structuredClone(mcpState);
        }
        if (message.type === "mcp-skills") return catalog.list();
        if (message.type === "account-status") return user;
        if (message.type === "account-login") {
          user = { id: "user-one", email: message.email };
          return user;
        }
        if (message.type === "account-logout") {
          user = null;
          return true;
        }
        if (message.type === "agent-status")
          return {
            provider: local.agentConfig.provider,
            model: local.agentConfig.model,
            hasKey:
              session.agentApiKey?.provider === local.agentConfig.provider,
            extensionOrigin:
              "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          };
        if (message.type === "agent-check-native")
          return { ready: nativeReady };
        if (message.type === "agent-configure") {
          if (message.apiKey)
            session.agentApiKey = {
              provider: message.provider,
              key: message.apiKey,
            };
          await storage.local.set({
            agentConfig: { provider: message.provider, model: message.model },
          });
          return { ok: true };
        }
        if (message.type === "agent-forget-key") {
          delete session.agentApiKey;
          return { ok: true };
        }
        if (message.type === "library-save") {
          await beforeSave();
          return { id: "saved-skill", currentVersion: message.remoteSkillId ? (local.skillDraft?.savedVersion ?? 0) + 1 : 1 };
        }
        if (message.type === "start-run") {
          await storage.local.set({
            runPlan: parseSkillPlan(message.markdown),
            runState: {
              id: "extension-run",
              active: true,
              engine: message.engine,
              mode: message.mode,
              skillKey: message.skillKey,
              tabId: 1,
              nextStep: 0,
              totalSteps: parseSkillPlan(message.markdown).steps.length,
              logs: [],
            },
          });
          return local.runState;
        }
        if (message.type === "get-run") return local.runState ?? null;
        if (message.type === "mcp-open-skill") {
          const value = await catalog.load(message.skillId, { forEditing: true });
          await storage.local.set({
            skillDraft: value,
            localSkills: keepLocalDraft(
              local.localSkills ?? [],
              local.skillDraft,
            ),
          });
          return value;
        }
        if (message.type === "start-recording") {
          const plan = parseSkillPlan(exampleDraft.markdown);
          await storage.local.set({
            recording: {
              id: "recorded",
              tabId: 1,
              active: true,
              startedAt: new Date().toISOString(),
              actions: plan.steps.map((step, index) => ({
                ...step,
                id: String(index),
                at: new Date().toISOString(),
              })),
            },
          });
          return local.recording;
        }
        if (message.type === "stop-recording") {
          await storage.local.set({
            recording: { ...local.recording, active: false },
          });
          return local.recording;
        }
        if (message.type === "pause-run")
          await storage.local.set({
            runState: { ...local.runState, pauseReason: "user" },
          });
        else if (message.type === "resume-run")
          await storage.local.set({
            runState: { ...local.runState, pauseReason: undefined },
          });
        else if (message.type === "stop-run")
          await storage.local.set({
            runState: { ...local.runState, active: false },
          });
        else if (message.type === "run-next-step") {
          assert.equal(message.confirm, true);
          assert.equal(message.approvalToken, confirmation.details.token);
        } else throw new Error("Unexpected popup operation: " + message.type);
        return local.runState;
      },
    },
  };
  window.__smoBrowser = browser;
  window.eval(code);
  await until(() => window.document.documentElement.dataset.ready === "true");
  const element = (id) => window.document.getElementById(id);
  return {
    window,
    local,
    session,
    messages,
    tabs,
    catalog,
    storage,
    element,
    clipboard: () => clipboard,
    close: () => window.happyDOM.abort(),
  };
}

test("the main example opens an editable request and Run; the external coding agent is optional", async () => {
  const f = await fixture();
  try {
    for (const id of ["run-engine", "run-mode", "run-next", "agent-pair"])
      assert.equal(f.element(id), null);
    assert.match(f.element("mcp-status").textContent, /Connected/);
    f.element("try-example").click();
    await until(() => f.tabs.length === 1);
    assert.equal(f.tabs[0].url, "https://github.com/search/advanced");
    assert.equal(f.clipboard(), "");
    assert.match(
      f.element("task-request").value,
      /microsoft\/vscode.*terminal/,
    );
    assert.equal(f.element("task-request").readOnly, false);
    assert.equal(f.element("external-agent-details").open, false);
    assert.equal(f.element("run-start").textContent, "Sign in to run");
    assert.equal(f.local.skillDraft.sourceRecordingId, EXAMPLE_ID);
    assert.equal(f.element("current-meta").textContent, "Example skill");
    assert.equal(f.element("error").textContent, "");
    assert.equal(
      f.messages.some((m) => m.type === "start-run"),
      false,
    );
  } finally {
    await f.close();
  }
});

test("first launch works without external pairing and keeps its integration collapsed", async () => {
  const f = await fixture({
    connected: false,
    provider: "codex-local",
    nativeReady: false,
  });
  try {
    assert.equal(f.element("mcp-settings").open, false);
    assert.equal(f.element("mcp-pair-form").hidden, false);
    assert.equal(
      f.element("mcp-pair-form").querySelectorAll("ol li").length,
      3,
    );
    assert.equal(f.element("mcp-guide"), null);
    assert.equal(f.element("try-example").disabled, false);
    assert.equal(f.element("external-agent-details").open, false);
    assert.equal(f.element("start").disabled, false);
    assert.equal(f.tabs.length, 0);
  } finally {
    await f.close();
  }
});

test('MCP picker provides agent-specific setup and a code approval without exposing ID or secret inputs', async () => {
  const mcpState = { paired: false, connected: false };
  const f = await fixture({ connected: false, mcpState });
  try {
    assert.equal(f.window.document.getElementById('mcp-extension-id'), null);
    assert.equal(f.window.document.getElementById('mcp-code'), null);
    assert.match(f.element('mcp-install-command').value, /^codex mcp add/);
    const select = f.element('mcp-agent');
    select.value = 'claude-code'; select.dispatchEvent(new f.window.Event('change'));
    assert.match(f.element('mcp-install-command').value, /^claude mcp add/);
    f.element('mcp-copy-command').click();
    await until(() => f.clipboard().startsWith('claude mcp add') && f.element('mcp-install-notice').textContent.includes('Run it once'));
    assert.match(f.element('mcp-install-notice').textContent, /Run it once/);
    select.value = 'cursor'; select.dispatchEvent(new f.window.Event('change'));
    assert.equal(f.element('mcp-install-command').hidden, true);
    assert.match(f.element('mcp-install-link').href, /^cursor:/);
    mcpState.pending = { id: 'pending-connection', code: '123456', expiresAt: Date.now() + 120000 };
    await f.storage.session.set({ mcpConnectionChanged: 'pending' });
    await until(() => !f.element('mcp-approval').hidden);
    assert.equal(f.element('mcp-pairing-code').textContent, '123456');
    assert.match(f.element('mcp-status').textContent, /approval needed/);
    f.element('mcp-approve').click();
    await until(() => f.element('mcp-status').textContent.includes('✓ Connected'));
    assert.equal(f.element('mcp-approval').hidden, true);
    assert.equal(f.element('mcp-disconnect').hidden, false);
    assert.equal(f.messages.some(m => m.type === 'start-run' || m.type === 'agent-configure'), false);
  } finally { await f.close(); }
});

test('MCP connection explains automatic page opening without a tab-selection control', async () => {
  const f = await fixture({ draft: exampleDraft });
  try {
    assert.match(f.element('mcp-connected-help').textContent, /opens the task page automatically/);
    assert.equal(f.window.document.getElementById('mcp-use-tab'), null);
    assert.equal(f.messages.some(m => m.type === 'mcp-select-tab'), false);
    assert.equal(f.element('open-start-page'), null);
    f.element('copy-request').click();
    await until(() => f.clipboard().includes('Show Me Once'));
    assert.equal(f.tabs.length, 0);
    assert.match(f.element('handoff-help').textContent, /opens the task page automatically/);
  } finally { await f.close(); }
});

test('MCP run rejection is visible separately from its successful connection and clears after success', async () => {
  const mcpState = { paired: true, connected: true, runError: 'Run not started: Stop the current recording or run in Show Me Once.' };
  const f = await fixture({ mcpState });
  try {
    assert.match(f.element('mcp-status').textContent, /Connected/);
    assert.equal(f.element('mcp-run-error').textContent, mcpState.runError);
    delete mcpState.runError;
    await f.storage.session.set({ mcpLastError: undefined });
    await until(() => f.element('mcp-run-error').textContent === '');
    assert.match(f.element('mcp-status').textContent, /Connected/);
  } finally { await f.close(); }
});

test("Run saves the skill and starts an automatic extension agent without a connected external chat", async () => {
  const f = await fixture({
    draft: exampleDraft,
    connected: false,
    signedIn: true,
  });
  try {
    const input = f.element("task-request");
    input.focus();
    input.value =
      "Find open issues in microsoft/TypeScript about inference with label bug.";
    input.dispatchEvent(new f.window.Event("input", { bubbles: true }));
    assert.equal(f.window.document.activeElement, input);
    f.element("run-form").dispatchEvent(
      new f.window.Event("submit", { bubbles: true, cancelable: true }),
    );
    await until(() => f.local.runState?.active);
    const message = f.messages.find((m) => m.type === "start-run");
    assert.equal(message.engine, "agent");
    assert.equal(message.mode, "automatic");
    assert.equal(message.remoteSkillId, "saved-skill");
    assert.match(message.taskRequest, /inference/);
    assert(
      f.messages.findIndex((m) => m.type === "library-save") <
        f.messages.indexOf(message),
    );
    assert.equal(JSON.stringify(f.local).includes("about inference"), false);
    assert.equal(f.tabs.length, 0);
    assert.equal(f.clipboard(), "");
    assert.equal(f.element("run-controls").hidden, false);
    assert.equal(f.element("run-setup").hidden, true);
  } finally {
    await f.close();
  }
});

test("API keys are entered under settings, cleared from the field and kept outside persistent popup state", async () => {
  const f = await fixture({ draft: exampleDraft, signedIn: true });
  try {
    f.element("agent-api-key").value = "test-only-replacement-key";
    f.element("agent-api-key").dispatchEvent(
      new f.window.Event("input", { bubbles: true }),
    );
    f.element("run-form").dispatchEvent(
      new f.window.Event("submit", { cancelable: true }),
    );
    assert.equal(f.element("execution-settings").open, true);
    assert.equal(
      f.messages.some((m) => m.type === "start-run"),
      false,
    );
    f.element("save-agent-settings").click();
    await until(() =>
      f.element("agent-settings-notice").textContent.includes("saved"),
    );
    assert.equal(f.element("agent-api-key").value, "");
    assert.equal(
      JSON.stringify(f.local).includes("test-only-replacement-key"),
      false,
    );
    assert.equal(f.session.agentApiKey.key, "test-only-replacement-key");
    f.element("forget-api-key").click();
    await until(() => !f.session.agentApiKey);
    await until(() => f.element("run-start").textContent === "Set up agent");
  } finally {
    await f.close();
  }
});

test("a secret in a task request cannot start or save a run", async () => {
  const f = await fixture({ draft: exampleDraft, signedIn: true });
  try {
    f.element("task-request").value = "password=do-not-submit-this";
    f.element("run-form").dispatchEvent(
      new f.window.Event("submit", { cancelable: true }),
    );
    await until(() => f.element("run-error").textContent.includes("secrets"));
    assert.equal(
      f.messages.some(
        (m) => m.type === "start-run" || m.type === "library-save",
      ),
      false,
    );
  } finally {
    await f.close();
  }
});

test("a clean cached Wikipedia starter upgrades to issue triage without archiving or overwriting user recordings", async () => {
  const f = await fixture({
    draft: {
      ...exampleDraft,
      sourceRecordingId: "example:wikipedia-search",
      name: "Wikipedia search",
    },
  });
  try {
    assert.equal(f.local.skillDraft.sourceRecordingId, EXAMPLE_ID);
    assert.deepEqual(f.local.localSkills, []);
    assert.match(f.element("agent-request").value, /microsoft\/vscode/);
    assert.equal(f.element("open-start-page"), null);
  } finally {
    await f.close();
  }
});
test("a recorded skill is usable without an account and continuous edits keep focus", async () => {
  const f = await fixture();
  try {
    f.element("tab-record").click();
    f.element("start").click();
    await until(() => f.local.recording?.active === true);
    f.element("stop").click();
    await until(() => f.local.skillDraft?.sourceRecordingId === "recorded");
    const input = f.element("skill-name");
    input.focus();
    input.value = "";
    for (const character of "My custom task") {
      input.value += character;
      input.dispatchEvent(new f.window.Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 2));
      assert.equal(f.window.document.activeElement, input);
    }
    await until(() => f.local.skillDraft.name === "My custom task");
    f.element("try-skill").click();
    await until(() => f.element("view-run").hidden === false);
    f.element("copy-request").click();
    await until(() => f.clipboard().includes("local:recorded"));
    assert.match(f.clipboard(), /My custom task/);
    assert.ok((await f.catalog.get("local:recorded")).skill.markdown);
    assert.equal(
      f.messages.some((m) => m.type === "account-login"),
      false,
    );
  } finally {
    await f.close();
  }
});
test("saved name mismatch is repaired locally and saving persists a coherent new document", async () => {
  const original = exampleDraft.markdown;
  const f = await fixture({ signedIn: true, draft: {
    ...exampleDraft, sourceRecordingId: 'recorded', name: 'github-issue-triage-test-61',
    description: 'My customized description.', readOnly: false, remoteSkillId: 'saved-skill', savedVersion: 1,
  } });
  try {
    assert.equal(f.local.skillDraft.dirty, true);
    assert.equal(f.element('draft-label').textContent, 'Draft');
    assert.match(f.element('notice').textContent, /Unsaved changes/);
    const edited = f.element('skill-markdown').value;
    assert.deepEqual(readSkillMetadata(edited), { name: 'github-issue-triage-test-61', description: 'My customized description.' });
    assert.deepEqual(parseSkillPlan(edited), parseSkillPlan(original));
    assert.equal(edited.slice(edited.indexOf('# Instructions')), original.slice(original.indexOf('# Instructions')));
    f.element('save-library').click();
    await until(() => f.local.skillDraft.dirty === false);
    assert.equal(f.local.skillDraft.savedVersion, 2);
    const save = f.messages.find(m => m.type === 'library-save');
    assert.equal(readSkillMetadata(save.markdown).name, save.name);
    assert.equal(readSkillMetadata(save.markdown).description, save.description);
    assert.equal(f.element('save-library').textContent, '✓ Saved to library');
  } finally { await f.close(); }
});

test("a pending save locks editing and task switching until the exact submitted snapshot is saved", async () => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const f = await fixture({ signedIn: true, beforeSave: () => pending,
    draft: { ...exampleDraft, sourceRecordingId: 'recorded', readOnly: false, dirty: true },
  });
  try {
    f.element('save-library').click();
    await until(() => f.messages.some(m => m.type === 'library-save'));
    for (const id of ['skill-name', 'skill-description', 'skill-markdown', 'start', 'try-example', 'run-start', 'generate', 'library-load'])
      assert.equal(f.element(id).disabled, true, id + ' must be locked while saving');
    complete();
    await until(() => f.local.skillDraft.dirty === false && !f.element('skill-name').disabled);
    const submitted = f.messages.find(m => m.type === 'library-save');
    assert.equal(f.local.skillDraft.markdown, submitted.markdown);
  } finally { complete(); await f.close(); }
});

test("editing either metadata surface keeps the popup focused and incomplete YAML remains editable", async () => {
  const f = await fixture({ draft: { ...exampleDraft, sourceRecordingId: 'recorded', readOnly: false, dirty: true } });
  try {
    const input = f.element('skill-name');
    input.focus(); input.value = 'My renamed task';
    input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    await until(() => readSkillMetadata(f.local.skillDraft.markdown).name === 'My renamed task');
    assert.equal(f.window.document.activeElement, input);
    const textarea = f.element('skill-markdown');
    textarea.focus();
    textarea.value = textarea.value.replace('name: My renamed task', 'name: direct-edit');
    textarea.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    await until(() => f.element('skill-name').value === 'direct-edit');
    assert.equal(f.window.document.activeElement, textarea);
    textarea.value = '---\nname: "unfinished';
    textarea.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    await until(() => f.element('save-library').disabled);
    assert.equal(f.element('download').disabled, true);
    assert.equal(textarea.value, '---\nname: "unfinished');
    assert.equal(f.window.document.activeElement, textarea);
    assert.match(f.element('metadata-error').textContent, /header/);
  } finally { await f.close(); }
});

test("active agent runs expose action-specific approval and Pause/Resume/Stop without a manual step button", async () => {
  const run = {
    id: "run-one",
    tabId: 1,
    active: true,
    engine: "external",
    mode: "automatic",
    skillKey: EXAMPLE_ID,
    nextStep: 5,
    totalSteps: 12,
    confirmationStep: 5,
    logs: [],
  };
  const confirmation = {
    runId: run.id,
    step: 5,
    details: {
      token: "07118f12-a190-4ddd-9dd9-d7ee5e69f98b",
      intent: "search",
      interaction: "click",
      targetLabel: "Search",
      targetTag: "button",
      origin: "https://github.com",
    },
  };
  const f = await fixture({ draft: exampleDraft, run, confirmation });
  try {
    assert.match(
      f.element("confirmation-title").textContent,
      /Submit search on github.com/,
    );
    assert.equal(f.element("run-setup").hidden, true);
    assert.equal(f.element("run-confirm").disabled, false);
    f.element("run-confirm").click();
    await until(() => f.messages.some((m) => m.type === "run-next-step"));
    await f.storage.local.set({
      runState: { ...run, confirmationStep: undefined },
    });
    await until(() => !f.element("run-pause").hidden);
    f.element("run-pause").click();
    await until(() => f.local.runState.pauseReason === "user");
    f.element("run-resume").click();
    await until(() => !f.local.runState.pauseReason);
    f.element("run-stop").click();
    await until(() => f.local.runState.active === false);
    assert.equal(f.element("run-next"), null);
  } finally {
    await f.close();
  }
});

test("the actual content executor exposes a search redirect button, requires approval and rejects cross-origin submitter overrides", async () => {
  const bundle = await rolldown({
    input: new URL(
      "../entrypoints/content.ts",
      import.meta.url,
    ).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    plugins: [
      {
        name: "fake-chrome",
        resolveId(id) {
          if (id === "wxt/browser") return "\0browser";
        },
        load(id) {
          if (id === "\0browser")
            return "export const browser = globalThis.__smoBrowser;";
        },
      },
    ],
  });
  const compiled = await bundle.generate({
    format: "iife",
    name: "contentFixture",
  });
  await bundle.close();
  const window = new Window({ url: "https://www.wikipedia.org/" });
  window.document.write(
    '<form id="search" action="//www.wikipedia.org/search-redirect.php"><input type="search" name="search" aria-label="Search" value="do-not-send-this-value"></form><button id="go" type="submit" form="search">Search</button>',
  );
  window.HTMLElement.prototype.getClientRects = () => [
    { width: 100, height: 30 },
  ];
  window.HTMLElement.prototype.scrollIntoView = () => {};
  let handler,
    clicks = 0;
  window.__smoBrowser = {
    storage: { onChanged: { addListener() {} } },
    runtime: {
      onMessage: {
        addListener(fn) {
          handler = fn;
        },
      },
      sendMessage: async () => ({ active: false }),
    },
  };
  window.defineContentScript = (config) => {
    config.main({
      isValid: true,
      setTimeout: (...args) => window.setTimeout(...args),
      setInterval: () => 0,
      addEventListener: (target, ...args) => target.addEventListener(...args),
    });
    return config;
  };
  try {
    window.eval(compiled.output.find((item) => item.type === "chunk").code);
    const call = (message) => {
      let result;
      handler(message, {}, (value) => {
        result = value;
      });
      return result;
    };
    const step = {
      kind: "click",
      url: "https://www.wikipedia.org",
      selector: "button:nth-of-type(1)",
    };
    const navigationScope = [step.url, "https://en.wikipedia.org/…/…"];
    const observe = () =>
      call({ type: "observe-agent-page", step, navigationScope });
    const observation = observe();
    const target = observation.controls.find(
      (control) => control.role === "button" && control.label === "Search",
    );
    assert.ok(
      target,
      "The same-origin redirect submitter must be discoverable, including a form-associated external button.",
    );
    assert.doesNotMatch(JSON.stringify(observation), /do-not-send-this-value/);
    window.document.getElementById("go").click = () => {
      clicks++;
    };
    const request = {
      type: "execute-agent-action",
      step,
      navigationScope,
      observationId: observation.id,
      targetId: target.id,
      executionKey: "run:2",
    };
    const pending = call(request);
    assert.equal(pending.status, "confirmation-required");
    assert.equal(pending.confirmation.intent, "search");
    assert.equal(clicks, 0);
    const done = call({
      ...request,
      confirmed: true,
      approvalToken: pending.confirmation.token,
    });
    assert.equal(done.status, "done");
    await until(() => clicks === 1);
    window.document
      .getElementById("go")
      .setAttribute("formaction", "https://unrelated.example/pay");
    assert.equal(
      observe().controls.some((control) => control.role === "button"),
      false,
    );
  } finally {
    await window.happyDOM.abort();
  }
});

test('switching to the example keeps unfinished library edits locally with clear nonblocking feedback', async () => {
  const pending = { ...exampleDraft, sourceRecordingId: 'private-edit', remoteSkillId: 'cloud', ownerId: 'owner', readOnly: false, dirty: true, markdown: '---\nname: "unfinished' };
  const f = await fixture({ draft: pending });
  try {
    f.element('try-example').click();
    await until(() => f.local.skillDraft?.sourceRecordingId === EXAMPLE_ID);
    assert.deepEqual(f.local.localSkills, [pending]);
    await until(() => f.element('kept-draft-notice').hidden === false);
    assert.match(f.element('kept-draft-notice').textContent, /kept on this device/);
    assert.match(f.element('kept-draft-notice').textContent, /run this skill now/);
    assert.equal(f.messages.some(m => m.type === 'account-login' || m.type === 'library-save'), false);
  } finally { await f.close(); }
});
