import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from 'node:fs/promises';
import { rolldown } from "rolldown";
import { Window } from "happy-dom";
import { exampleDraft, EXAMPLE_START_URL } from "../lib/skill-catalog.ts";
import { ExternalRunController } from "../lib/external-run.ts";
import { applyStepOutcome } from "../lib/run-state.ts";
import {
  appendAction,
  sanitizedAction,
  parseSkillPlan,
  sanitizeUrl,
  createSkillMarkdown,
} from "@show-me-once/shared";
import { checkedDecision } from '@show-me-once/shared/agent';
import { checkedInput } from '../../../packages/agent/src/providers.ts';

// Real content/execution code against controlled documents, without Chrome or a model.
const bundle = await rolldown({
  input: new URL("../entrypoints/content.ts", import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    "$1",
  ),
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
  name: "triageContent",
});
await bundle.close();
const code = compiled.output.find((item) => item.type === "chunk").code;
const plan = parseSkillPlan(exampleDraft.markdown);

test('the unchanged sixteen-step recording clears an unrequested search filter and opens a scoped issue for two inputs', async () => {
  const recorded = JSON.parse(await readFile(new URL('./fixtures/github-advanced-recording.json', import.meta.url), 'utf8'));
  const markdown = createSkillMarkdown({ id: 'recorded', active: false, tabId: 1, startedAt: '',
    actions: recorded.steps.map((step, index) => ({ ...step, id: String(index), at: '' })) }, 'github-task-v1', 'Repeat this task on github.com with new inputs.');
  assert.deepEqual(parseSkillPlan(markdown), recorded);
  for (const values of [
    { topic: 'inference', repository: 'microsoft/TypeScript', state: 'open', label: 'bug' },
    { topic: 'terminal', repository: 'microsoft/vscode', state: 'open', label: 'bug' },
  ]) {
    const windows = [];
    let current, handler, submitted, opened, wrongClicks = 0, confirmations = 0;
    const parameters = {};
    const request = `Find ${values.state} issues in ${values.repository} about ${values.topic} with label ${values.label}. Open the first matching issue.`;
    function page(kind) {
      current = new Window({ url: kind === 'advanced' ? 'https://github.com/search/advanced' : kind === 'results'
        ? 'https://github.com/search?q=fixture' : `https://github.com/${values.repository}/issues/42` });
      windows.push(current);
      current.document.write(kind === 'advanced' ? '<main><form method="get" action="/search">' +
        '<label for="topic">Search terms</label><input id="topic" name="q">' +
        '<label for="owner">From these owners</label><input id="owner" value="previous-owner">' +
        '<label for="repo">In these repositories</label><input id="repo">' +
        '<label for="state">In the state</label><select id="state"><option value="">Any</option><option value="open">Open</option><option value="closed">Closed</option></select>' +
        '<label for="label">With the labels</label><input id="label"><button type="submit">Search</button></form></main>' : kind === 'results'
        ? `<main><h3><a id="wrong" href="/another/project/issues/1">Other issue</a></h3><h3><a id="matching" href="/${values.repository}/issues/42">Matching issue</a></h3></main>`
        : '<main><h1>Issue details</h1></main>');
      current.HTMLElement.prototype.getClientRects = function () { return this.closest('[hidden]') ? [] : [{ width: 100, height: 30 }]; };
      current.HTMLElement.prototype.scrollIntoView = () => {};
      current.__smoBrowser = { storage: { onChanged: { addListener() {} } }, runtime: {
        onMessage: { addListener(fn) { handler = fn; } }, sendMessage: async () => ({ active: false }),
      } };
      current.defineContentScript = config => { const owner = current; config.main({ isValid: true,
        setTimeout: (...args) => owner.setTimeout(...args), setInterval: () => 0,
        addEventListener: (target, ...args) => target.addEventListener(...args),
      }); return config; };
      current.eval(code);
      if (kind === 'advanced') current.document.querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        submitted = Object.fromEntries(['topic', 'owner', 'repo', 'state', 'label'].map(id => [id, current.document.getElementById(id).value]));
        assert.equal(submitted.owner, '');
        page('results');
      });
      if (kind === 'results') {
        current.document.getElementById('wrong').addEventListener('click', event => { event.preventDefault(); wrongClicks++; });
        current.document.getElementById('matching').addEventListener('click', event => { event.preventDefault(); opened = values.repository; page('issue'); });
      }
    }
    const call = message => { let result; handler(message, {}, value => { result = value; }); return result; };
    page('advanced');
    try {
      const ownerStep = recorded.steps[4], ownerScope = [ownerStep.url];
      const before = call({ type: 'observe-agent-page', step: ownerStep, navigationScope: ownerScope });
      const owner = before.controls.find(control => control.label === 'From these owners');
      assert.equal(owner.clearable, true);
      assert.equal(JSON.stringify(before).includes('previous-owner'), false);
      current.document.getElementById('owner').required = true;
      assert.equal(call({ type: 'execute-agent-action', step: ownerStep, navigationScope: ownerScope,
        observationId: before.id, targetId: owner.id, value: '', executionKey: 'required-check' }).status, 'blocked');
      assert.equal(current.document.getElementById('owner').value, 'previous-owner');
      current.document.getElementById('owner').required = false;
      const names = { 1: 'Search terms', 2: 'Search terms', 3: 'From these owners', 4: 'From these owners',
        5: 'In these repositories', 6: 'In these repositories', 7: 'In the state', 8: 'In the state',
        9: 'In the state', 10: 'With the labels', 11: 'With the labels', 12: 'Search' };
      const replacements = { text_1: values.topic, text_2: '', text_3: values.repository, select_4: values.state, text_5: values.label };
      for (let index = 0; index < recorded.steps.length; index++) {
        const step = recorded.steps[index];
        if (step.kind === 'navigation') { assert.equal(sanitizeUrl(current.location.href), step.url); continue; }
        const navigationScope = [step.url, ...(recorded.steps[index + 1]?.kind === 'navigation' ? [recorded.steps[index + 1].url] : [])];
        const observation = call({ type: 'observe-agent-page', step, navigationScope, parameters });
        const input = checkedInput({ markdown, plan: recorded, stepIndex: index, observation, request, supplied: Object.keys(parameters) });
        const target = index === 14 ? observation.controls.find(control => control.headingLevel === 3 && control.matchesParameters?.includes('text_3'))
          : observation.controls.find(control => control.label === names[index]);
        assert(target, `No intended control at step ${index + 1}`);
        if (index === 14) {
          assert.equal(observation.controls[0].id, target.id);
          assert.equal(JSON.stringify(observation).includes(values.repository), false);
        }
        const decision = checkedDecision({ action: step.kind === 'input' ? 'fill' : 'click', targetId: target.id,
          parameter: step.kind === 'input' ? step.parameter : null, value: step.kind === 'input' ? replacements[step.parameter] : null }, input);
        if (decision.parameter && decision.value !== null) parameters[decision.parameter] = decision.value;
        const action = { type: 'execute-agent-action', step, observationId: observation.id, targetId: target.id, navigationScope,
          ...(step.kind === 'input' ? { value: parameters[step.parameter] } : {}), executionKey: `recorded-run:${index}` };
        let outcome = call(action);
        if (outcome.status === 'confirmation-required') {
          assert.equal(submitted, undefined);
          confirmations++;
          outcome = call({ ...action, confirmed: true, approvalToken: outcome.confirmation.token });
        }
        assert.equal(outcome.status, 'done', `Step ${index + 1} failed`);
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.deepEqual(submitted, { topic: values.topic, owner: '', repo: values.repository, state: values.state, label: values.label });
      assert.equal(confirmations, 1);
      assert.equal(wrongClicks, 0);
      assert.equal(opened, values.repository);
    } finally { for (const window of windows) await window.happyDOM.abort(); }
  }
});

