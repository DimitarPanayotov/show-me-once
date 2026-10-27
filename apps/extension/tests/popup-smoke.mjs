import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { connect, open, targets } from "./cdp.mjs";

// Run only in the isolated test profile: this replaces its disposable draft.
const workerTarget = (await targets()).find(
  (t) => t.type === "service_worker" && t.url.endsWith("/background.js"),
);
const extensionId = workerTarget
  ? new URL(workerTarget.url).hostname
  : process.env.SMO_EXTENSION_ID;
assert.ok(extensionId, "Load the extension or set SMO_EXTENSION_ID first.");
const popupUrl = `chrome-extension://${extensionId}/popup.html`;
let popup = await open(popupUrl);
const ready = () =>
  popup.until("document.documentElement.dataset.ready==='true'");
await ready();
const markdown = await readFile(
  new URL("../../../examples/wikipedia-search/SKILL.md", import.meta.url),
  "utf8",
);
const id = "popup-editor-test";
await popup.evaluate(`chrome.storage.session.remove('localAgentToken')`);
await popup.evaluate(
  `chrome.storage.local.set(${JSON.stringify({
    popupView: "record",
    recording: {
      id,
      tabId: 1,
      startedAt: Date.now(),
      active: false,
      actions: [
        {
          id: "nav",
          kind: "navigation",
          url: "https://www.wikipedia.org",
          at: Date.now(),
        },
      ],
    },
    skillDraft: {
      sourceRecordingId: id,
      name: "wikipedia-search",
      description: "Search Wikipedia.",
      markdown,
      dirty: true,
    },
    runState: null,
    runEngine: "agent",
    agentProvider: "codex-local",
  })})`,
);
await popup.click("#tab-record");
await popup.until("!document.querySelector('#skill-section').hidden");

async function typeWithoutRefocusing(selector, suffix) {
  const initial = await popup.evaluate(`(() => {
    const field = document.querySelector(${JSON.stringify(selector)});
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
    return field.value;
  })()`);
  let expected = initial;
  for (const character of suffix) {
    await popup.command("Input.insertText", { text: character });
    expected += character;
    // Allow the asynchronous storage-change render after every keystroke.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const actual = await popup.evaluate(`(() => {
      const field = document.querySelector(${JSON.stringify(selector)});
      return { focused: document.activeElement === field, value: field.value, caret: field.selectionStart };
    })()`);
    assert.equal(actual.focused, true, `${selector} lost focus while typing`);
    assert.equal(
      actual.value,
      expected,
      `${selector} changed typed text or spaces`,
    );
    assert.equal(actual.caret, expected.length, `${selector} moved the caret`);
  }
}

for (const view of process.env.SMO_CONNECTION_ONLY ? [] : ["record", "run"]) {
  await popup.click(`#tab-${view}`);
  await popup.evaluate(
    "document.querySelector('#run-editor-details').open=true;document.querySelector('#draft-section').open=true;true",
  );
  await typeWithoutRefocusing("#skill-name", "x revised name ");
  await typeWithoutRefocusing("#skill-description", " with more words ");
  await typeWithoutRefocusing(
    "#skill-markdown",
    "\nExtra instructions here.\n",
  );
  console.log(
    JSON.stringify({
      editorView: view,
      continuousTyping: true,
      spacesAndCaret: true,
    }),
  );
}

// Edit in the middle, including replacement of a selected range.
const before = await popup.evaluate(
  "document.querySelector('#skill-description').value",
);
await popup.evaluate(
  "document.querySelector('#skill-description').focus();document.querySelector('#skill-description').setSelectionRange(7,16);true",
);
await popup.command("Input.insertText", { text: "the public encyclopedia" });
await new Promise((resolve) => setTimeout(resolve, 100));
const edited =
  before.slice(0, 7) + "the public encyclopedia" + before.slice(16);
assert.deepEqual(
  await popup.evaluate(
    "({value:document.querySelector('#skill-description').value,caret:document.querySelector('#skill-description').selectionStart,focused:document.activeElement.id})",
  ),
  {
    value: edited,
    caret: 7 + "the public encyclopedia".length,
    focused: "skill-description",
  },
);
const savedDraft = await popup.evaluate(
  "chrome.storage.local.get('skillDraft').then(s=>s.skillDraft)",
);
await popup.close();
popup = await open(popupUrl);
await ready();
assert.deepEqual(
  await popup.evaluate(
    "({name:document.querySelector('#skill-name').value,description:document.querySelector('#skill-description').value,markdown:document.querySelector('#skill-markdown').value})",
  ),
  {
    name: savedDraft.name,
    description: savedDraft.description,
    markdown: savedDraft.markdown,
  },
);
if (process.env.SMO_EDITOR_ONLY) {
  await popup.close();
  process.exit(0);
}
await popup.evaluate(
  `chrome.storage.local.set({skillDraft:${JSON.stringify({ ...savedDraft, name: "Wikipedia search", description: "Search Wikipedia with new inputs." })}})`,
);
await popup.until(
  "document.querySelector('#current-name').textContent==='Wikipedia search'",
);

