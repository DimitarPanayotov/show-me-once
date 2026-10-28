import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { createBridge } from './bridge.ts';
import { connectorIdentity, type BrowserBinding } from './pairing.ts';
import { ExternalBridgeClient, type BridgeEnvironment } from '../../../apps/extension/lib/external-bridge.ts';

const origin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(r => setTimeout(r, 10)); }
  assert.fail('Connection state did not settle.');
}
function memory() {
  const local: Record<string, unknown> = {}, session: Record<string, unknown> = {};
  const area = (store: Record<string, unknown>) => ({
    get: async (key: string) => ({ [key]: store[key] }),
    set: async (value: object) => { Object.assign(store, structuredClone(value)); },
    remove: async (key: string) => { delete store[key]; },
  });
  const environment: BridgeEnvironment = { origin, storage: { local: area(local), session: area(session) }, alarms: { create: async () => {}, clear: async () => true } };
  return { local, session, environment };
}

test('real extension pairing requires matching-code approval, remembers trust across restart, and rejects a replaced connector before sending its token', async () => {
  const originalSocket = globalThis.WebSocket;
  const token = randomBytes(32).toString('base64url');
  const identity = connectorIdentity(token);
  let bindings: BrowserBinding[] = [], port = 0, calls = 0;
  let bridge = createBridge(undefined, { port: 0, agentToken: token, identity, saveBindings: async next => { bindings = next; } });
  port = await bridge.listen();
  const sent: Record<string, unknown>[] = [];
  class Socket extends WebSocket {
    constructor(_url: string | URL) { super(`ws://127.0.0.1:${port}/extension`, { origin }); }
    override send(data: any, ...args: any[]) { sent.push(JSON.parse(String(data))); return super.send(data, ...args); }
  }
  globalThis.WebSocket = Socket as unknown as typeof globalThis.WebSocket;
  const state = memory();
  const clients: ExternalBridgeClient[] = [];
  const client = () => {
    const c = new ExternalBridgeClient(async () => { calls++; return { status: 'ready', skills: [] }; }, () => {}, state.environment);
    clients.push(c); return c;
  };
  const headers = { Authorization: `Bearer ${token}`, 'X-SMO-Controller': randomUUID(), 'Content-Type': 'application/json' };
  const discover = async () => {
    const response = await fetch(`http://127.0.0.1:${port}/command`, { method: 'POST', headers, body: JSON.stringify({ kind: 'list_skills' }) });
    assert.equal(response.status, 200); return response.json() as Promise<any>;
  };
  try {
    const first = client();
    const status = await first.begin();
    assert.equal(status.connected, false); assert.equal(status.paired, false);
    assert.match(status.pending!.code, /^\d{6}$/);
    const waiting = await discover();
    assert.equal(waiting.status, 'needs_approval');
    assert.deepEqual(waiting.pairingCodes, [status.pending!.code]);
    assert.equal(calls, 0); assert.equal(bindings.length, 0);
    await assert.rejects(first.approve(randomUUID()), /expired/);
    await first.approve(status.pending!.id);
    assert.equal((await first.status()).connected, true);
    assert.equal(bindings.length, 1);
    const saved = structuredClone(state.local.mcpPair) as { token: string; publicKey: string };
    assert.equal(saved.publicKey, identity.publicKey);
    assert.ok(!JSON.stringify(waiting).includes(saved.token));
    assert.equal((await discover()).status, 'ready'); assert.equal(calls, 1);

    await bridge.close();
    await until(() => !first.current());
    bridge = createBridge(undefined, { port: 0, agentToken: token, identity, bindings, saveBindings: async next => { bindings = next; } });
    port = await bridge.listen();
    const reopened = client(); await reopened.connect();
    assert.equal((await reopened.status()).connected, true);
    assert.equal((await reopened.status()).pending, undefined);
    assert.equal((await discover()).status, 'ready');
    assert.equal((state.local.mcpPair as { token: string }).token, saved.token);
    await bridge.close(); await until(() => !reopened.current());

    bridge = createBridge(undefined, { port: 0, identity: connectorIdentity(randomBytes(32).toString('base64url')) });
    port = await bridge.listen(); sent.length = 0;
    const replacement = client();
    await assert.rejects(replacement.connect(), /different connector/);
    assert.ok(!JSON.stringify(sent).includes(saved.token), 'credentials must not be sent to a port takeover');
    assert.equal((await replacement.status()).paired, true);
    assert.match((await replacement.status()).error!, /different connector/);
  } finally {
    await Promise.allSettled(clients.map(c => c.disconnect()));
    await bridge.close(); globalThis.WebSocket = originalSocket;
  }
});

test('a forged connector proof cannot display an approval code or grant browser access', async () => {
  const originalSocket = globalThis.WebSocket;
  const bridge = createBridge(undefined, { port: 0, identity: connectorIdentity(randomBytes(32).toString('base64url')) });
  const port = await bridge.listen();
  class Socket extends WebSocket {
    constructor(_url: string | URL) { super(`ws://127.0.0.1:${port}/extension`, { origin }); }
    override emit(event: string, ...args: any[]): boolean {
      if (event === 'message') {
        const value = JSON.parse(String(args[0]));
        if (value.type === 'pairing-proof') { value.signature = 'A'.repeat(86); args[0] = Buffer.from(JSON.stringify(value)); }
      }
      return super.emit(event, ...args);
    }
  }
  globalThis.WebSocket = Socket as unknown as typeof globalThis.WebSocket;
  const state = memory(); let calls = 0;
  const client = new ExternalBridgeClient(async () => { calls++; return { status: 'ready' }; }, () => {}, state.environment);
  try {
    const status = await client.begin();
    assert.equal(status.pending, undefined); assert.equal(status.connected, false);
    assert.match(status.error!, /could not be verified/);
    assert.equal(state.local.mcpPair, undefined); assert.equal(calls, 0);
    await assert.rejects(client.approve(randomUUID()), /expired/);
  } finally { await client.disconnect(); await bridge.close(); globalThis.WebSocket = originalSocket; }
});

test('Forget connection revokes the remembered browser credential and a website cannot start pairing', async () => {
  const originalSocket = globalThis.WebSocket;
  const token = randomBytes(32).toString('base64url');
  let bindings: BrowserBinding[] = [];
  const bridge = createBridge(undefined, { port: 0, identity: connectorIdentity(token), saveBindings: async next => { bindings = next; } });
  const port = await bridge.listen();
  class Socket extends WebSocket { constructor(_url: string | URL) { super(`ws://127.0.0.1:${port}/extension`, { origin }); } }
  globalThis.WebSocket = Socket as unknown as typeof globalThis.WebSocket;
  const state = memory();
  const client = new ExternalBridgeClient(async () => ({ status: 'ready' }), () => {}, state.environment);
  try {
    const attack = new WebSocket(`ws://127.0.0.1:${port}/extension`, { origin: 'https://evil.example' });
    await new Promise<void>(resolve => { attack.on('error', () => resolve()); attack.on('open', () => assert.fail('Website must not pair')); });
    const status = await client.begin(); await client.approve(status.pending!.id);
    assert.equal(bindings.length, 1);
    await client.disconnect(); assert.equal(bindings.length, 0);
    assert.equal(state.local.mcpPair, undefined); assert.equal(state.local.mcpEnabled, undefined);
    assert.equal((await client.status()).paired, false);
  } finally { await client.disconnect(); await bridge.close(); globalThis.WebSocket = originalSocket; }
});
