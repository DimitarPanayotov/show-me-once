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
import { parseSkillPlan } from "@show-me-once/shared";

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
async function fixture({ connected = true, draft, run, confirmation } = {}) {
  const window = new Window({ url: "https://extension.example/popup.html" });
  window.document.write(html.replace(/<script[\s\S]*?<\/script>/, ""));
  const local = {
    ...(draft ? { skillDraft: draft } : {}),
    ...(run
      ? { runState: run, runPlan: parseSkillPlan(exampleDraft.markdown) }
      : {}),
  };
  const session = {
    ...(confirmation ? { runConfirmation: confirmation } : {}),
  };
  const listeners = [],
    messages = [],
    tabs = [];
  let clipboard = "",
    user = null;
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
          return { paired: connected, connected };
        if (message.type === "mcp-skills") return catalog.list();
        if (message.type === "account-status") return user;
        if (message.type === "get-run") return local.runState ?? null;
        if (message.type === "mcp-open-skill") {
          const value = await catalog.load(message.skillId);
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

test("reviewer onboarding has one agent path, a working example handoff, and no provider or replay setup", async () => {
  const f = await fixture();
  try {
    for (const id of [
      "agent-provider",
      "run-engine",
      "run-mode",
      "run-start",
      "run-next",
      "agent-pair",
    ])
      assert.equal(f.element(id), null);
    assert.match(f.element("mcp-status").textContent, /Connected/);
    f.element("try-example").click();
    await until(() => f.tabs.length === 1);
    assert.equal(f.tabs[0].url, "https://github.com/search/advanced");
    assert.match(f.clipboard(), /microsoft\/vscode.*terminal/);
    assert.equal(f.local.skillDraft.sourceRecordingId, EXAMPLE_ID);
    assert.equal(f.element("current-meta").textContent, "Example skill");
    assert.equal(f.element("error").textContent, "");
    assert.equal(
      f.messages.some((m) => /^(agent-|start-run)/.test(m.type)),
      false,
    );
  } finally {
    await f.close();
  }
});

test("first launch explains connection inline without opening or requiring an external guide", async () => {
  const f = await fixture({ connected: false });
  try {
    assert.equal(f.element("mcp-settings").open, true);
    assert.equal(f.element("mcp-pair-form").hidden, false);
    assert.equal(
      f.element("mcp-pair-form").querySelectorAll("ol li").length,
      3,
    );
    assert.equal(f.element("mcp-guide"), null);
    assert.equal(f.element("try-example").disabled, true);
    assert.equal(f.element("start").disabled, false);
    assert.equal(f.tabs.length, 0);
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
    assert.equal(f.element("open-start-page").hidden, true);
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
