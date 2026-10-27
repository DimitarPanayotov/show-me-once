import assert from "node:assert/strict";
import { open, targets } from "./cdp.mjs";

const extension = (await targets()).find(
  (t) => t.type === "service_worker" && t.url.endsWith("/background.js"),
);
const extensionId = extension
  ? new URL(extension.url).hostname
  : process.env.SMO_EXTENSION_ID;
assert.ok(extensionId);
const popupUrl = `chrome-extension://${extensionId}/popup.html`;
const token = process.env.SMO_BRIDGE_TOKEN;
assert.ok(token, "Set the local bridge pairing code for this isolated test.");
let popup = await open(popupUrl);
await popup.until("document.documentElement.dataset.ready==='true'");
const waitRun = (condition) =>
  popup.until(
    `chrome.storage.local.get('runState').then(s=>{const r=s.runState;return r&&(${condition})?r:null})`,
    70000,
  );
await popup.evaluate(
  `document.querySelector('#agent-pair-code').value=${JSON.stringify(token)};document.querySelector('#agent-pair').click();true`,
);
await popup.until("!document.querySelector('#agent-disconnect').hidden");
const page = await open("http://127.0.0.1:4178/");
await popup.click("#tab-record");
await page.activate();
await popup.click("#start");
await popup.until("!document.querySelector('#record-active').hidden");
await page.evaluate(
  "document.querySelector('#search').click();document.querySelector('#search').value='Demonstration';document.querySelector('#search').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#password').value='DUMMY-SECRET';document.querySelector('#password').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#search-submit').click();true",
);
await page.until("location.pathname==='/results'");
await popup.click("#stop");
await popup.until(
  "document.querySelector('#skill-markdown').value.includes('search_1')",
);
await popup.click("#try-skill");
await popup.until("!document.querySelector('#run-start').disabled");
const before = await fetch("http://127.0.0.1:4319/health", {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());

async function start(request, shifted = true) {
  await page.navigate("http://127.0.0.1:4178/");
  if (shifted)
    await page.evaluate(
      "const label=document.createElement('label');label.textContent='Newsletter';const field=document.createElement('input');field.type='text';label.append(field);document.querySelector('form').prepend(label);true",
    );
  await popup.evaluate(
    `document.querySelector('#task-request').value=${JSON.stringify(request)};document.querySelector('[data-parameter=search_1]').value='';true`,
  );
  await page.activate();
  await popup.click("#run-start");
  const run = await waitRun("r.active && r.engine==='agent'");
  assert.equal(run.provider, "codex-local");
}

await start("Search for Foundation");
await waitRun("r.thinking");
await popup.close();
await page.until(
  "document.querySelector('#search').value==='Foundation'",
  70000,
);
popup = await open(popupUrl);
await popup.until("document.documentElement.dataset.ready==='true'");
await waitRun("r.pauseReason==='confirmation'");
assert.equal(await page.evaluate("location.pathname"), "/");
assert.equal(
  await page.evaluate(
    "document.querySelector('form > label:first-child input').value",
  ),
  "",
);
let persisted = await popup.evaluate(
  "chrome.storage.local.get(null).then(JSON.stringify)",
);
assert.ok(
  !persisted.includes("Foundation") &&
    !persisted.includes("DUMMY-SECRET") &&
    !persisted.includes("Demonstration"),
);
await popup.until("!document.querySelector('#run-confirm').disabled");
if (process.env.SMO_SCREENSHOTS) {
  await popup.activate();
  await popup.command("Page.bringToFront");
  await popup.screenshot(
    `${process.env.SMO_SCREENSHOTS}/extension-agent-confirmation.png`,
  );
}
await popup.click("#run-confirm");
await waitRun("!r.active && r.nextStep===r.totalSteps");
assert.equal(
  await page.evaluate("document.querySelector('#result-query').textContent"),
  "Foundation",
);

await start("Search for Frankenstein");
await waitRun("r.pauseReason==='confirmation'");
assert.equal(
  await page.evaluate("document.querySelector('#search').value"),
  "Frankenstein",
);
await popup.until("!document.querySelector('#run-confirm').disabled");
await popup.click("#run-confirm");
await waitRun("!r.active && r.nextStep===r.totalSteps");
assert.equal(
  await page.evaluate("document.querySelector('#result-query').textContent"),
  "Frankenstein",
);

await start("Search for Dune");
await waitRun("r.thinking");
const stoppedAt = Date.now();
await popup.click("#run-stop");
await waitRun("!r.active");
assert.ok(Date.now() - stoppedAt < 5000, "Stop waited for a model response.");
await new Promise((resolve) => setTimeout(resolve, 1200));
assert.equal(await page.evaluate("location.pathname"), "/");
assert.equal(
  await page.evaluate("document.querySelector('#search').value"),
  "",
);
persisted = await popup.evaluate(
  "chrome.storage.local.get(null).then(JSON.stringify)",
);
assert.ok(
  !persisted.includes("Foundation") &&
    !persisted.includes("Frankenstein") &&
    !persisted.includes("Search for Dune"),
);
// A challenge on the right origin/path depth must not count as a completed checkpoint.
await page.navigate("http://127.0.0.1:4178/verify_human");
const challengeMarkdown = [
  "---",
  "name: challenge-check",
  "description: Check a page safely",
  "---",
  "",
  "```json show-me-once",
  JSON.stringify({
    schemaVersion: 1,
    parameters: [],
    steps: [{ kind: "navigation", url: "http://127.0.0.1:4178/…" }],
  }),
  "```",
].join("\n");
await popup.evaluate(
  `chrome.storage.local.set({skillDraft:${JSON.stringify({ sourceRecordingId: "challenge-check", name: "challenge-check", description: "Check a page safely", markdown: challengeMarkdown })}})`,
);
await popup.until(
  "document.querySelector('#current-name').textContent==='challenge-check'",
);
await popup.evaluate(
  "document.querySelector('#task-request').value='Check this page';true",
);
await page.activate();
await popup.until("!document.querySelector('#run-start').disabled");
await popup.click("#run-start");
const challenge = await waitRun("r.active && r.pauseReason==='blocked'");
assert.equal(challenge.nextStep, 0);
assert.match(challenge.logs.at(-1).detail, /Human verification/);
await popup.click("#run-stop");
await waitRun("!r.active");
await page.navigate("http://127.0.0.1:4178/unavailable");
await page.evaluate(
  "document.title='Hmm...';document.body.textContent='Looks like you lost your connection. Please check it and try again.';true",
);
const connectionMarkdown = challengeMarkdown.replace(
  "challenge-check",
  "connection-check",
);
await popup.evaluate(
  `chrome.storage.local.set({skillDraft:${JSON.stringify({ sourceRecordingId: "connection-check", name: "connection-check", description: "Check an unavailable page safely", markdown: connectionMarkdown })}})`,
);
await popup.until(
  "document.querySelector('#current-name').textContent==='connection-check'",
);
await popup.until("!document.querySelector('#run-start').disabled");
await page.activate();
await popup.click("#run-start");
const unavailable = await waitRun("r.active && r.pauseReason==='blocked'");
assert.equal(unavailable.nextStep, 0);
assert.match(unavailable.logs.at(-1).detail, /page could not load/);
await popup.click("#run-stop");
await waitRun("!r.active");
const after = await fetch("http://127.0.0.1:4319/health", {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());
assert.ok(after.completedDecisions - before.completedDecisions >= 6);
console.log(
  JSON.stringify({
    realCodexDecisions: after.completedDecisions - before.completedDecisions,
    requestParameterExtraction: true,
    movedControlRecovery: true,
    twoInputs: true,
    popupClosedWhileThinking: true,
    confirmationEnforced: true,
    stopDuringModelRequest: true,
    humanVerificationNeverCountsAsSuccess: true,
    connectionErrorNeverCountsAsSuccess: true,
    noInputsOrSecretsInPersistentState: true,
  }),
);
await popup.close();
await page.close();
