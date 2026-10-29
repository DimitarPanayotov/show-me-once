import assert from "node:assert/strict";
import test from "node:test";
import {
  checkedDecision,
  containsSecret,
  safeAgentLabel,
  type AgentInput,
} from "./agent.ts";
const input: AgentInput = {
  markdown: "",
  request: "Search for Foundation",
  stepIndex: 0,
  supplied: [],
  plan: {
    schemaVersion: 1,
    parameters: [{ name: "search_1", type: "string" }],
    steps: [
      {
        kind: "input",
        url: "https://example.com",
        selector: "input:nth-of-type(1)",
        inputKind: "search",
        parameter: "search_1",
      },
    ],
  },
  observation: {
    id: "observation",
    url: "https://example.com",
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
        selector: "button:nth-of-type(1)",
      },
    ],
  },
};
test("agent can select a moved live control and extract an exact new input from the request", () => {
  assert.deepEqual(
    checkedDecision(
      {
        action: "fill",
        targetId: "c1",
        parameter: "search_1",
        value: "Foundation",
      },
      input,
    ),
    {
      action: "fill",
      targetId: "c1",
      parameter: "search_1",
      value: "Foundation",
    },
  );
});
test("agent cannot select unknown controls, change the step kind, invent values, or execute code", () => {
  const valid = {
    action: "fill",
    targetId: "c1",
    parameter: "search_1",
    value: "Foundation",
  };
  for (const change of [
    { targetId: "outside" },
    { action: "click" },
    { targetId: "c2" },
    { parameter: "secret" },
    { value: "Not requested" },
    { script: "alert(1)" },
  ])
    assert.throws(() => checkedDecision({ ...valid, ...change }, input));
  const booleanInput: AgentInput = {
    ...input,
    request: "Set selected true",
    plan: {
      ...input.plan,
      parameters: [{ name: "search_1", type: "boolean" }],
    },
  };
  assert.throws(() =>
    checkedDecision({ ...valid, value: false }, booleanInput),
  );
});
test("explicit parameters stay locally bound instead of accepting model replacement values", () => {
  assert.equal(
    checkedDecision(
      {
        action: "fill",
        targetId: "c1",
        parameter: "search_1",
        value: "Model replacement",
      },
      { ...input, supplied: ["search_1"] },
    ).value,
    null,
  );
});

test('empty values clear only optional search controls explicitly marked clearable', () => {
  const decision = { action: 'fill', targetId: 'c1', parameter: 'search_1', value: '' };
  assert.throws(() => checkedDecision(decision, input), /Supply this parameter/);
  const clearable = { ...input, observation: { ...input.observation,
    controls: [{ ...input.observation.controls[0]!, clearable: true }] } };
  assert.equal(checkedDecision(decision, clearable).value, '');
  assert.throws(() => checkedDecision({ ...decision, value: 'invented' }, clearable), /Supply this parameter/);
  assert.throws(() => checkedDecision(decision, { ...clearable, observation: { ...clearable.observation,
    controls: [{ ...clearable.observation.controls[0]!, clearable: false }] } }), /Supply this parameter/);
});
test("observation labels remove obvious credentials, private contact data, and unsafe control characters", () => {
  assert.equal(
    safeAgentLabel("Email alice@example.com\n\u202e"),
    "Email [redacted]",
  );
  assert.ok(
    !safeAgentLabel("token ghp_abcdefghijklmnopqrstuvwxyz123456").includes(
      "abcdefghijklmnopqrstuvwxyz",
    ),
  );
  assert.equal(containsSecret("Search for Foundation"), false);
  assert.equal(containsSecret("password=hunter123"), true);
  assert.equal(containsSecret("api_key=sk-thisisasecrettoken"), true);
  const longLabel = safeAgentLabel("A long visible label ".repeat(12));
  assert.equal(safeAgentLabel(longLabel), longLabel);
});
