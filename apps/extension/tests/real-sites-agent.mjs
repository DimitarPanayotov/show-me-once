import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { open, targets } from "./cdp.mjs";
const worker = (await targets()).find(
  (t) => t.type === "service_worker" && t.url.endsWith("/background.js"),
);
const extensionId = worker
  ? new URL(worker.url).hostname
  : process.env.SMO_EXTENSION_ID;
assert.ok(extensionId);
assert.ok(process.env.SMO_BRIDGE_TOKEN);
const popupUrl = `chrome-extension://${extensionId}/popup.html`;
let popup = await open(popupUrl);
const ready = () =>
  popup.until("document.documentElement.dataset.ready==='true'");
const waitRun = (condition) =>
  popup.until(
    `chrome.storage.local.get('runState').then(s=>{const r=s.runState;return r&&(${condition})?r:null})`,
    90000,
  );
await ready();
if (await popup.evaluate("!document.querySelector('#record-active').hidden")) {
  await popup.click("#stop");
  await popup.until("document.querySelector('#record-active').hidden");
}
if (
  await popup.evaluate(
    "chrome.storage.local.get('runState').then(s=>!!s.runState?.active)",
  )
) {
  await popup.click("#run-stop");
  await waitRun("!r.active");
}
await popup.evaluate(
  `document.querySelector('#agent-pair-code').value=${JSON.stringify(process.env.SMO_BRIDGE_TOKEN)};document.querySelector('#agent-pair').click();true`,
);
await popup.until("!document.querySelector('#agent-disconnect').hidden");
const health = () =>
  fetch("http://127.0.0.1:4319/health", {
    headers: { Authorization: `Bearer ${process.env.SMO_BRIDGE_TOKEN}` },
  }).then((r) => r.json());
