import {
  checkedExternalCommand,
  type ExternalIdentity,
  type ExternalResult,
} from "@show-me-once/shared/mcp";
import { encodeBytes, nonceCommitment, pairingCode, verifyPairingProof, type PairingProof } from '@show-me-once/shared/pairing';

const BASE = "http://127.0.0.1:4320";
type Pair = { token: string; bridgeId: string; instanceId: string; publicKey?: string };
type StorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
};
export type BridgeEnvironment = {
  origin?: string;
  storage: { local: StorageArea; session: StorageArea };
  alarms: {
    create(name: string, info: { periodInMinutes: number }): Promise<void>;
    clear(name: string): Promise<boolean>;
  };
};
export class ExternalBridgeClient {
  private socket?: WebSocket;
  private identity?: { bridgeId: string; connectionId: string };
  private command: (
    identity: ExternalIdentity,
    command: unknown,
  ) => Promise<ExternalResult>;
  private lost: (controllerId?: string) => void;
  private connecting?: Promise<void>;
  private generation = 0;
  private pending?: { id: string; code: string; expiresAt: number; proof: PairingProof };
  private approval?: { resolve(): void; reject(error: Error): void };
  private connectionError?: string;
  private browser: BridgeEnvironment;
  constructor(
    command: (
      identity: ExternalIdentity,
      command: unknown,
    ) => Promise<ExternalResult>,
    lost: (controllerId?: string) => void,
    browser: BridgeEnvironment,
  ) {
    this.command = command;
    this.lost = lost;
    this.browser = browser;
  }
  current() {
    return this.identity;
  }
  async status() {
    const lastError = (await this.browser.storage.session.get('mcpLastError')).mcpLastError as { message?: string } | undefined;
    return {
      paired: !!(await this.readPair()),
      connected: !!this.identity,
      ...((await this.browser.storage.local.get('mcpEnabled')).mcpEnabled ? { enabled: true } : {}),
      ...(this.pending && this.pending.expiresAt > Date.now() ? { pending: { id: this.pending.id, code: this.pending.code, expiresAt: this.pending.expiresAt } } : {}),
      ...(this.connectionError ? { error: this.connectionError } : {}),
      ...(lastError?.message ? { runError: lastError.message } : {}),
    };
  }
  private async readPair(): Promise<Pair | undefined> {
    const local = (await this.browser.storage.local.get("mcpPair")).mcpPair as
      | Pair
      | undefined;
    if (local) return local;
    const previous = (await this.browser.storage.session.get("mcpPair"))
      .mcpPair as Pair | undefined;
    if (previous) {
      await this.browser.storage.local.set({ mcpPair: previous });
      await this.browser.storage.session.remove("mcpPair");
    }
    return previous;
  }
  private async authenticate(token: string) {
    const response = await fetch(`${BASE}/pair`, {
      method: "POST",
      credentials: "omit",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    }).catch(() => {
      throw new Error(
        "Open your coding agent, then check the connection. It starts the connector automatically.",
      );
    });
    if (!response.ok)
      throw new Error(
        "Connection not recognized. Run the one-time setup for this extension and use its pairing code.",
      );
    const { bridgeId } = (await response.json()) as { bridgeId: string };
    if (!/^[a-f0-9-]{36}$/.test(bridgeId))
      throw new Error("Invalid coding-agent connection.");
    return bridgeId;
  }
  async pair(token: string) {
    if (token.length < 16 || token.length > 128)
      throw new Error("Enter the pairing code from the one-time setup.");
    const bridgeId = await this.authenticate(token);
    const stored = await this.browser.storage.local.get("mcpInstanceId");
    const instanceId =
      typeof stored.mcpInstanceId === "string"
        ? stored.mcpInstanceId
        : crypto.randomUUID();
    if (!stored.mcpInstanceId)
      await this.browser.storage.local.set({ mcpInstanceId: instanceId });
    await this.browser.storage.local.set({
      mcpPair: { token, bridgeId, instanceId } satisfies Pair,
    });
    await this.browser.alarms.create("mcp-reconnect", { periodInMinutes: 0.5 });
    await this.connect();
  }
  async begin() {
    await this.browser.storage.local.set({ mcpEnabled: true });
    await this.browser.alarms.create('mcp-reconnect', { periodInMinutes: 0.5 });
    await this.connect().catch(() => {});
    return this.status();
  }
  async approve(pairingId: string) {
    const pending = this.pending;
    if (!pending || pending.id !== pairingId || pending.expiresAt <= Date.now() || this.socket?.readyState !== WebSocket.OPEN)
      throw new Error('This connection request expired. Check the connection again.');
    if (this.approval) throw new Error('Connection approval is already in progress.');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.approval = undefined; reject(new Error('Could not finish connection approval. Check the connection.')); }, 5000);
      this.approval = { resolve: () => { clearTimeout(timer); this.approval = undefined; resolve(); }, reject: e => { clearTimeout(timer); this.approval = undefined; reject(e); } };
      this.socket!.send(JSON.stringify({ type: 'approve', pairingId }));
    });
  }
  async disconnect() {
    this.generation++;
    if (this.identity && (await this.readPair())?.publicKey && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'forget' }));
      // Let the connector persist revocation before closing the socket.
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 1000);
        this.socket?.addEventListener('message', event => {
          try { if (JSON.parse(String(event.data)).type === 'forgotten') { clearTimeout(timer); resolve(); } } catch { /* not the acknowledgement */ }
        });
      });
    }
    await this.browser.storage.local.remove('mcpEnabled');
    await this.browser.storage.session.remove('mcpLastError');
    await this.browser.storage.session.remove('mcpTargetTab');
    this.pending = undefined;
    this.connectionError = undefined;
    await this.browser.storage.local.remove("mcpPair");
    await this.browser.storage.session.remove("mcpPair");
    await this.browser.alarms.clear("mcp-reconnect");
    this.socket?.close();
    this.identity = undefined;
    this.lost();
    await this.browser.storage.session.set({ mcpConnected: false });
  }
  async connect() {
    if (this.connecting) return this.connecting;
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    this.connecting = this.openConnection().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }
  private async openConnection() {
    const generation = this.generation;
    const pair = await this.readPair();
    if (!pair || pair.publicKey) {
      const enabled = (await this.browser.storage.local.get('mcpEnabled')).mcpEnabled;
      if (!pair && !enabled) return;
      return this.openApprovedConnection(pair, generation);
    }
    // Chrome may clear alarms on restart. Retry even when the agent is still closed.
    await this.browser.alarms.create("mcp-reconnect", { periodInMinutes: 0.5 });
    const bridgeId = await this.authenticate(pair.token);
    if (generation !== this.generation) return;
    if (pair.bridgeId !== bridgeId) {
      pair.bridgeId = bridgeId;
      await this.browser.storage.local.set({ mcpPair: pair });
    }
    const socket = new WebSocket("ws://127.0.0.1:4320/extension");
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("MCP bridge connection timed out."));
      }, 4000);
      socket.onopen = () =>
        socket.send(JSON.stringify({ type: "hello", ...pair }));
      let lastMessage = Date.now();
      socket.onmessage = (event) => {
        lastMessage = Date.now();
        try {
          if (typeof event.data !== "string" || event.data.length > 140000)
            throw new Error();
          const message = JSON.parse(event.data);
          if (message.type === "connected") {
            if (
              message.bridgeId !== pair.bridgeId ||
              typeof message.connectionId !== "string"
            )
              throw new Error();
            this.identity = {
              bridgeId: pair.bridgeId,
              connectionId: message.connectionId,
            };
            clearTimeout(timeout);
            heartbeat = setInterval(() => {
              if (Date.now() - lastMessage > 45000) {
                socket.close();
                return;
              }
              if (socket.readyState === WebSocket.OPEN)
                socket.send(JSON.stringify({ type: "heartbeat" }));
            }, 20000);
            void this.browser.storage.session.set({ mcpConnected: true });
            resolve();
            return;
          }
          if (message.type === "heartbeat") return;
          if (
            !this.identity ||
            message.bridgeId !== this.identity.bridgeId ||
            message.connectionId !== this.identity.connectionId ||
            typeof message.controllerId !== "string"
          )
            throw new Error();
          if (
            message.type === "cancel" ||
            message.type === "controller_disconnected"
          ) {
            this.lost(message.controllerId);
            return;
          }
          if (message.type !== "command" || typeof message.id !== "string")
            throw new Error();
          const command = checkedExternalCommand(message.command);
          const identity = {
            ...this.identity,
            controllerId: message.controllerId,
          };
          void this.command(identity, command)
            .catch(() => ({
              status: "blocked" as const,
              message:
                "The command was rejected. Inspect the extension and current run.",
            }))
            .then((result) => {
              if (
                this.socket === socket &&
                socket.readyState === WebSocket.OPEN
              )
                socket.send(
                  JSON.stringify({ type: "result", id: message.id, result }),
                );
            });
        } catch {
          socket.close(1008, "Invalid MCP bridge message");
        }
      };
      socket.onerror = () => {
        clearTimeout(timeout);
        reject(
          new Error(
            "Waiting for your coding agent. Open it, then check the connection.",
          ),
        );
      };
      socket.onclose = () => {
        clearTimeout(timeout);
        if (heartbeat) clearInterval(heartbeat);
        if (this.socket === socket) {
          this.identity = undefined;
          this.socket = undefined;
          this.lost();
          void this.browser.storage.session.set({ mcpConnected: false });
        }
        reject(new Error("MCP bridge disconnected."));
      };
    });
  }

  private async openApprovedConnection(pair: Pair | undefined, generation: number) {
    await this.browser.alarms.create('mcp-reconnect', { periodInMinutes: 0.5 });
    const stored = (await this.browser.storage.local.get('mcpInstanceId')).mcpInstanceId;
    const instanceId = pair?.instanceId ?? (typeof stored === 'string' ? stored : crypto.randomUUID());
    await this.browser.storage.local.set({ mcpInstanceId: instanceId });
    if (generation !== this.generation) return;
    const socket = new WebSocket('ws://127.0.0.1:4320/extension');
    this.socket = socket;
    this.connectionError = undefined;
    this.pending = undefined;
    await new Promise<void>((resolve, reject) => {
      let proof: PairingProof | undefined;
      let commitment = '', expiresAt = 0, verified = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const timeout = setTimeout(() => { socket.close(); reject(new Error('Waiting for your agent. Add the connection in your agent, then check again.')); }, 5000);
      let expiration: ReturnType<typeof setTimeout> | undefined;
      let lastMessage = Date.now();
      const fail = (message: string) => {
        this.connectionError = message;
        this.approval?.reject(new Error(message));
        socket.close(1008, 'Connection rejected'); reject(new Error(message));
      };
      socket.onopen = () => socket.send(JSON.stringify({ type: 'pairing-start', instanceId }));
      let processing = Promise.resolve();
      socket.onmessage = event => { processing = processing.then(async () => {
        try {
          if (generation !== this.generation || this.socket !== socket) return;
          if (typeof event.data !== 'string' || event.data.length > 140000) throw new Error();
          const value = JSON.parse(event.data); lastMessage = Date.now();
          if (value.type === 'pairing-offer' && !proof) {
            if (!/^[a-f0-9-]{36}$/.test(value.pairingId) || !/^[a-f0-9-]{36}$/.test(value.bridgeId) ||
              typeof value.publicKey !== 'string' || !/^[A-Za-z0-9_-]{100,200}$/.test(value.publicKey) ||
              typeof value.commitment !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.commitment) ||
              typeof value.expiresAt !== 'number' || value.expiresAt <= Date.now() || value.expiresAt > Date.now() + 125000) throw new Error();
            if (pair?.publicKey && pair.publicKey !== value.publicKey) {
              fail('This is a different connector. Your saved connection was kept. Reconnect the original agent, or Forget connection to approve a replacement.'); return;
            }
            expiresAt = value.expiresAt; commitment = value.commitment;
            // The browser Origin is part of the signed transcript.
            const origin = this.browser.origin ?? globalThis.location?.origin;
            if (!origin || !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) throw new Error();
            proof = { pairingId: value.pairingId, bridgeId: value.bridgeId, publicKey: value.publicKey,
              origin, instanceId, clientNonce: encodeBytes(crypto.getRandomValues(new Uint8Array(32))), serverNonce: '' };
            socket.send(JSON.stringify({ type: 'pairing-challenge', pairingId: proof.pairingId, clientNonce: proof.clientNonce })); return;
          }
          if (value.type === 'pairing-proof' && proof && !verified) {
            if (typeof value.serverNonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.serverNonce) ||
              typeof value.signature !== 'string' || await nonceCommitment(value.serverNonce) !== commitment) throw new Error();
            proof.serverNonce = value.serverNonce;
            if (!(await verifyPairingProof(proof, value.signature))) throw new Error();
            verified = true; clearTimeout(timeout);
            expiration = setTimeout(() => socket.close(), Math.max(1, expiresAt - Date.now()));
            if (pair) socket.send(JSON.stringify({ type: 'resume', pairingId: proof.pairingId, token: pair.token }));
            else {
              this.pending = { id: proof.pairingId, code: await pairingCode(proof), expiresAt, proof };
              // Traffic keeps the MV3 worker alive while the user compares codes.
              heartbeat = setInterval(() => {
                if (socket.readyState === WebSocket.OPEN)
                  socket.send(JSON.stringify({ type: 'pairing-wait', pairingId: proof!.pairingId }));
              }, 20000);
              await this.browser.storage.session.set({ mcpConnectionChanged: crypto.randomUUID() });
              resolve();
            }
            return;
          }
          if (!verified || !proof) throw new Error();
          if (value.type === 'paired') {
            if (!this.approval || this.pending?.id !== proof.pairingId || value.pairingId !== proof.pairingId || typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.token)) throw new Error();
            await this.browser.storage.local.set({ mcpPair: { token: value.token, bridgeId: proof.bridgeId, instanceId, publicKey: proof.publicKey } satisfies Pair }); return;
          }
          if (value.type === 'connected') {
            if (value.bridgeId !== proof.bridgeId || !/^[a-f0-9-]{36}$/.test(value.connectionId) || (!pair && !this.approval)) throw new Error();
            if (pair && pair.bridgeId !== proof.bridgeId) await this.browser.storage.local.set({ mcpPair: { ...pair, bridgeId: proof.bridgeId } });
            this.identity = { bridgeId: proof.bridgeId, connectionId: value.connectionId };
            this.pending = undefined; clearTimeout(timeout); if (expiration) clearTimeout(expiration);
            if (heartbeat) clearInterval(heartbeat);
            heartbeat = setInterval(() => {
              if (Date.now() - lastMessage > 45000) socket.close();
              else if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'heartbeat' }));
            }, 20000);
            await this.browser.storage.session.set({ mcpConnected: true });
            this.approval?.resolve(); resolve(); return;
          }
          if (value.type === 'heartbeat' || value.type === 'forgotten') return;
          if (!this.identity || value.bridgeId !== this.identity.bridgeId || value.connectionId !== this.identity.connectionId || typeof value.controllerId !== 'string') throw new Error();
          if (value.type === 'cancel' || value.type === 'controller_disconnected') { this.lost(value.controllerId); return; }
          if (value.type !== 'command' || typeof value.id !== 'string') throw new Error();
          const command = checkedExternalCommand(value.command);
          const identity = { ...this.identity, controllerId: value.controllerId };
          void this.command(identity, command).catch(() => ({ status: 'blocked' as const, message: 'The command was rejected. Check the extension.' })).then(result => {
            if (this.socket === socket && socket.readyState === WebSocket.OPEN)
              socket.send(JSON.stringify({ type: 'result', id: value.id, result }));
          });
        } catch { fail('The local connector could not be verified. Your browser has not granted access.'); }
      }); };
      socket.onerror = () => { clearTimeout(timeout); reject(new Error('Waiting for your agent. Add the connection there, then check again.')); };
      socket.onclose = () => {
        clearTimeout(timeout); if (expiration) clearTimeout(expiration); if (heartbeat) clearInterval(heartbeat);
        this.approval?.reject(new Error('Connection closed. Check the connection and approve again.'));
        if (this.socket === socket) {
          this.identity = undefined; this.socket = undefined; this.pending = undefined; this.lost();
          void this.browser.storage.session.set({ mcpConnected: false, mcpConnectionChanged: crypto.randomUUID() });
        }
        reject(new Error('Local agent disconnected. It will reconnect automatically.'));
      };
    });
  }
}
