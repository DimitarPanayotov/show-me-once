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

test('paired tool calls wake Chrome once, await reconnection and dispatch; heartbeats and connected calls never wake it', async () => {
  let launched = 0;
  const browser: { socket?: WebSocket } = {};
  const bridge = createBridge(origin, { port: 0, browserWaitMs: 500, launchBrowser: async () => {
    launched++;
    setTimeout(async () => {
      const socket = await extension(f);
      browser.socket = socket;
      socket.on('message', raw => {
        const message = JSON.parse(raw.toString());
        if (message.type === 'command') socket.send(JSON.stringify({ type: 'result', id: message.id, result: { status: 'ready' } }));
      });
    }, 20);
  } });
  const port = await bridge.listen(), f = { bridge, port, url: `http://127.0.0.1:${port}` };
  const headers = { Authorization: `Bearer ${bridge.agentToken}`, 'X-SMO-Controller': randomUUID() };
  try {
    await fetch(`${f.url}/heartbeat`, { method: 'POST', headers }); assert.equal(launched, 0);
    const call = () => fetch(`${f.url}/command`, { method: 'POST', headers, body: JSON.stringify({ kind: 'list_skills' }) }).then(r => r.json());
    const results = await Promise.all([call(), call()]);
    assert.ok(results.every(r => r.status === 'ready')); assert.equal(launched, 1);
    assert.equal((await call()).status, 'ready'); assert.equal(launched, 1);
  } finally { browser.socket?.close(); await bridge.close(); }
});

test('a cancelled wake request never dispatches a delayed browser command', async () => {
  let launched!: () => void, release!: () => void, socket: WebSocket | undefined, dispatched = 0;
  const waking = new Promise<void>(resolve => { launched = resolve; });
  const launch = new Promise<void>(resolve => { release = resolve; });
  const bridge = createBridge(origin, { port: 0, browserWaitMs: 500, launchBrowser: async () => { launched(); await launch; } });
  const port = await bridge.listen(), f = { bridge, port, url: `http://127.0.0.1:${port}` };
  const abort = new AbortController();
  try {
    const pending = fetch(`${f.url}/command`, { method: 'POST', signal: abort.signal,
      headers: { Authorization: `Bearer ${bridge.agentToken}`, 'X-SMO-Controller': randomUUID() },
      body: JSON.stringify({ kind: 'start', skillId: 'example:github-issue-triage', parameters: {} }) }).catch(() => undefined);
    await waking; abort.abort(); await pending;
    await new Promise(resolve => setTimeout(resolve, 30));
    socket = await extension(f);
    socket.on('message', raw => { if (JSON.parse(raw.toString()).type === 'command') dispatched++; });
    await once(socket, 'message'); release();
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(dispatched, 0);
  } finally { release(); socket?.close(); await bridge.close(); }
});

test('an unpaired connector never launches Chrome on behalf of a tool call', async () => {
  const { connectorIdentity } = await import('./pairing.ts');
  let launched = 0;
  const token = 'isolated-test-agent-credential-long-enough';
  const bridge = createBridge(undefined, { port: 0, identity: connectorIdentity(token), agentToken: token, launchBrowser: async () => { launched++; } });
  const port = await bridge.listen();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/command`, { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-SMO-Controller': randomUUID() }, body: JSON.stringify({ kind: 'status', runId: 'not-started' }) });
    assert.equal((await response.json()).status, 'disconnected'); assert.equal(launched, 0);
  } finally { await bridge.close(); }
});
