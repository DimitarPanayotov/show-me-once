import { browser } from "wxt/browser";
import {
  checkedExternalCommand,
  type ExternalIdentity,
  type ExternalResult,
} from "@show-me-once/shared/mcp";

const BASE = "http://127.0.0.1:4320";
type Pair = { token: string; bridgeId: string; instanceId: string };
export class ExternalBridgeClient {
  private socket?: WebSocket;
  private identity?: { bridgeId: string; connectionId: string };
  private command: (
    identity: ExternalIdentity,
    command: unknown,
  ) => Promise<ExternalResult>;
  private lost: (controllerId?: string) => void;
  constructor(
    command: (
      identity: ExternalIdentity,
      command: unknown,
    ) => Promise<ExternalResult>,
    lost: (controllerId?: string) => void,
  ) {
    this.command = command;
    this.lost = lost;
  }
  current() {
    return this.identity;
  }
  async status() {
    return {
      paired: !!(await browser.storage.session.get("mcpPair")).mcpPair,
      connected: !!this.identity,
    };
  }
  async pair(token: string) {
    if (token.length < 16 || token.length > 128)
      throw new Error("Enter the MCP bridge pairing code.");
    const response = await fetch(`${BASE}/pair`, {
      method: "POST",
      credentials: "omit",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok)
      throw new Error(
        "Could not pair the MCP bridge. Check its code and extension ID.",
      );
    const { bridgeId } = (await response.json()) as { bridgeId: string };
    if (!/^[a-f0-9-]{36}$/.test(bridgeId))
      throw new Error("Invalid MCP bridge identity.");
    const stored = await browser.storage.local.get("mcpInstanceId");
    const instanceId =
      typeof stored.mcpInstanceId === "string"
        ? stored.mcpInstanceId
        : crypto.randomUUID();
    if (!stored.mcpInstanceId)
      await browser.storage.local.set({ mcpInstanceId: instanceId });
    await browser.storage.session.set({
      mcpPair: { token, bridgeId, instanceId } satisfies Pair,
    });
    await browser.alarms.create("mcp-reconnect", { periodInMinutes: 0.5 });
    await this.connect();
  }
  async disconnect() {
    await browser.storage.session.remove("mcpPair");
    await browser.alarms.clear("mcp-reconnect");
    this.socket?.close();
    this.identity = undefined;
    this.lost();
    await browser.storage.session.set({ mcpConnected: false });
  }
  async connect() {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    const pair = (await browser.storage.session.get("mcpPair")).mcpPair as
      | Pair
      | undefined;
    if (!pair) return;
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
            void browser.storage.session.set({ mcpConnected: true });
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
        reject(new Error("MCP bridge unavailable. Start it and reconnect."));
      };
      socket.onclose = () => {
        clearTimeout(timeout);
        if (heartbeat) clearInterval(heartbeat);
        if (this.socket === socket) {
          this.identity = undefined;
          this.socket = undefined;
          this.lost();
          void browser.storage.session.set({ mcpConnected: false });
        }
        reject(new Error("MCP bridge disconnected."));
      };
    });
  }
}
