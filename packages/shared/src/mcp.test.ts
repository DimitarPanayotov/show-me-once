import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  checkedExternalCommand,
  withMcpInstructions,
  permittedDestination,
  permittedFormDestination,
} from "./mcp.ts";
import { parseSkillPlan } from "./index.ts";
const markdown = await readFile(
  new URL("../../../examples/wikipedia-search/SKILL.md", import.meta.url),
  "utf8",
);

test("same-origin search redirect forms are allowed while cross-origin, credential-bearing and unexpected-page submissions stay blocked", () => {
  const scope = ["https://www.wikipedia.org", "https://en.wikipedia.org/…/…"];
  const current = "https://www.wikipedia.org/";
  assert.equal(
    permittedDestination(
      "https://www.wikipedia.org/search-redirect.php",
      scope,
    ),
    false,
  );
  assert.equal(
    permittedFormDestination(
      "https://www.wikipedia.org/search-redirect.php",
      scope,
      current,
    ),
    true,
  );
  assert.equal(
    permittedFormDestination(
      "https://en.wikipedia.org/w/index.php",
      scope,
      current,
    ),
    true,
  );
  for (const raw of [
    "https://unrelated.example/search",
    "https://www.wikipedia.org.evil.invalid/search",
    "javascript:alert(1)",
    "https://user:secret@www.wikipedia.org/search",
    "https://en.wikipedia.org/unexpected/path/depth",
  ])
    assert.equal(permittedFormDestination(raw, scope, current), false);
  assert.equal(
    permittedFormDestination(
      "https://www.wikipedia.org/search-redirect.php",
      scope,
      "https://unrelated.example/",
    ),
    false,
  );
});
test("agent export preserves the executable plan and adds discoverable MCP instructions exactly once", () => {
  const exported = withMcpInstructions(markdown);
  assert.deepEqual(parseSkillPlan(exported), parseSkillPlan(markdown));
  for (const tool of [
    "start_skill",
    "observe_run",
    "act",
    "get_run_status",
    "stop_run",
  ])
    assert.ok(exported.includes(tool));
  assert.equal(withMcpInstructions(exported), exported);
  assert.throws(() =>
    withMcpInstructions(`${markdown}\npassword=do-not-export`),
  );
});
test("MCP input boundary rejects approval, arbitrary URLs/code, unknown parameters and secrets", () => {
  const plan = parseSkillPlan(markdown),
    parameters = Object.fromEntries(
      plan.parameters.map((p) => [p.name, "Grace Hopper"]),
    );
  assert.equal(
    checkedExternalCommand({ kind: "start", markdown, parameters }).kind,
    "start",
  );
  for (const extra of [
    { confirmed: true },
    { approvalToken: "token" },
    { javascript: "alert(1)" },
    { url: "https://example.com" },
  ])
    assert.throws(() =>
      checkedExternalCommand({
        kind: "act",
        runId: "run",
        stepIndex: 1,
        observationId: "obs",
        action: "click",
        targetId: "c1",
        ...extra,
      }),
    );
  assert.throws(() =>
    checkedExternalCommand({
      kind: "start",
      markdown,
      parameters: { ...parameters, unrecognized: "x" },
    }),
  );
  assert.throws(() =>
    checkedExternalCommand({
      kind: "start",
      markdown,
      parameters: Object.fromEntries(
        plan.parameters.map((p) => [p.name, "password=do-not-send"]),
      ),
    }),
  );
});
test("external links and form destinations remain within the current/next checkpoint scope", () => {
  const scope = ["https://www.wikipedia.org", "https://en.wikipedia.org/…/…"];
  assert.equal(
    permittedDestination("https://en.wikipedia.org/wiki/Grace_Hopper", scope),
    true,
  );
  for (const url of [
    "https://evil.example/wiki/Topic",
    "javascript:alert(1)",
    "https://user:password@en.wikipedia.org/wiki/Topic",
    "https://en.wikipedia.org/unplanned",
  ])
    assert.equal(permittedDestination(url, scope), false);
});
