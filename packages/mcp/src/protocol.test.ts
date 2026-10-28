import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { WebSocket } from "ws";
import { createBridge } from "./bridge.ts";
import {
  SkillCatalog,
  EXAMPLE_ID,
} from "../../../apps/extension/lib/skill-catalog.ts";

test("official SDK client discovers seven tools, reads an example directly and forwards guarded calls over the authenticated bridge", async () => {
  const origin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const bridge = createBridge(origin, { port: 0 });
  const port = await bridge.listen();
  const folder = await mkdtemp(join(tmpdir(), "smo-mcp-test-")),
    file = join(folder, "connection.json");
  await writeFile(
    file,
    JSON.stringify({
      url: `http://127.0.0.1:${port}`,
      token: bridge.agentToken,
      bridgeId: bridge.bridgeId,
    }),
    { mode: 0o600 },
  );
  const client = new Client({ name: "integration-test", version: "1.0.0" });
  let socket: WebSocket | undefined;
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          "--experimental-strip-types",
          resolve(process.env.SMO_MCP_SERVER_PATH ?? "src/server.ts"),
        ],
        env: { ...process.env, SMO_MCP_CONNECTION_FILE: file } as Record<
          string,
          string
        >,
        stderr: "pipe",
      }),
    );
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "act",
      "get_run_status",
      "get_skill",
      "list_skills",
      "observe_run",
      "start_skill",
      "stop_run",
    ]);
    assert.equal(
      tools.some((t) => /approve|javascript|shell|navigate/.test(t.name)),
      false,
    );
    socket = new WebSocket(`ws://127.0.0.1:${port}/extension`, { origin });
    await once(socket, "open");
    socket.send(
      JSON.stringify({
        type: "hello",
        bridgeId: bridge.bridgeId,
        token: bridge.extensionToken,
        instanceId: randomUUID(),
      }),
    );
    await once(socket, "message");
    let received = 0;
    const catalog = new SkillCatalog({
      readLocal: async () => ({}),
      listLibrary: async () => [],
      getLibrary: async () => {
        throw new Error("Not signed in");
      },
      userId: async () => undefined,
    });
    socket.on("message", async (bytes) => {
      const m = JSON.parse(String(bytes));
      if (m.type === "command") {
        received++;
        assert.match(m.controllerId, /^[a-f0-9-]{36}$/);
        socket!.send(
          JSON.stringify({
            type: "result",
            id: m.id,
            result:
              m.command.kind === "list_skills"
                ? await catalog.list()
                : m.command.kind === "get_skill"
                  ? await catalog.get(m.command.skillId)
                  : { status: "stopped", runId: "run-one" },
          }),
        );
      }
    });
    const result = await client.callTool({
      name: "get_run_status",
      arguments: { runId: "run-one" },
    });
    assert.equal(
      (result.structuredContent as { status: string }).status,
      "stopped",
    );
    assert.equal(received, 1);
    const listed = await client.callTool({
      name: "list_skills",
      arguments: {},
    });
    assert.equal(
      (listed.structuredContent as { skills: { id: string }[] }).skills[0]?.id,
      EXAMPLE_ID,
    );
    const document = await client.callTool({
      name: "get_skill",
      arguments: { skillId: EXAMPLE_ID },
    });
    assert.match(
      (document.structuredContent as { skill: { markdown: string } }).skill
        .markdown,
      /name: wikipedia-search/,
    );
    assert.equal(received, 3);
    const rejected = await client.callTool({
      name: "act",
      arguments: {
        runId: "run-one",
        stepIndex: 0,
        observationId: "obs",
        action: "click",
        targetId: "c1",
        confirmed: true,
      },
    });
    assert.equal(rejected.isError, true);
    assert.equal(received, 3);
  } finally {
    await client.close();
    socket?.terminate();
    await bridge.close();
    await rm(file);
    await rmdir(folder);
  }
});
