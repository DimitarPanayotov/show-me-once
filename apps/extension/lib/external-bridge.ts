import {
  checkedExternalCommand,
  type ExternalIdentity,
  type ExternalResult,
} from "@show-me-once/shared/mcp";

const BASE = "http://127.0.0.1:4320";
type Pair = { token: string; bridgeId: string; instanceId: string };
type StorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
};
export type BridgeEnvironment = {
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
    return {
      paired: !!(await this.readPair()),
      connected: !!this.identity,
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
  async disconnect() {
    this.generation++;
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
    if (!pair) return;
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
}
