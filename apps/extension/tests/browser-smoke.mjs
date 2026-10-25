import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connect, open, targets } from "./cdp.mjs";

const appBase = (process.env.SMO_API_BASE || "http://localhost:3000").replace(
  /\/$/,
  "",
);
const fixtureBase = "http://127.0.0.1:4178/";
const outputBase = process.env.SMO_SCREENSHOTS;
const extensionTarget = (await targets()).find(
  (t) => t.type === "service_worker" && t.url.endsWith("/background.js"),
);
const extensionId = extensionTarget
  ? new URL(extensionTarget.url).hostname
  : process.env.SMO_EXTENSION_ID;
if (!extensionId)
  throw new Error(
    "Load the extension first or set SMO_EXTENSION_ID for a suspended worker.",
  );
const popupUrl = `chrome-extension://${extensionId}/popup.html`;
const email = `flow-smoke-${randomUUID().slice(0, 8)}@example.test`;
const password = `Demo-${randomUUID()}!`;
const app = await open(`${appBase}/`);
await app.until("document.readyState==='complete'");
const registration = await app.evaluate(
  `fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({ mode: "register", email, password, name: "Demo Tester" })})}).then(r=>r.status)`,
);
assert.equal(registration, 200);
let popup = await open(popupUrl);
const ready = () =>
  popup.until("document.documentElement.dataset.ready==='true'");
const run = () =>
  popup.evaluate("chrome.storage.local.get('runState').then(s=>s.runState)");
const waitRun = (condition, timeout = 25000) =>
  popup.until(
    `chrome.storage.local.get('runState').then(s=>{const r=s.runState;return r&&(${condition})?r:null})`,
    timeout,
  );
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await ready();
assert.equal(
  await popup.evaluate(
    "document.querySelector('#tab-run').getAttribute('aria-selected')",
  ),
  "true",
);
assert.equal(
  await popup.evaluate("document.querySelector('#record-timeline').hidden"),
  true,
);
if (outputBase) await popup.screenshot(`${outputBase}/extension-home.png`);
await popup.click("#account-toggle");
await popup.evaluate(
  `document.querySelector('#account-email').value=${JSON.stringify(email)};document.querySelector('#account-password').value=${JSON.stringify(password)};document.querySelector('#account-form').requestSubmit();true`,
);
await popup.until(
  "document.querySelector('#account-status').textContent.startsWith('Signed in as') && document.querySelector('#account-section').hidden",
);
const page = await open(fixtureBase);
await page.until("document.readyState==='complete'");
await popup.click("#tab-record");
await page.activate();
await popup.click("#start");
await popup.until("!document.querySelector('#record-active').hidden");
await page.evaluate(
  "document.querySelector('#search').click();document.querySelector('#search').value='First demonstration';document.querySelector('#search').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#password').click();document.querySelector('#password').value='DUMMY-PRIVATE-VALUE';document.querySelector('#password').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#search-submit').click();true",
);
await page.until(
  "location.pathname==='/results' && document.readyState==='complete'",
);
await popup.click("#stop");
await popup.until(
  "document.querySelector('#skill-markdown').value.includes('search_1') && !document.querySelector('#skill-section').hidden",
);
const draft = await popup.evaluate(
  "chrome.storage.local.get('skillDraft').then(s=>s.skillDraft)",
);
assert.ok(!draft.markdown.includes("First demonstration"));
assert.ok(!draft.markdown.includes("DUMMY-PRIVATE-VALUE"));
assert.equal(
  await popup.evaluate("document.querySelector('#record-timeline').open"),
  false,
);
assert.equal(
  await popup.evaluate("document.querySelector('#draft-section').open"),
  false,
);
await popup.command("Emulation.setDeviceMetricsOverride", {
  width: 420,
  height: 600,
  deviceScaleFactor: 1,
  mobile: false,
});
await popup.evaluate(
  "document.querySelector('#save-library').scrollIntoView({block:'center'});true",
);
assert.equal(
  await popup.evaluate(
    "document.querySelector('#save-library').click();document.querySelector('#save-library').dataset.busy",
  ),
  "true",
);
await popup.until(
  "document.querySelector('#notice').textContent.includes('Saved to your library') && document.querySelector('#save-library').dataset.saved==='true'",
);
assert.equal(
  await popup.evaluate(
    "(()=>{const r=document.querySelector('#notice').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()",
  ),
  true,
);
if (outputBase) await popup.screenshot(`${outputBase}/extension-saved.png`);
await popup.click("#save-run");
await popup.until(
  "!document.querySelector('#view-run').hidden && !document.querySelector('#run-panel').hidden",
);
assert.equal(
  await popup.evaluate("document.querySelector('#run-mode').value"),
  "automatic",
);
const savedDraft = await popup.evaluate(
  "chrome.storage.local.get('skillDraft').then(s=>s.skillDraft)",
);