// Stub only the health transport in this test worker. No model or real helper is invoked.
const worker = await connect(
  (await targets()).find(
    (t) => t.type === "service_worker" && t.url.endsWith("/background.js"),
  ),
);
await worker.evaluate(`globalThis.popupHealthTest={available:true,delay:200,calls:[]};
  globalThis.popupOriginalFetch=globalThis.fetch;
  globalThis.fetch=async (url,init)=>{
    if(String(url)==='http://127.0.0.1:4319/health') {
      await new Promise(resolve=>setTimeout(resolve,globalThis.popupHealthTest.delay));
      if(!globalThis.popupHealthTest.available) throw new TypeError('Test helper offline');
      const authorized=new Headers(init?.headers).get('Authorization')==='Bearer popup-test-pairing-code';
      globalThis.popupHealthTest.calls.push({authorized});
      if(!authorized) return Response.json({error:'Wrong test code'},{status:401});
      return Response.json({ready:true,provider:'codex-local'});
    }
    return globalThis.popupOriginalFetch(url,init);
  };true`);
try {
  await popup.click("#tab-run");
  await popup.until(
    "document.querySelector('#agent-connection-status').dataset.state==='disconnected'",
  );
  await popup.evaluate(
    "document.querySelector('#agent-connection').open=true;document.querySelector('#agent-pair-code').value='incorrect-test-pairing';true",
  );
  await popup.click("#agent-pair");
  await popup.until(
    "document.querySelector('#agent-pair').disabled && document.querySelector('#agent-connection-status').dataset.state==='checking'",
  );
  await popup.until(
    "document.querySelector('#agent-connection-status').dataset.state==='error'",
  );
  assert.ok(
    (
      await popup.evaluate(
        "document.querySelector('#agent-connection-status').textContent",
      )
    ).includes("Could not pair"),
  );
  assert.equal(
    await popup.evaluate("document.querySelector('#error').textContent"),
    "",
  );
  await popup.evaluate(
    "document.querySelector('#agent-pair-code').value='popup-test-pairing-code';true",
  );
  await popup.click("#agent-pair");
  await popup.until(
    "document.querySelector('#agent-connection-status').dataset.state==='connected'",
  );
  assert.equal(
    await popup.evaluate("document.querySelector('#agent-connection').open"),
    false,
  );
  assert.match(
    await popup.evaluate(
      "document.querySelector('#agent-connection-status').textContent",
    ),
    /Connected to local Codex/,
  );
  assert.equal(
    await popup.evaluate("document.querySelector('#agent-pair-code').value"),
    "",
  );
  assert.equal(
    await popup.evaluate("document.querySelector('#run-start').disabled"),
    false,
  );
  if (process.env.SMO_SCREENSHOTS) {
    await popup.evaluate("window.scrollTo(0,0);true");
    await popup.screenshot(
      `${process.env.SMO_SCREENSHOTS}/extension-agent-connected.png`,
    );
  }
  await popup.close();
  popup = await open(popupUrl);
  await ready();
  assert.equal(
    await popup.evaluate(
      "document.querySelector('#agent-connection-status').dataset.state",
    ),
    "connected",
  );
  await worker.evaluate("globalThis.popupHealthTest.available=false;true");
  await popup.close();
  popup = await open(popupUrl);
  await ready();
  assert.equal(
    await popup.evaluate(
      "document.querySelector('#agent-connection-status').dataset.state",
    ),
    "unavailable",
  );
  assert.equal(
    await popup.evaluate("document.querySelector('#run-start').disabled"),
    true,
  );
  await worker.evaluate("globalThis.popupHealthTest.available=true;true");
  await popup.evaluate(
    "document.querySelector('#agent-connection').open=true;true",
  );
  await popup.click("#agent-check");
  await popup.until(
    "document.querySelector('#agent-connection-status').dataset.state==='connected'",
  );
  await popup.click("#agent-disconnect");
  await popup.until(
    "document.querySelector('#agent-connection-status').dataset.state==='disconnected'",
  );
  console.log(
    JSON.stringify({
      selectionReplacement: true,
      editsPersistAfterReopen: true,
      pairingProgress: true,
      pairingFailureInline: true,
      connectedStatusVisible: true,
      reopenedConnectionVerified: true,
      stoppedHelperDetected: true,
      checkConnection: true,
      disconnect: true,
    }),
  );
} catch (error) {
  console.error(
    await worker.evaluate("({healthCalls:globalThis.popupHealthTest.calls})"),
  );
  console.error(
    await popup.evaluate(
      "({state:document.querySelector('#agent-connection-status').dataset.state,message:document.querySelector('#agent-connection-status').textContent,pairDisabled:document.querySelector('#agent-pair').disabled})",
    ),
  );
  throw error;
} finally {
  await worker
    .evaluate(
      "globalThis.fetch=globalThis.popupOriginalFetch;delete globalThis.popupOriginalFetch;delete globalThis.popupHealthTest;true",
    )
    .catch(() => {});
  worker.disconnect();
  await popup.close();
}
