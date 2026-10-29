import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, rmdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { WebSocket } from "ws";
import {
  setupConnection,
  readSettings,
  ensureManagedBridge,
} from "./managed.ts";
import { ExternalBridgeClient } from '../../../apps/extension/lib/external-bridge.ts';

const extensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
async function waitUntil(check: () => Promise<boolean>, timeout = 8000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  assert.fail("Timed out waiting for the managed connector lifecycle.");
}

test("one-time setup preserves private credentials and rejects silently replacing another extension", async () => {
  const home = await mkdtemp(join(tmpdir(), "smo-settings-"));
  try {
    const first = await setupConnection(extensionId, home);
    assert.deepEqual(await setupConnection(extensionId, home), first);
    assert.notEqual(first.extensionToken, first.agentToken);
    assert.deepEqual(await readSettings(home), first);
    await assert.rejects(
      setupConnection("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", home),
      /different extension/,
    );
    assert.deepEqual(await readSettings(home), first);
  } finally {
    await rm(join(home, "mcp-settings.json"));
    await rmdir(home);
  }
});

test("MCP clients automatically start, share, stop and restart the connector with stable browser pairing", async () => {
  const home = await mkdtemp(join(tmpdir(), "smo-managed-"));
  const settings = await setupConnection(extensionId, home);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const clients: Client[] = [];
  const sockets: WebSocket[] = [];
  const origin = `chrome-extension://${extensionId}`;
  const env = {
    ...process.env,
    SMO_MCP_HOME: home,
    SMO_MCP_PORT: String(port),
    SMO_MCP_IDLE_MS: "200",
    SMO_MCP_LEASE_MS: "4000",
  } as Record<string, string>;
  delete env.SMO_MCP_CONNECTION_FILE;
  const newClient = async () => {
    const client = new Client({ name: "managed-test", version: "1.0.0" });
    clients.push(client);
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          "--experimental-strip-types",
          resolve(process.env.SMO_MCP_SERVER_PATH ?? "src/server.ts"),
        ],
        env,
        stderr: "pipe",
      }),
    );
    assert.equal((await client.listTools()).tools.length, 8);
    return client;
  };
  const pair = async () => {
    const response = await fetch(`${url}/pair`, {
      method: "POST",
      headers: {
        Origin: origin,
        Authorization: `Bearer ${settings.extensionToken}`,
      },
    });
    assert.equal(response.status, 200);
    const { bridgeId } = (await response.json()) as { bridgeId: string };
    const socket = new WebSocket(`ws://127.0.0.1:${port}/extension`, {
      origin,
    });
    sockets.push(socket);
    await once(socket, "open");
    socket.send(
      JSON.stringify({
        type: "hello",
        bridgeId,
        token: settings.extensionToken,
        instanceId,
      }),
    );
    const hello = JSON.parse(String((await once(socket, "message"))[0]));
    assert.equal(hello.type, "connected");
    socket.on("message", (bytes) => {
      const message = JSON.parse(String(bytes));
      if (message.type === "command")
        socket.send(
          JSON.stringify({
            type: "result",
            id: message.id,
            result: { status: "stopped", runId: "run-one" },
          }),
        );
    });
    return bridgeId;
  };
  const instanceId = randomUUID();
  const offline = async () => {
    try {
      await fetch(`${url}/pair`, {
        method: "POST",
        signal: AbortSignal.timeout(200),
      });
      return false;
    } catch {
      return true;
    }
  };
  try {
    // Race two real stdio servers. They must converge on one authenticated relay.
    const [first, second] = await Promise.all([newClient(), newClient()]);
    const originalId = await pair();
    const result = await second.callTool({
      name: "get_run_status",
      arguments: { runId: "run-one" },
    });
    assert.equal(
      (result.structuredContent as { status: string }).status,
      "stopped",
    );
    await first.close();
    assert.equal(
      (
        await second.callTool({
          name: "get_run_status",
          arguments: { runId: "run-one" },
        })
      ).isError,
      undefined,
    );
    await second.close();
    await waitUntil(offline);
    for (const socket of sockets) socket.terminate();
    const third = await newClient();
    const restartedId = await pair();
    assert.notEqual(restartedId, originalId);
    assert.deepEqual(await readSettings(home), settings);
    assert.equal(
      (
        await third.callTool({
          name: "get_run_status",
          arguments: { runId: "run-one" },
        })
      ).isError,
      undefined,
    );
    await third.close();
    await waitUntil(offline);
    // Startup/shutdown does not create a stale runtime credential file.
    assert.equal(
      JSON.parse(await readFile(join(home, "mcp-settings.json"), "utf8"))
        .extensionToken,
      settings.extensionToken,
    );
  } finally {
    await Promise.allSettled(clients.map((client) => client.close()));
    for (const socket of sockets) socket.terminate();
    await waitUntil(offline);
    await rm(join(home, "mcp-settings.json"));
    await rmdir(home);
  }
});

