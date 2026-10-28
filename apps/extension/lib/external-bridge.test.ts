import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ExternalBridgeClient,
  type BridgeEnvironment,
} from "./external-bridge.ts";

test("extension remembers pairing across browser restarts, refreshes relay identity and forgets it on request", async () => {
  const originalFetch = globalThis.fetch;
  const originalSocket = globalThis.WebSocket;
  let bridgeId = randomUUID(),
    lost = 0,
    sockets = 0,
    pairCalls = 0,
    online = true,
    alarms = 0;
  const token = "browser-credential-that-is-long-enough";
  const local: Record<string, unknown> = {};
  let session: Record<string, unknown> = {};
  const area = (values: () => Record<string, unknown>) => ({
    get: async (key: string) => ({ [key]: values()[key] }),
    set: async (value: Record<string, unknown>) => {
      Object.assign(values(), value);
    },
    remove: async (key: string) => {
      delete values()[key];
    },
  });
  const environment: BridgeEnvironment = {
    storage: { local: area(() => local), session: area(() => session) },
    alarms: {
      create: async () => {
        alarms++;
      },
      clear: async () => true,
    },
  };
  class Socket {
    static OPEN = 1;
    readyState = 0;
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onerror?: () => void;
    onclose?: () => void;
    constructor(_url: string) {
      sockets++;
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.();
      }, 0);
    }
    send(text: string) {
      const message = JSON.parse(text);
      if (message.type === "hello") {
        assert.equal(message.token, token);
        assert.equal(message.bridgeId, bridgeId);
        queueMicrotask(() =>
          this.onmessage?.({
            data: JSON.stringify({
              type: "connected",
              bridgeId,
              connectionId: randomUUID(),
            }),
          }),
        );
      }
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  globalThis.fetch = (async (_url, init) => {
    pairCalls++;
    if (!online) throw new Error("Agent closed");
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      `Bearer ${token}`,
    );
    return new Response(JSON.stringify({ bridgeId }));
  }) as typeof fetch;
  const clients: ExternalBridgeClient[] = [];
  const create = () => {
    const client = new ExternalBridgeClient(
      async () => ({ status: "blocked" }),
      () => {
        lost++;
      },
      environment,
    );
    clients.push(client);
    return client;
  };
  try {
    const first = create();
    await first.pair(token);
    assert.deepEqual(await first.status(), { paired: true, connected: true });
    assert.equal(session.mcpPair, undefined);
    assert.ok(local.mcpPair);
    // Simulate Chrome ending a worker/socket without invoking Forget connection.
    (first as unknown as { socket: Socket }).socket.close();
    session = {};
    bridgeId = randomUUID();
    const reopened = create();
    online = false;
    const before = alarms;
    await assert.rejects(reopened.connect(), /Open your coding agent/);
    assert.ok(
      alarms > before,
      "Retry alarm must survive a Chrome restart while the agent is closed",
    );
    assert.deepEqual(await reopened.status(), {
      paired: true,
      connected: false,
    });
    online = true;
    await Promise.all([reopened.connect(), reopened.connect()]);
    assert.deepEqual(await reopened.status(), {
      paired: true,
      connected: true,
    });
    assert.equal(sockets, 2);
    assert.equal(pairCalls, 4);
    assert.equal((local.mcpPair as { bridgeId: string }).bridgeId, bridgeId);
    assert.ok(lost >= 1);
    await reopened.disconnect();
    assert.deepEqual(await reopened.status(), {
      paired: false,
      connected: false,
    });
    await reopened.connect();
    assert.equal(sockets, 2);
  } finally {
    for (const client of clients) await client.disconnect();
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalSocket;
  }
});
