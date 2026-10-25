import assert from "node:assert/strict";
import { open, targets } from "./cdp.mjs";

const fixtureBase = "http://127.0.0.1:4178/";
const origin = fixtureBase.slice(0, -1);
const output = process.env.SMO_SCREENSHOTS;
const target = (await targets()).find(
  (t) => t.type === "service_worker" && t.url.endsWith("/background.js"),
);
const extensionId = target
  ? new URL(target.url).hostname
  : process.env.SMO_EXTENSION_ID;
assert.ok(extensionId, "Load the extension or set SMO_EXTENSION_ID first.");
const popupUrl = `chrome-extension://${extensionId}/popup.html`;
let popup = await open(popupUrl);
await popup.until("document.documentElement.dataset.ready==='true'");
const page = await open(fixtureBase);
const inputSelector =
  "body:nth-of-type(1) > form:nth-of-type(1) > label:nth-of-type(1) > input:nth-of-type(1)";
const buttonSelector =
  "body:nth-of-type(1) > form:nth-of-type(1) > button:nth-of-type(1)";
const nav = { kind: "navigation", url: origin };
const waitRun = (condition) =>
  popup.until(
    `chrome.storage.local.get('runState').then(s=>{const r=s.runState;return r&&(${condition})?r:null})`,
  );

async function start(
  name,
  steps,
  parameters = [],
  values = {},
  manual = false,
) {
  const markdown = [
    "---",
    `name: ${name}`,
    "description: Controlled confirmation test",
    "---",
    "",
    "```json show-me-once",
    JSON.stringify({ schemaVersion: 1, parameters, steps }),
    "```",
  ].join("\n");
  await popup.evaluate(
    `chrome.storage.local.set({skillDraft:${JSON.stringify({ sourceRecordingId: name, name, description: "Controlled confirmation test", markdown })},popupView:'run'})`,
  );
  await popup.click("#tab-run");
  await popup.until(
    `document.querySelector('#current-name').textContent===${JSON.stringify(name)}`,
  );
  await popup.evaluate(
    `document.querySelector('#run-mode').value=${JSON.stringify(manual ? "manual" : "automatic")};document.querySelector('#run-mode').dispatchEvent(new Event('change'));true`,
  );
  for (const [key, value] of Object.entries(values))
    await popup.evaluate(
      `document.querySelector('[data-parameter="${key}"]').value=${JSON.stringify(value)};true`,
    );
  await page.activate();
  await popup.until("!document.querySelector('#run-start').disabled");
  await popup.click("#run-start");
  await waitRun("r.active");
  if (!manual) await waitRun("r.pauseReason==='confirmation'");
  await popup.until("!document.querySelector('#run-controls').hidden");
}

async function preview() {
  await popup.until(
    "!document.querySelector('#run-confirmation').hidden && !document.querySelector('#run-confirm').disabled",
  );
  return popup.evaluate(
    "chrome.storage.session.get('runConfirmation').then(s=>s.runConfirmation)",
  );
}

await start(
  "search-preview",
  [
    nav,
    {
      kind: "input",
      url: origin,
      selector: inputSelector,
      inputKind: "search",
      parameter: "search_1",
    },
    { kind: "click", url: origin, selector: buttonSelector },
    { kind: "navigation", url: `${origin}/…` },
  ],
  [{ name: "search_1", type: "string" }],
  { search_1: "Alpha preview" },
);
let pending = await preview();
assert.equal(pending.details.intent, "search");
assert.equal(
  await popup.evaluate(
    "document.querySelector('#confirmation-title').textContent",
  ),
  "Submit search on 127.0.0.1:4178",
);
assert.equal(
  await popup.evaluate(
    "document.querySelector('#confirmation-target').textContent",
  ),
  "Click the “Search” button.",
);
assert.equal(
  await popup.evaluate("document.querySelector('#run-confirm').textContent"),
  "Submit search & continue",
);
assert.equal(await page.evaluate("location.pathname"), "/");
const persistent = await popup.evaluate(
  "chrome.storage.local.get(null).then(JSON.stringify)",
);
assert.ok(
  !persistent.includes("Alpha preview") &&
    !persistent.includes("targetLabel") &&
    !persistent.includes("destinationOrigin"),
);
await popup.close();
popup = await open(popupUrl);
await popup.until("document.documentElement.dataset.ready==='true'");
assert.equal((await preview()).details.token, pending.details.token);

// The page changes after the preview: the first approval must NOT submit it.
await page.evaluate(
  "document.querySelector('#search-submit').textContent='Search again';true",
);
await popup.click("#run-confirm");
await popup.until(
  `chrome.storage.session.get('runConfirmation').then(s=>s.runConfirmation?.details.token!==${JSON.stringify(pending.details.token)} && s.runConfirmation?.details.changed)`,
);
pending = await preview();
assert.equal(await page.evaluate("location.pathname"), "/");
assert.equal(
  await popup.evaluate(
    "document.querySelector('#confirmation-target').textContent",
  ),
  "Click the “Search again” button.",
);
assert.equal(
  await popup.evaluate(
    "document.querySelector('#confirmation-changed').hidden",
  ),
  false,
);