const before = await health();
const results = [];
const sites = [
  {
    name: "wikipedia-search",
    url: "https://www.wikipedia.org/",
    selector: "#searchInput",
    demo: "Ada Lovelace",
    values: ["Grace Hopper", "Alan Turing"],
    description: "Search Wikipedia for a supplied topic.",
    request: (v) => `Search Wikipedia for "${v}"`,
    query: null,
    enter: false,
  },
  {
    name: "github-repository-search",
    url: "https://github.com/orgs/github/repositories",
    selector: "#repos-list-filter-input",
    demo: "copilot",
    values: ["actions", "docs"],
    description: "Search the GitHub organization repository list.",
    request: (v) => `Search repositories for "${v}"`,
    query: "q",
    enter: true,
  },
  {
    name: "open-library-title-search",
    url: "https://openlibrary.org/advancedsearch",
    selector: "input[name=title]",
    demo: "Dune",
    values: ["Foundation", "Frankenstein"],
    description: "Search Open Library by book title.",
    request: (v) => `Search book titles for "${v}"`,
    query: "title",
    enter: false,
  },
  {
    name: "python-docs-search",
    url: "https://docs.python.org/3/search.html",
    selector: 'input[name="q"]',
    demo: "json",
    values: ["asyncio", "pathlib"],
    description: "Search Python documentation for a supplied topic.",
    request: (v) => `Search Python documentation for "${v}"`,
    query: "q",
    enter: false,
    resultsSelector: "ul.search > li",
  },
].filter(
  (site) =>
    !process.env.SMO_SITE_FILTER || site.name === process.env.SMO_SITE_FILTER,
);
assert.ok(sites.length, "The site filter must match a configured demonstration.");
for (const site of sites) {
  const page = await open(site.url);
  await page.until(
    `document.querySelector(${JSON.stringify(site.selector)})!==null`,
  );
  if (site.name === "wikipedia-search")
    await page.evaluate(
      "document.querySelector('#searchLanguage').value='en';true",
    );
  await popup.click("#tab-record");
  await page.activate();
  await popup.click("#start");
  await popup.until("!document.querySelector('#record-active').hidden");
  await page.evaluate(
    `document.querySelector(${JSON.stringify(site.selector)}).click();document.querySelector(${JSON.stringify(site.selector)}).focus();true`,
  );
  await page.command("Input.insertText", { text: site.demo });
  if (site.enter) {
    await page.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    await page.command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
  } else
    await page.evaluate(
      `document.querySelector(${JSON.stringify(site.selector)}).form.querySelector('button[type=submit],button,input[type=submit]').click();true`,
    );
  const demoCondition = site.query
    ? `new URL(location.href).searchParams.get(${JSON.stringify(site.query)})===${JSON.stringify(site.demo)}`
    : "location.hostname==='en.wikipedia.org'";
  await page.until(
    `${demoCondition} && document.readyState==='complete'`,
    60000,
  );
  await popup.click("#stop");
  await popup.until(
    "document.querySelector('#run-parameters input')!==null && !document.querySelector('#skill-section').hidden",
  );
  await popup.evaluate(
    `document.querySelector('#skill-name').value=${JSON.stringify(site.name)};document.querySelector('#skill-description').value=${JSON.stringify(site.description)};document.querySelector('#generate').click();true`,
  );
  await popup.until(
    `document.querySelector('#skill-markdown').value.includes('name: ${site.name}')`,
  );
  const markdown = await popup.evaluate(
    "document.querySelector('#skill-markdown').value",
  );
  if (process.env.SMO_SKILL_OUTPUT) {
    await mkdir(`${process.env.SMO_SKILL_OUTPUT}/${site.name}`, {
      recursive: true,
    });
    await writeFile(
      `${process.env.SMO_SKILL_OUTPUT}/${site.name}/SKILL.md`,
      markdown,
    );
  }
  await popup.click("#try-skill");
  await popup.evaluate(
    "document.querySelector('#run-engine').value='agent';document.querySelector('#run-engine').dispatchEvent(new Event('change'));document.querySelector('#agent-provider').value='codex-local';document.querySelector('#agent-provider').dispatchEvent(new Event('change'));true",
  );
  for (const value of site.values) {
    await page.navigate(site.url);
    await page.until(
      `document.querySelector(${JSON.stringify(site.selector)})!==null`,
    );
    if (site.name === "wikipedia-search")
      await page.evaluate(
        "document.querySelector('#searchLanguage').value='en';true",
      );
    await popup.evaluate(
      `document.querySelector('#task-request').value=${JSON.stringify(site.request(value))};for(const input of document.querySelectorAll('#run-parameters input'))input.value='';true`,
    );
    await popup.until("!document.querySelector('#run-start').disabled");
    await page.activate();
    await popup.click("#run-start");
    await waitRun(
      "r.active && r.engine==='agent' && r.provider==='codex-local'",
    );
    const pending = await waitRun(
      "r.pauseReason==='confirmation'||r.pauseReason==='blocked'||!r.active",
    );
    if (pending.pauseReason === "blocked") {
      const reason = await popup.evaluate(
        "document.querySelector('#run-context').textContent",
      );
      throw new Error(`${site.name}: ${reason}`);
    }
    assert.equal(
      await page.evaluate(
        `document.querySelector(${JSON.stringify(site.selector)})?.value`,
      ),
      value,
    );
    if (pending.active) {
      await popup.until("!document.querySelector('#run-confirm').disabled");
      await popup.click("#run-confirm");
      await waitRun(`r.nextStep>${pending.nextStep}`);
      await popup.close();
    }
    const resultCondition = site.query
      ? `new URL(location.href).searchParams.get(${JSON.stringify(site.query)})===${JSON.stringify(value)} && !location.pathname.includes('verify_human')`
      : `location.hostname==='en.wikipedia.org' && location.pathname===${JSON.stringify(`/wiki/${value.replaceAll(" ", "_")}`)}`;
    await page.until(
      `${resultCondition} && document.readyState==='complete'`,
      60000,
    );
    if (site.resultsSelector) {
      await page.until(
        `document.querySelectorAll(${JSON.stringify(site.resultsSelector)}).length>0`,
        60000,
      );
    }
    if (pending.active) {
      popup = await open(popupUrl);
      await ready();
    }
    await waitRun("!r.active&&r.nextStep===r.totalSteps");
    const currentMarkdown = await popup.evaluate(
      "document.querySelector('#skill-markdown').value",
    );
    assert.equal(currentMarkdown, markdown);
    const saved = await popup.evaluate(
      "chrome.storage.local.get('runState').then(s=>s.runState)",
    );
    assert.equal(saved.engine, "agent");
    assert.ok(saved.logs.some((log) => log.detail.includes("agent")));
    results.push({
      site: site.name,
      input: value,
      url: await page.evaluate("location.href"),
      agent: "codex-local",
      completed: true,
    });
    console.log(JSON.stringify({ completed: site.name, input: value }));
  }
  if (process.env.SMO_SCREENSHOTS) {
    await popup.activate();
    await popup.command("Page.bringToFront");
    await popup.screenshot(
      `${process.env.SMO_SCREENSHOTS}/agent-${site.name}-completed.png`,
    );
  }
  await page.close();
}
const after = await health();
assert.ok(
  after.completedDecisions - before.completedDecisions >= results.length * 3,
);
console.log(
  JSON.stringify({
    realModelDecisions: after.completedDecisions - before.completedDecisions,
    realAgentRuns: results,
  }),
);
if (process.env.SMO_SKILL_OUTPUT)
  await writeFile(
    `${process.env.SMO_SKILL_OUTPUT}/${process.env.SMO_SITE_FILTER ? `results-${process.env.SMO_SITE_FILTER}` : 'results'}.json`,
    JSON.stringify(
      {
        realModelDecisions:
          after.completedDecisions - before.completedDecisions,
        realAgentRuns: results,
      },
      null,
      2,
    ),
  );
await popup.close();