test("SPA navigation preserves a new observation and rejects an observation from the previous query", async () => {
  const window = new Window({ url: "https://github.com/search?q=before" });
  let handler,
    poll,
    clicks = 0;
  window.document.write('<button type="button">Sort by</button>');
  window.HTMLElement.prototype.getClientRects = () => [
    { width: 100, height: 30 },
  ];
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.document.querySelector("button").click = () => {
    clicks++;
  };
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
      setInterval: (fn) => {
        poll = fn;
        return 0;
      },
      addEventListener: (target, ...args) => target.addEventListener(...args),
    });
    return config;
  };
  try {
    window.eval(code);
    const call = (message) => {
      let result;
      handler(message, {}, (value) => {
        result = value;
      });
      return result;
    };
    const step = {
        kind: "click",
        url: "https://github.com/…",
        selector: "button:nth-of-type(1)",
      },
      navigationScope = [step.url];
    call({ type: "observe-agent-page", step, navigationScope });
    window.happyDOM.setURL("https://github.com/search?q=after");
    const observed = call({
      type: "observe-agent-page",
      step,
      navigationScope,
    });
    poll();
    const request = {
      type: "execute-agent-action",
      step,
      navigationScope,
      observationId: observed.id,
      targetId: observed.controls[0].id,
      executionKey: "run:sort",
    };
    assert.equal(call(request).status, "done");
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(clicks, 1);
    const stale = call({ type: "observe-agent-page", step, navigationScope });
    window.happyDOM.setURL("https://github.com/search?q=different");
    assert.equal(
      call({
        ...request,
        observationId: stale.id,
        targetId: stale.controls[0].id,
      }).status,
      "blocked",
    );
    assert.equal(clicks, 1);
  } finally {
    await window.happyDOM.abort();
  }
});