async function startSearch(value) {
  await page.navigate(fixtureBase);
  await popup.evaluate(
    `document.querySelector('[data-parameter="search_1"]').value=${JSON.stringify(value)};true`,
  );
  await page.activate();
  await popup.click("#run-start");
  await waitRun("r.active && r.pauseReason==='confirmation'");
  assert.equal(await page.evaluate("location.pathname"), "/");
  assert.equal(
    await page.evaluate("document.querySelector('#search').value"),
    value,
  );
  assert.equal(await popup.evaluate("chrome.action.getBadgeText({})"), "!");
}

await startSearch("Alpha");
if (outputBase)
  await popup.screenshot(`${outputBase}/extension-confirmation.png`);
await popup.close();
popup = await open(popupUrl);
await ready();
await popup.until("!document.querySelector('#run-confirm').hidden");
await popup.click("#run-confirm");
await waitRun("r.nextStep>=4");
await popup.close();
await page.until(
  "location.pathname==='/results' && document.querySelector('#result-query')?.textContent==='Alpha'",
);
// Observe the worker directly: reopening the popup must not be what advances the run.
let worker = await connect(
  (await targets()).find(
    (t) => t.type === "service_worker" && t.url.endsWith("/background.js"),
  ),
);
await worker.until(
  "chrome.storage.local.get('runState').then(s=>s.runState&&!s.runState.active&&s.runState.nextStep===s.runState.totalSteps)",
);
worker.disconnect();
popup = await open(popupUrl);
await ready();
await startSearch("Beta");
await popup.click("#run-confirm");
await waitRun("!r.active && r.nextStep===r.totalSteps");
assert.equal(
  await page.evaluate("document.querySelector('#result-query').textContent"),
  "Beta",
);
if (outputBase) await popup.screenshot(`${outputBase}/extension-run.png`);

// Pause takes effect before another action; resuming still pauses before submission.
await page.navigate(fixtureBase);
await popup.evaluate(
  "document.querySelector('[data-parameter=search_1]').value='Gamma';true",
);
await page.activate();
await popup.click("#run-start");
await waitRun("r.active");
await popup.click("#run-pause");
const paused = await waitRun("r.pauseReason==='user'");
await sleep(1200);
assert.equal((await run()).nextStep, paused.nextStep);
await popup.click("#run-resume");
await waitRun("r.pauseReason==='confirmation'");
await popup.click("#run-stop");
await waitRun("!r.active");
await sleep(1000);
assert.equal(await page.evaluate("location.pathname"), "/");

// Manual mode remains available but never advances by itself.
await popup.evaluate(
  "document.querySelector('#run-mode').value='manual';document.querySelector('#run-mode').dispatchEvent(new Event('change'));true",
);
await page.activate();
await popup.click("#run-start");
await waitRun("r.active");
await sleep(1000);
assert.equal((await run()).nextStep, 0);
await popup.click("#run-next");
await waitRun("r.nextStep===1");
await popup.click("#run-stop");
await waitRun("!r.active");