test('a fresh real MCP client needs no setup file or extension ID; browser approval survives automatic idle shutdown and restart', async () => {
  const home = await mkdtemp(join(tmpdir(), 'smo-first-use-'));
  const port = await freePort();
  const originalSocket = globalThis.WebSocket;
  const origin = `chrome-extension://${extensionId}`;
  class Socket extends WebSocket { constructor(_url: string | URL) { super(`ws://127.0.0.1:${port}/extension`, { origin }); } }
  globalThis.WebSocket = Socket as unknown as typeof globalThis.WebSocket;
  const local: Record<string, unknown> = {}, session: Record<string, unknown> = {};
  const area = (store: Record<string, unknown>) => ({ get: async (key: string) => ({ [key]: store[key] }), set: async (value: object) => { Object.assign(store, value); }, remove: async (key: string) => { delete store[key]; } });
  const browser = new ExternalBridgeClient(async () => ({ status: 'ready', skills: [] }), () => {}, {
    origin, storage: { local: area(local), session: area(session) }, alarms: { create: async () => {}, clear: async () => true },
  });
  const clients: Client[] = [];
  const connect = async () => {
    const client = new Client({ name: 'first-use-test', version: '1' }); clients.push(client);
    const env = { ...process.env, SMO_MCP_HOME: home, SMO_MCP_PORT: String(port), SMO_MCP_IDLE_MS: '200', SMO_MCP_LEASE_MS: '3000' } as Record<string,string>;
    delete env.SMO_MCP_CONNECTION_FILE;
    const transport = new StdioClientTransport({ command: process.execPath, args: ['--experimental-strip-types', resolve(process.env.SMO_MCP_SERVER_PATH ?? 'src/server.ts')], env, stderr: 'pipe' });
    await client.connect(transport);
    return client;
  };
  const offline = async () => { try { await fetch(`http://127.0.0.1:${port}/heartbeat`, { method: 'POST', signal: AbortSignal.timeout(200) }); return false; } catch { return true; } };
  try {
    const first = await connect();
    assert.equal((await first.listTools()).tools.length, 8);
    assert.equal((await readSettings(home)).extensionId, undefined);
    const discovery = first.callTool({ name: 'list_skills', arguments: {} });
    await new Promise(resolve => setTimeout(resolve, 100));
    const pending = await browser.begin();
    const result = (await discovery).structuredContent as any;
    assert.equal(result.status, 'needs_approval'); assert.equal(result.pairingCodes[0], pending.pending!.code);
    await browser.approve(pending.pending!.id);
    assert.equal(((await first.callTool({ name: 'list_skills', arguments: {} })).structuredContent as any).status, 'ready');
    const trust = local.mcpPair;
    await first.close(); await waitUntil(offline);
    const second = await connect();
    await browser.connect();
    assert.equal((await browser.status()).pending, undefined);
    assert.equal((local.mcpPair as any).publicKey, (trust as any).publicKey);
    assert.equal(((await second.callTool({ name: 'list_skills', arguments: {} })).structuredContent as any).status, 'ready');
    await browser.disconnect(); await second.close(); await waitUntil(offline);
  } finally {
    await browser.disconnect(); await Promise.allSettled(clients.map(c => c.close()));
    await waitUntil(offline); globalThis.WebSocket = originalSocket;
    for (const file of await readdir(home)) await rm(join(home, file));
    await rmdir(home);
  }
});

test("a crashed connector is replaced automatically without stale files or rotating pairing", async () => {
  const home = await mkdtemp(join(tmpdir(), "smo-crash-"));
  const settings = await setupConnection(extensionId, home);
  const port = await freePort();
  const relay = resolve(
    process.env.SMO_MCP_RELAY_PATH ?? "src/managed-relay.ts",
  );
  const env = {
    ...process.env,
    SMO_MCP_HOME: home,
    SMO_MCP_PORT: String(port),
    SMO_MCP_IDLE_MS: "200",
    SMO_MCP_LEASE_MS: "1500",
  };
  const owned = spawn(process.execPath, ["--experimental-strip-types", relay], {
    env,
    stdio: "ignore",
    windowsHide: true,
  });
  const controllerId = randomUUID();
  const url = `http://127.0.0.1:${port}`;
  const headers = {
    Authorization: `Bearer ${settings.agentToken}`,
    "X-SMO-Controller": controllerId,
  };
  let oldId = "";
  const offline = async () => {
    try {
      await fetch(`${url}/heartbeat`, {
        method: "POST",
        headers: { Authorization: "Bearer invalid" },
        signal: AbortSignal.timeout(200),
      });
      return false;
    } catch {
      return true;
    }
  };
  try {
    await waitUntil(async () => {
      try {
        const result = await fetch(`${url}/heartbeat`, {
          method: "POST",
          headers,
        });
        oldId = ((await result.json()) as { bridgeId: string }).bridgeId;
        return !!oldId;
      } catch {
        return false;
      }
    });
    const exited = once(owned, "exit");
    owned.kill("SIGKILL");
    await exited;
    const restored = await ensureManagedBridge(controllerId, {
      home,
      port,
      relayPath: relay,
      idleMs: 200,
      leaseMs: 1500,
    });
    assert.notEqual(restored.bridgeId, oldId);
    assert.equal(restored.token, settings.agentToken);
    assert.deepEqual(await readSettings(home), settings);
    await fetch(`${url}/disconnect`, { method: "POST", headers });
    await waitUntil(offline);
  } finally {
    if (owned.exitCode === null && owned.signalCode === null)
      owned.kill("SIGKILL");
    await waitUntil(offline);
    await rm(join(home, "mcp-settings.json"));
    await rmdir(home);
  }
});