test("the recorder captures accessible menu-item clicks without capturing their labels or values", async () => {
  const window = new Window({
    url: "https://github.com/search?q=private-value",
  });
  const captured = [];
  window.document.write(
    '<ul><li role="menuitemradio" tabindex="-1"><span>Recently updated</span></li></ul>',
  );
  window.__smoBrowser = {
    storage: { onChanged: { addListener() {} } },
    runtime: {
      onMessage: { addListener() {} },
      sendMessage: async (message) => {
        if (message.type === "record-action") captured.push(message.action);
        return { active: true };
      },
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
    window.eval(code);
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.document.querySelector("li span").click();
    assert.equal(captured.length, 1);
    assert.equal(captured[0].kind, "click");
    assert.match(captured[0].selector, /li:nth-of-type\(1\)$/);
    assert.equal("value" in captured[0], false);
    assert.equal("label" in captured[0], false);
    // Content reports the URL to the trusted worker; the worker's existing sanitizer drops query values.
    assert.equal(sanitizeUrl(captured[0].url), "https://github.com/…");
  } finally {
    await window.happyDOM.abort();
  }
});

test("one menu gesture remains one recorded click when GitHub reparents the menu before click", async () => {
  const window = new Window({
    url: "https://github.com/search?q=not-recorded",
  });
  const reports = [];
  window.document.write(
    '<main><div><div><ul><li role="menuitemradio"><span>Recently updated</span></li></ul></div></div></main>',
  );
  window.__smoBrowser = {
    storage: { onChanged: { addListener() {} } },
    runtime: {
      onMessage: { addListener() {} },
      sendMessage: async (message) => {
        if (message.type === "record-action") reports.push(message);
        return { active: true };
      },
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
    window.eval(code);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const target = window.document.querySelector("li span");
    const menu = window.document.querySelector("ul");
    target.addEventListener("pointerdown", () =>
      window.document.body.append(menu),
    );
    target.dispatchEvent(
      new window.PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    target.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, button: 0, detail: 1 }),
    );
    assert.equal(
      reports.length,
      2,
      "Both early and fallback reports are still sent.",
    );
    assert.equal(
      reports[0].eventId,
      reports[1].eventId,
      "One physical gesture must have one event identity despite DOM movement.",
    );
    assert.equal(
      reports[0].action.selector,
      reports[1].action.selector,
      "Keep the selector captured before the site moved its menu.",
    );
    target.dispatchEvent(
      new window.PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    target.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, button: 0, detail: 1 }),
    );
    assert.equal(reports[2].eventId, reports[3].eventId);
    assert.notEqual(
      reports[0].eventId,
      reports[2].eventId,
      "A second deliberate click must not be lost.",
    );
    target.click();
    assert.notEqual(
      reports[3].eventId,
      reports[4].eventId,
      "A click without pointerdown still records independently.",
    );
    assert.equal(
      JSON.stringify(reports.map((r) => r.action)).includes("Recently updated"),
      false,
    );
    assert.equal(
      reports.some((r) => "target" in r.action),
      false,
    );
    let recording = {
      id: "gesture-test",
      active: false,
      tabId: 1,
      startedAt: "2026-10-28T00:00:00Z",
      actions: [],
    };
    for (const report of reports)
      recording = appendAction(
        recording,
        sanitizedAction(report.action),
        report.eventId,
        "2026-10-28T00:00:00Z",
      );
    assert.equal(recording.actions.length, 3);
    assert.equal(JSON.stringify(recording).includes("not-recorded"), false);
  } finally {
    await window.happyDOM.abort();
  }
});

