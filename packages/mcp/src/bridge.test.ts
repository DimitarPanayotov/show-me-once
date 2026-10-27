import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { WebSocket } from "ws";
import { createBridge } from "./bridge.ts";
const origin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
async function setup(timeoutMs = 1000) {
  const bridge = createBridge(origin, { port: 0, timeoutMs });
  const port = await bridge.listen();
  return { bridge, port, url: `http://127.0.0.1:${port}` };
}
async function extension(
  f: Awaited<ReturnType<typeof setup>>,
  token = f.bridge.extensionToken,
  instanceId = randomUUID(),
) {
  const socket = new WebSocket(`ws://127.0.0.1:${f.port}/extension`, {
    origin,
  });
  await once(socket, "open");
  socket.send(
    JSON.stringify({
      type: "hello",
      bridgeId: f.bridge.bridgeId,
      token,
      instanceId,
    }),
  );
  return socket;
}
test("bridge rejects wrong origins, unauthenticated agents, malformed hosts, wrong tokens and duplicate extension identities", async () => {
  const f = await setup();
  try {
    assert.equal(
      (
        await fetch(`${f.url}/pair`, {
          method: "POST",
          headers: {
            Origin: "https://evil.example",
            Authorization: `Bearer ${f.bridge.extensionToken}`,
          },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${f.url}/pair`, {
          method: "POST",
          headers: {
            Origin: origin,
            Authorization: `Bearer ${"é".repeat(f.bridge.extensionToken.length)}`,
          },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${f.url}/command`, {
          method: "POST",
          headers: { "X-SMO-Controller": randomUUID() },
          body: "{}",
        })
      ).status,
      401,
    );
    const spoofed = await new Promise<number | undefined>((resolve) => {
      const req = httpRequest(
        `${f.url}/pair`,
        {
          method: "POST",
          headers: {
            Host: "evil.example",
            Origin: origin,
            Authorization: `Bearer ${f.bridge.extensionToken}`,
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.end();
    });
    assert.equal(spoofed, 403);
    const bad = await extension(f, "wrong-code");
    assert.equal((await once(bad, "close"))[0], 1008);
    const good = await extension(f);
    assert.equal(
      JSON.parse(String((await once(good, "message"))[0])).type,
      "connected",
    );
    const duplicate = await extension(f);
    assert.equal((await once(duplicate, "close"))[0], 1008);
    good.close();
  } finally {
    await f.bridge.close();
  }
});
test("bridge disconnect/timeout resolves unknown outcomes without replaying commands", async () => {
  const f = await setup(150);
  try {
    const socket = await extension(f);
    await once(socket, "message");
    let commands = 0,
      cancels = 0;
    socket.on("message", (bytes) => {
      const m = JSON.parse(String(bytes));
      if (m.type === "command") commands++;
      if (m.type === "cancel") cancels++;
    });
    const headers = {
      Authorization: `Bearer ${f.bridge.agentToken}`,
      "X-SMO-Controller": randomUUID(),
      "Content-Type": "application/json",
    };
    const response = await fetch(`${f.url}/command`, {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "status", runId: "run-one" }),
    });
    assert.equal(
      ((await response.json()) as { status: string }).status,
      "unknown_outcome",
    );
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(commands, 1);
    assert.equal(cancels, 1);
    const abort = new AbortController();
    const cancelled = fetch(`${f.url}/command`, {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "status", runId: "run-one" }),
      signal: abort.signal,
    });
    await once(socket, "message");
    abort.abort();
    await assert.rejects(cancelled);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(commands, 2);
    assert.equal(cancels, 2);
    const request = fetch(`${f.url}/command`, {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "status", runId: "run-one" }),
    });
    await once(socket, "message");
    socket.close();
    assert.equal(
      ((await (await request).json()) as { status: string }).status,
      "unknown_outcome",
    );
    assert.equal(commands, 3);
  } finally {
    await f.bridge.close();
  }
});
test("a vanished MCP process loses its controller lease and notifies the extension", async () => {
  const bridge = createBridge(origin, { port: 0, leaseMs: 60 });
  const port = await bridge.listen();
  const f = { bridge, port, url: `http://127.0.0.1:${port}` };
  try {
    const socket = await extension(f);
    await once(socket, "message");
    const controllerId = randomUUID();
    const received = once(socket, "message");
    await fetch(`${f.url}/heartbeat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bridge.agentToken}`,
        "X-SMO-Controller": controllerId,
      },
    });
    const value = JSON.parse(String((await received)[0]));
    assert.equal(value.type, "controller_disconnected");
    assert.equal(value.controllerId, controllerId);
    socket.close();
  } finally {
    await bridge.close();
  }
});
