import test from "node:test";
import assert from "node:assert/strict";
import { createRouterClient } from "@orpc/server";
import { createSkillMarkdown, parseSkillPlan, readSkillMetadata } from "@show-me-once/shared";
import { router } from "../src/server/router";

const markdown = createSkillMarkdown(
  {
    id: "r",
    active: false,
    tabId: 1,
    startedAt: "",
    actions: [
      {
        id: "1",
        at: "",
        kind: "input",
        inputKind: "text",
        url: "https://example.com",
        selector: "input:nth-of-type(1)",
      },
    ],
  },
  "search-example",
  "Search for a topic.",
);
const input = {
  markdown,
  request: "Find Alpha",
  stepIndex: 0,
  supplied: [],
  observation: {
    id: "fresh",
    url: "https://example.com",
    controls: [
      {
        id: "c1",
        role: "input",
        inputKind: "text",
        label: "Search",
        selector: "input:nth-of-type(2)",
      },
    ],
  },
};

test("library create and update align saved metadata without changing the executable workflow", async () => {
  const captures: { created?: any; updated?: any; version?: any } = {};
  const transaction = {
    skill: {
      updateMany: async (args: any) => { captures.updated = args; return { count: 1 }; },
      findUniqueOrThrow: async () => ({ id: 'saved-skill', currentVersion: 2 }),
    },
    skillVersion: { create: async (args: any) => { captures.version = args.data; } },
  };
  const globals = globalThis as typeof globalThis & { __skillMetadataDb?: unknown };
  globals.__skillMetadataDb = {
    skill: { create: async (args: any) => { captures.created = args.data; return { id: 'saved-skill', currentVersion: 1 }; } },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(transaction),
  };
  try {
    const data = { title: 'github-issue-triage-test-61', description: 'My revised description.', markdown };
    await client(true).skill.create(data);
    await client(true).skill.update({ ...data, id: 'saved-skill' });
    for (const saved of [captures.created.versions.create, captures.version]) {
      assert.deepEqual(readSkillMetadata(saved.markdown), { name: data.title, description: data.description });
      assert.deepEqual(parseSkillPlan(saved.markdown), parseSkillPlan(markdown));
      assert.equal(saved.markdown.slice(saved.markdown.indexOf('# Instructions')), markdown.slice(markdown.indexOf('# Instructions')));
    }
    assert.equal(captures.version.number, 2);
    assert.equal(captures.updated.where.id, 'saved-skill');
    assert.ok(captures.updated.where.ownerId);
    assert.equal(captures.updated.data.title, data.title);
    await assert.rejects(client(false).skill.create(data), /Sign in/);
    await assert.rejects(client(true).skill.create({ ...data, markdown: '---\nname: "unfinished\n' + markdown }), /header/);
  } finally { delete globals.__skillMetadataDb; }
});
const client = (signedIn: boolean) =>
  createRouterClient(router, {
    context: {
      user: signedIn
        ? { id: "test-user", email: "test@example.test", name: null }
        : null,
      token: null,
    },
  });

test("personal keys work with authenticated API calls without owner-configured keys and never appear in results", async () => {
  const old = globalThis.fetch;
  try {
    for (const provider of ["openai", "anthropic"] as const) {
      const key = "test-only-" + provider + "-credential";
      let calls = 0;
      globalThis.fetch = async (url, options) => {
        calls++;
        assert.equal(
          String(url),
          provider === "openai"
            ? "https://api.openai.com/v1/responses"
            : "https://api.anthropic.com/v1/messages",
        );
        const headers = new Headers(options?.headers);
        assert.equal(
          provider === "openai"
            ? headers.get("authorization")
            : headers.get("x-api-key"),
          provider === "openai" ? "Bearer " + key : key,
        );
        const body = JSON.parse(options?.body as string);
        assert.equal(body.model, "test-model");
        assert.equal(JSON.stringify(body).includes(key), false);
        const decision = {
          action: "fill",
          targetId: "c1",
          parameter: "text_1",
          value: "Alpha",
        };
        return Response.json(
          provider === "openai"
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
      };
      const result = await client(true).agent.decide({
        provider,
        apiKey: key,
        model: "test-model",
        input,
      });
      assert.equal(calls, 1);
      assert.equal(JSON.stringify(result).includes(key), false);
    }
  } finally {
    globalThis.fetch = old;
  }
});

test("agent API rejects anonymous calls and secret-containing tasks before any model request", async () => {
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("Unexpected provider request");
  };
  try {
    await assert.rejects(
      client(false).agent.decide({
        provider: "openai",
        apiKey: "test-only-credential",
        input,
      }),
      /Sign in/,
    );
    await assert.rejects(
      client(true).agent.decide({
        provider: "openai",
        apiKey: "test-only-credential",
        input: { ...input, request: "password=must-not-be-sent" },
      }),
      /secrets/,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = old;
  }
});