test("the twelve-step triage workflow fills four inputs, confirms, sorts a live menu and opens an issue with two input sets", async () => {
  const cases = [
    {
      repository: "microsoft/vscode",
      topic: "terminal",
      state: "open",
      label: "bug",
    },
    {
      repository: "microsoft/TypeScript",
      topic: "inference",
      state: "open",
      label: "bug",
    },
  ];
  assert.equal(plan.steps.length, 12);
  assert.equal(plan.parameters.length, 4);
  for (const values of cases) {
    const windows = [];
    let current, handler, run, session, parameters, pending;
    let submitted,
      sorted = false,
      approvals = 0,
      sawMenuItem = false;
    function page(kind, url) {
      current = new Window({ url });
      windows.push(current);
      const doc = current.document;
      const advanced =
        '<main><form action="/search"><h2 id="terms">Search terms</h2><input id="topic" type="text" aria-labelledby="terms"><label for="repository">In these repositories</label><input id="repository" type="text"><label for="state">In the state</label><select id="state"><option value="">Any</option><option value="open">open</option><option value="closed">closed</option></select><label for="label">With the labels</label><input id="label" type="text"><button type="submit">Search</button></form></main>';
      const results =
        '<main><button type="button" id="sort">Sort by: Best match</button><ul id="menu" hidden><li role="menuitemradio" tabindex="-1" id="recent">Recently updated</li></ul><section><h3><a id="issue" href="/' +
        values.repository +
        '/issues/42">Matching public issue</a></h3></section><a href="/features">GitHub features</a></main>';
      doc.write(
        kind === "advanced"
          ? advanced
          : kind === "results"
            ? results
            : "<main><h1>Issue details</h1></main>",
      );
      current.HTMLElement.prototype.getClientRects = function () {
        return this.closest("[hidden]") ? [] : [{ width: 100, height: 30 }];
      };
      current.HTMLElement.prototype.scrollIntoView = () => {};
      current.__smoBrowser = {
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
      current.defineContentScript = (config) => {
        const owner = current;
        config.main({
          isValid: true,
          setTimeout: (...args) => owner.setTimeout(...args),
          setInterval: () => 0,
          addEventListener: (target, ...args) =>
            target.addEventListener(...args),
        });
        return config;
      };
      current.eval(code);
      if (kind === "advanced")
        doc.querySelector("form").addEventListener("submit", (event) => {
          event.preventDefault();
          submitted = Object.fromEntries(
            Object.keys(values).map((key) => [
              key,
              doc.getElementById(key).value,
            ]),
          );
          page("results", "https://github.com/search?q=fixture&type=issues");
        });
      if (kind === "results") {
        doc.getElementById("sort").addEventListener("click", () => {
          doc.getElementById("menu").hidden = false;
        });
        doc.getElementById("recent").addEventListener("click", () => {
          sorted = true;
          page(
            "results",
            "https://github.com/search?q=fixture&type=issues&s=updated&o=desc",
          );
        });
        doc.getElementById("issue").addEventListener("click", (event) => {
          event.preventDefault();
          assert.equal(sorted, true);
          page(
            "issue",
            "https://github.com/" + values.repository + "/issues/42",
          );
        });
      }
    }
    const call = (message) => {
      let result;
      handler(message, {}, (value) => {
        result = value;
      });
      return result;
    };
    const scope = (stepIndex) => [
      ...new Set(
        [
          plan.steps[stepIndex].url,
          plan.steps
            .slice(stepIndex + 1)
            .find((step) => step.kind === "navigation")?.url,
        ].filter(Boolean),
      ),
    ];
    async function perform(confirmed = false) {
      const step = plan.steps[run.nextStep],
        previousUrl = current.location.href;
      const outcome =
        step.kind === "navigation"
          ? {
              status:
                sanitizeUrl(current.location.href) === step.url
                  ? "done"
                  : "blocked",
            }
          : call({
              type: "execute-agent-action",
              observationId: session.selected.observationId,
              targetId: session.selected.targetId,
              step,
              navigationScope: scope(run.nextStep),
              value:
                step.kind === "input" ? parameters[step.parameter] : undefined,
              executionKey: run.id + ":" + run.nextStep,
              confirmed,
              ...(confirmed ? { approvalToken: pending.token } : {}),
            });
      if (outcome.confirmation) pending = outcome.confirmation;
      run = applyStepOutcome(run, plan, outcome.status, "Guarded step result.");
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (run.awaitingNavigation && current.location.href !== previousUrl)
        run = { ...run, navigationObserved: true };
      return run;
    }
    const controller = new ExternalRunController({
      readRun: async () => run ?? null,
      readSession: async () => session,
      saveSession: async (value) => {
        session = value;
      },
      start: async (_markdown, supplied) => {
        parameters = supplied;
        page("advanced", EXAMPLE_START_URL);
        return (run = {
          id: randomUUID(),
          tabId: 1,
          active: true,
          engine: "external",
          mode: "automatic",
          nextStep: 0,
          totalSteps: plan.steps.length,
          logs: [],
        });
      },
      observe: async (_run, step) =>
        step.kind === "navigation"
          ? {
              id: randomUUID(),
              url: sanitizeUrl(current.location.href),
              controls: [],
            }
          : call({
              type: "observe-agent-page",
              step,
              navigationScope: scope(run.nextStep),
            }),
      perform,
      stop: async () => (run = { ...run, active: false }),
    });
    const identity = {
      controllerId: randomUUID(),
      bridgeId: randomUUID(),
      connectionId: randomUUID(),
    };
    try {
      const started = await controller.handle(identity, {
        kind: "start",
        markdown: exampleDraft.markdown,
        parameters: values,
      });
      for (let count = 0; run.active && count < 20; count++) {
        const observed = await controller.handle(identity, {
          kind: "observe",
          runId: started.runId,
        });
        assert.ok(
          observed.observation,
          "Each step requires a fresh observation.",
        );
        const step = plan.steps[run.nextStep];
        let target;
        if (step.kind === "input") {
          const label = {
            topic: "Search terms",
            repository: "In these repositories",
            state: "In the state",
            label: "With the labels",
          }[step.parameter];
          target = observed.observation.controls.find(
            (control) => control.label === label,
          );
        } else if (step.kind === "click") {
          const label =
            run.nextStep === 5
              ? "Search"
              : run.nextStep === 7
                ? "Sort by: Best match"
                : run.nextStep === 8
                  ? "Recently updated"
                  : "Matching public issue";
          target = observed.observation.controls.find(
            (control) => control.label === label,
          );
          if (run.nextStep === 8) {
            assert.equal(target?.role, "button");
            sawMenuItem = true;
          }
          if (run.nextStep === 10)
            assert.equal(target?.destination, "https://github.com/…/…/…/…");
        }
        if (step.kind !== "navigation")
          assert.ok(
            target,
            "The intended live control must be discoverable: " + run.nextStep,
          );
        assert.equal(
          observed.observation.controls.some((control) => "value" in control),
          false,
        );
        const result = await controller.handle(identity, {
          kind: "act",
          runId: started.runId,
          stepIndex: run.nextStep,
          observationId: observed.observation.id,
          action:
            step.kind === "navigation"
              ? "checkpoint"
              : step.kind === "input"
                ? "fill"
                : "click",
          ...(target ? { targetId: target.id } : {}),
        });
        if (result.status === "needs_approval") {
          assert.equal(run.nextStep, 5);
          assert.equal(submitted, undefined);
          approvals++;
          await perform(true); // Simulated human approval, outside the controller/tool interface.
        } else assert.notEqual(result.status, "blocked");
      }
      assert.equal(run.nextStep, 12);
      assert.equal(run.active, false);
      assert.deepEqual(submitted, values);
      assert.equal(sawMenuItem, true);
      assert.equal(approvals, 1);
      assert.equal(
        current.location.href,
        "https://github.com/" + values.repository + "/issues/42",
      );
      for (const value of Object.values(values))
        if (value !== "open" && value !== "bug")
          assert.equal(JSON.stringify(run.logs).includes(value), false);
    } finally {
      await Promise.all(windows.map((window) => window.happyDOM.abort()));
    }
  }
});
