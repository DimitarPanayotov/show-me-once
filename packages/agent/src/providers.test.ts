import assert from "node:assert/strict";
import test from "node:test";
import { createSkillMarkdown, type Recording } from "@show-me-once/shared";
import { checkedInput, hostedProvider } from "./providers.ts";
const recording: Recording = {
  id: "recording",
  tabId: 1,
  active: false,
  startedAt: "",
  actions: [
    { id: "1", at: "", kind: "navigation", url: "https://example.com" },
    {
      id: "2",
      at: "",
      kind: "input",
      url: "https://example.com",
      inputKind: "search",
      selector: "input:nth-of-type(1)",
    },
  ],
};
const input = checkedInput({
  markdown: createSkillMarkdown(
    recording,
    "search-example",
    "Search for a new topic",
  ),
  request: "Search for Foundation",
  stepIndex: 1,
  supplied: [],
  observation: {
    id: "obs",
    url: "https://example.com",
    controls: [
      {
        id: "c1",
        role: "input",
        inputKind: "search",
        label: "Search",
        selector: "input:nth-of-type(2)",
      },
    ],
  },
});
const decision = {
  action: "fill",
  targetId: "c1",
  parameter: "search_1",
  value: "Foundation",
};

test("transport and response parsing errors cannot echo a user's API key", async () => {
  const key = "test-only-private-key";
  for (const fetcher of [
    async () => {
      throw new Error(key);
    },
    async () => new Response(key, { status: 200 }),
  ]) {
    const provider = hostedProvider("openai", { key, model: "test", fetcher });
    await assert.rejects(
      provider.decide(input),
      (error) => error instanceof Error && !error.message.includes(key),
    );
  }
});

test("link destinations crossing the model boundary contain only sanitized origin and path depth", () => {
  const observation = {
    ...input.observation,
    controls: [
      {
        ...input.observation.controls[0]!,
        role: "link",
        destination: "https://example.com/…/…",
      },
    ],
  };
  assert.equal(
    checkedInput({ ...input, observation }).observation.controls[0]
      ?.destination,
    "https://example.com/…/…",
  );
  for (const destination of [
    "https://example.com/private/path?token=value",
    "https://user:secret@example.com/",
    "javascript:alert(1)",
  ])
    assert.throws(
      () =>
        checkedInput({
          ...input,
          observation: {
            ...observation,
            controls: [{ ...observation.controls[0], destination }],
          },
        }),
      /Unsafe/,
    );
});

test('control context carries only clearability, heading level and known parameter names', () => {
  const clearable = checkedInput({ ...input, observation: { ...input.observation,
    controls: [{ ...input.observation.controls[0], clearable: true }] } });
  assert.equal(clearable.observation.controls[0]?.clearable, true);
  const link = { ...input.observation.controls[0], role: 'link', headingLevel: 3, matchesParameters: ['search_1'] };
  assert.deepEqual(checkedInput({ ...input, observation: { ...input.observation, controls: [link] } }).observation.controls[0]?.matchesParameters, ['search_1']);
  for (const extra of [{ clearable: 'true' }, { headingLevel: 9 }, { matchesParameters: ['private/path'] }, { matchesParameters: ['search_1', 'search_1'] }])
    assert.throws(() => checkedInput({ ...input, observation: { ...input.observation, controls: [{ ...link, ...extra }] } }), /Unsafe/);
});
for (const id of ["openai", "anthropic"] as const) {
  test(`${id} adapter normalizes its tool call into the same guarded action`, async () => {
    let payload: Record<string, unknown> = {};
    const provider = hostedProvider(id, {
      key: "test-key-never-in-body",
      model: "test-model",
      fetcher: (async (_url, init) => {
        payload = JSON.parse(init!.body as string);
        return Response.json(
          id === "openai"
            ? {
                output: [
                  {
                    type: "function_call",
                    name: "browser_action",
                    arguments: JSON.stringify(decision),
                  },
                ],
              }
            : {
                content: [
                  { type: "tool_use", name: "browser_action", input: decision },
                ],
              },
        );
      }) as typeof fetch,
    });
    assert.deepEqual(await provider.decide(input), decision);
    assert.ok(!JSON.stringify(payload).includes("test-key-never-in-body"));
    assert.ok(JSON.stringify(payload).includes("SKILL.md"));
  });
}
test("model boundary rejects raw URL paths, unexpected controls, credentials, and field values", () => {
  assert.throws(() =>
    checkedInput({ ...input, request: "password=secret123" }),
  );
  assert.throws(() =>
    checkedInput({
      ...input,
      observation: {
        ...input.observation,
        url: "https://example.com/private?token=secret",
      },
    }),
  );
  const clean = checkedInput({
    ...input,
    observation: {
      ...input.observation,
      controls: [{ ...input.observation.controls[0], value: "DO-NOT-SEND" }],
    },
  });
  assert.ok(!JSON.stringify(clean).includes("DO-NOT-SEND"));
});
test("provider errors do not echo response bodies or credentials", async () => {
  const provider = hostedProvider("anthropic", {
    key: "secret-key",
    model: "test",
    fetcher: (async () =>
      new Response("private response body", { status: 429 })) as typeof fetch,
  });
  await assert.rejects(
    provider.decide(input),
    /^Error: anthropic agent request failed \(429\)\.$/,
  );
});