// Rebuild an expired session preview without executing anything.
await popup.evaluate("chrome.storage.session.remove('runConfirmation')");
await popup.evaluate("chrome.runtime.sendMessage({type:'get-run'})");
pending = await preview();
assert.equal(await page.evaluate("location.pathname"), "/");
assert.equal(pending.details.intent, "search");
const stale = await popup.evaluate(
  "chrome.runtime.sendMessage({type:'run-next-step',confirm:true,approvalToken:'old-preview'}).then(()=>false,()=>true)",
);
assert.equal(stale, true);
assert.equal(await page.evaluate("location.pathname"), "/");
if (output)
  await popup.screenshot(`${output}/extension-confirmation-search.png`);
await popup.click("#run-confirm");
await waitRun("!r.active && r.nextStep===r.totalSteps");
assert.equal(
  await page.evaluate("document.querySelector('#result-query').textContent"),
  "Alpha preview",
);
assert.equal(
  await popup.evaluate(
    "chrome.storage.session.get('runConfirmation').then(s=>s.runConfirmation===undefined)",
  ),
  true,
);

// An identically labelled replacement DOM node also needs fresh consent.
await page.navigate(fixtureBase);
await start("delete-preview", [
  nav,
  {
    kind: "click",
    url: origin,
    selector: "body:nth-of-type(1) > button:nth-of-type(1)",
  },
]);
pending = await preview();
assert.equal(pending.details.intent, "delete");
assert.equal(
  await popup.evaluate(
    "document.querySelector('#confirmation-target').textContent",
  ),
  "Click the “Delete demo item” button.",
);
assert.equal(
  await page.evaluate("document.querySelector('#action-status').textContent"),
  "No action executed.",
);
await page.evaluate(
  "const old=document.querySelector('#delete-demo');const next=old.cloneNode(true);next.onclick=()=>{document.querySelector('#action-status').textContent='Demo delete executed.'};old.replaceWith(next);true",
);
await popup.click("#run-confirm");
await popup.until(
  `chrome.storage.session.get('runConfirmation').then(s=>s.runConfirmation?.details.token!==${JSON.stringify(pending.details.token)})`,
);
await preview();
assert.equal(
  await page.evaluate("document.querySelector('#action-status').textContent"),
  "No action executed.",
);
if (output)
  await popup.screenshot(`${output}/extension-confirmation-delete.png`);
await popup.click("#run-confirm");
await waitRun("!r.active && r.nextStep===r.totalSteps");
await page.until(
  "document.querySelector('#action-status').textContent==='Demo delete executed.'",
);
assert.ok(
  !(
    await popup.evaluate("chrome.storage.local.get(null).then(JSON.stringify)")
  ).includes("Delete demo item"),
);

// Payments are clearly identified, and Stop cancels the pending approval.
await page.navigate(fixtureBase);
await page.evaluate(
  "const pay=document.createElement('button');pay.textContent='Pay demo invoice';pay.onclick=()=>{document.querySelector('#action-status').textContent='Dummy payment dispatched.'};document.body.append(pay);true",
);
await start("payment-preview", [
  nav,
  {
    kind: "click",
    url: origin,
    selector: "body:nth-of-type(1) > button:nth-of-type(2)",
  },
]);
const paymentPreview = await preview();
assert.equal(paymentPreview.details.intent, "payment");
assert.equal(
  await popup.evaluate("document.querySelector('#run-confirm').textContent"),
  "Authorize payment & continue",
);
await popup.click("#run-stop");
await waitRun("!r.active");
assert.equal(
  await page.evaluate("document.querySelector('#action-status').textContent"),
  "No action executed.",
);
assert.equal(
  await popup.evaluate(
    "chrome.storage.session.get('runConfirmation').then(s=>s.runConfirmation===undefined)",
  ),
  true,
);

// Step-by-step Enter approval names the field and does not imply automatic continuation.
// An old run's token must also expire when the exact same target is used again.
await start("payment-preview", [
  nav,
  {
    kind: "click",
    url: origin,
    selector: "body:nth-of-type(1) > button:nth-of-type(2)",
  },
]);
assert.notEqual((await preview()).details.token, paymentPreview.details.token);
assert.equal(
  await popup.evaluate(
    `chrome.runtime.sendMessage({type:'run-next-step',confirm:true,approvalToken:${JSON.stringify(paymentPreview.details.token)}}).then(()=>false,()=>true)`,
  ),
  true,
);
assert.equal(
  await page.evaluate("document.querySelector('#action-status').textContent"),
  "No action executed.",
);
await popup.click("#run-stop");
await waitRun("!r.active");

await page.navigate(fixtureBase);
await start(
  "enter-preview",
  [nav, { kind: "key", url: origin, selector: inputSelector, key: "Enter" }],
  [],
  {},
  true,
);
await popup.click("#run-next");
await waitRun("r.nextStep===1");
await popup.click("#run-next");
await waitRun("r.pauseReason==='confirmation'");
pending = await preview();
assert.equal(pending.details.interaction, "enter");
assert.equal(
  await popup.evaluate(
    "document.querySelector('#confirmation-target').textContent",
  ),
  "Press Enter in the “Search” field.",
);
assert.equal(
  await popup.evaluate("document.querySelector('#run-confirm').textContent"),
  "Submit search",
);
await popup.click("#run-stop");
await waitRun("!r.active");

console.log(
  JSON.stringify({
    actionSpecificPreview: true,
    popupReopen: true,
    changedLabelReconfirmation: true,
    replacedElementReconfirmation: true,
    expiredPreviewRecovery: true,
    staleConsentRejected: true,
    previousRunConsentRejected: true,
    noLocalLogLeak: true,
    paymentCancellation: true,
    manualEnterPreview: true,
  }),
);
await popup.close();
await page.close();