// Ambiguous targets block automatic execution, including risky clicks.
const clickMarkdown = [
  "---",
  "name: ambiguous-target",
  "description: Safe target test",
  "---",
  "",
  "```json show-me-once",
  JSON.stringify({
    schemaVersion: 1,
    parameters: [{ name: "target_1", type: "string" }],
    steps: [
      { kind: "navigation", url: fixtureBase.slice(0, -1) },
      {
        kind: "click",
        url: fixtureBase.slice(0, -1),
        selector: "button:nth-of-type(1)",
        parameter: "target_1",
      },
    ],
  }),
  "```",
].join("\n");
await page.evaluate(
  "const copy=document.querySelector('#delete-demo').cloneNode(true);copy.id='duplicate-delete';document.body.append(copy);true",
);
await popup.evaluate(
  `chrome.storage.local.set({skillDraft:${JSON.stringify({ sourceRecordingId: "ambiguous", name: "ambiguous-target", description: "Safe target test", markdown: clickMarkdown })}})`,
);
await popup.until("document.querySelector('[data-parameter=target_1]')!==null");
await popup.evaluate(
  "document.querySelector('#run-mode').value='automatic';document.querySelector('#run-mode').dispatchEvent(new Event('change'));document.querySelector('[data-parameter=target_1]').value='Delete demo item';true",
);
await page.activate();
await popup.click("#run-start");
await waitRun("r.pauseReason==='blocked'");
assert.equal(
  await page.evaluate("document.querySelector('#action-status').textContent"),
  "No action executed.",
);
await popup.click("#run-stop");
await waitRun("!r.active");

// A persisted automatic run resumes after its MV3 worker is deliberately terminated.
const recoveryMarkdown = [
  "---",
  "name: worker-recovery",
  "description: Worker recovery test",
  "---",
  "",
  "```json show-me-once",
  JSON.stringify({
    schemaVersion: 1,
    parameters: [],
    steps: Array.from({ length: 12 }, () => ({
      kind: "navigation",
      url: fixtureBase.slice(0, -1),
    })),
  }),
  "```",
].join("\n");
await page.navigate(fixtureBase);
await popup.evaluate(
  `chrome.storage.local.set({skillDraft:${JSON.stringify({ sourceRecordingId: "recovery", name: "worker-recovery", description: "Worker recovery test", markdown: recoveryMarkdown })}})`,
);
await popup.until(
  "document.querySelector('#current-name').textContent==='worker-recovery'",
);
await page.activate();
await popup.click("#run-start");
await waitRun("r.active && r.nextStep>=1 && r.nextStep<r.totalSteps");
await popup.close();
const oldWorker = (await targets()).find(
  (t) => t.type === "service_worker" && t.url.endsWith("/background.js"),
);
assert.ok(oldWorker);
const browserInfo = await fetch("http://localhost:9226/json/version").then(
  (r) => r.json(),
);
const browser = await connect(browserInfo);
assert.equal(
  (await browser.command("Target.closeTarget", { targetId: oldWorker.id }))
    .success,
  true,
);
browser.disconnect();
let recoveredWorker;
const recoveryDeadline = Date.now() + 50000;
while (Date.now() < recoveryDeadline) {
  const candidate = (await targets()).find(
    (t) =>
      t.type === "service_worker" &&
      t.url.endsWith("/background.js") &&
      t.id !== oldWorker.id,
  );
  if (candidate) {
    recoveredWorker = candidate;
    break;
  }
  await sleep(400);
}
assert.ok(
  recoveredWorker,
  "The recovery alarm did not wake the suspended worker.",
);
worker = await connect(recoveredWorker);
await worker.until(
  "chrome.storage.local.get('runState').then(s=>s.runState?.skillKey==='recovery'&&!s.runState.active&&s.runState.nextStep===12)",
);
worker.disconnect();
popup = await open(popupUrl);
await ready();

// The two completed automatic saved-skill runs must have server logs without inputs.
const remote = await app.evaluate(
  "fetch('/api/rpc/run/list',{method:'POST',headers:{'Content-Type':'application/json'},body:'{\"json\":{}}'}).then(r=>r.json()).then(r=>r.json)",
);
assert.ok(
  remote.filter(
    (r) => r.status === "COMPLETED" && r.skillId === savedDraft.remoteSkillId,
  ).length >= 2,
);
assert.ok(
  !JSON.stringify(remote).includes("Alpha") &&
    !JSON.stringify(remote).includes("Beta"),
);
console.log(
  JSON.stringify({
    recordToDraft: true,
    secretFiltering: true,
    inlineSaveFeedback: true,
    automaticTwoInputs: true,
    popupClosedExecution: true,
    confirmationPause: true,
    pauseResume: true,
    stop: true,
    manualMode: true,
    ambiguousTargetBlocked: true,
    workerTerminationRecovery: true,
    serverLogs: true,
  }),
);
await popup.close();
await page.close();
await app.close();
