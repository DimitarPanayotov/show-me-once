import { createServer, type IncomingMessage } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import {
  checkedExternalCommand,
  type ExternalResult,
} from "@show-me-once/shared/mcp";

const equal = (a: string, b: string) => {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
export function createBridge(
  extensionOrigin: string,
  options: {
    port?: number;
    extensionToken?: string;
    agentToken?: string;
    timeoutMs?: number;
    leaseMs?: number;
    idleMs?: number;
    onIdle?: () => void;
  } = {},
) {
  if (!/^chrome-extension:\/\/[a-p]{32}$/.test(extensionOrigin))
    throw new Error("Invalid extension origin.");
  const extensionToken =
    options.extensionToken ?? randomBytes(24).toString("base64url");
  const agentToken =
    options.agentToken ?? randomBytes(32).toString("base64url");
  const bridgeId = randomUUID();
  let port = options.port ?? 4320,
    peer: WebSocket | undefined,
    instanceId: string | undefined,
    connectionId: string | undefined;
  const pending = new Map<
    string,
    {
      controllerId: string;
      resolve: (v: ExternalResult) => void;
      timer: ReturnType<typeof setTimeout>;
      runId?: string;
    }
  >();
  const clients = new Map<string, number>();
  let idleSince = Date.now();
  const touch = (controllerId: string) => {
    clients.set(controllerId, Date.now());
    idleSince = Date.now();
  };
  const send = (value: object) => {
    if (peer?.readyState === WebSocket.OPEN) peer.send(JSON.stringify(value));
  };
  const cancel = (id: string) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    send({
      type: "cancel",
      id,
      controllerId: p.controllerId,
      bridgeId,
      connectionId,
    });
    p.resolve({
      status: "unknown_outcome",
      runId: p.runId,
      message:
        "Command interrupted. Inspect status and the page; do not repeat the action.",
    });
  };
  const disconnect = () => {
    for (const id of [...pending.keys()]) cancel(id);
    peer = undefined;
    connectionId = undefined;
  };
  const validHost = (req: IncomingMessage) =>
    req.headers.host === `127.0.0.1:${port}`;
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const reply = (status: number, body: object) => {
      if (!res.writableEnded) {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      }
    };
    if (!validHost(req)) {
      reply(403, { error: "Invalid bridge host." });
      return;
    }
    const origin = req.headers.origin;
    if (origin && origin !== extensionOrigin) {
      reply(403, { error: "Origin rejected." });
      return;
    }
    if (origin === extensionOrigin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization,Content-Type",
      );
      res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(origin === extensionOrigin ? 204 : 403);
      res.end();
      return;
    }
    const credential = (req.headers.authorization ?? "").replace(
      /^Bearer /,
      "",
    );
    if (req.url === "/pair") {
      if (
        req.method !== "POST" ||
        origin !== extensionOrigin ||
        !equal(credential, extensionToken)
      ) {
        reply(401, { error: "Pairing rejected." });
        return;
      }
      reply(200, { bridgeId });
      return;
    }
    if (origin || !equal(credential, agentToken)) {
      reply(401, { error: "Agent authentication required." });
      return;
    }
    const controllerId = req.headers["x-smo-controller"];
    if (
      typeof controllerId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(controllerId)
    ) {
      reply(400, { error: "Invalid controller identity." });
      return;
    }
    if (req.method === "POST" && req.url === "/disconnect") {
      if (clients.delete(controllerId))
        send({
          type: "controller_disconnected",
          controllerId,
          bridgeId,
          connectionId,
        });
      for (const [id, p] of pending)
        if (p.controllerId === controllerId) cancel(id);
      if (!clients.size) idleSince = Date.now();
      reply(200, { ok: true });
      return;
    }
    if (req.method === "POST" && req.url === "/heartbeat") {
      touch(controllerId);
      reply(200, { ok: true, bridgeId, connected: !!peer });
      return;
    }
    if (req.method !== "POST" || req.url !== "/command") {
      reply(404, { error: "Not found." });
      return;
    }
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 140000)
          throw new Error("Request too large.");
      }
      const command = checkedExternalCommand(JSON.parse(body));
      if (!peer || peer.readyState !== WebSocket.OPEN) {
        reply(200, {
          status: "disconnected",
          message: "Pair the extension and keep Chrome running.",
        });
        return;
      }
      if (pending.size >= 16) {
        reply(409, { error: "Bridge busy." });
        return;
      }
      touch(controllerId);
      const id = randomUUID();
      res.on("close", () => {
        if (!res.writableEnded) cancel(id);
      });
      const result = await new Promise<ExternalResult>((resolve) => {
        const timer = setTimeout(() => cancel(id), options.timeoutMs ?? 20000);
        pending.set(id, {
          controllerId,
          resolve,
          timer,
          runId: "runId" in command ? command.runId : undefined,
        });
        send({
          type: "command",
          id,
          controllerId,
          bridgeId,
          connectionId,
          command,
        });
      });
      reply(200, result);
    } catch {
      reply(400, { error: "Invalid skill-bound command." });
    }
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 140000 });
  const leaseMs = options.leaseMs ?? 30000;
  const leases = setInterval(
    () => {
      for (const [controllerId, at] of clients) {
        if (Date.now() - at > leaseMs) {
          clients.delete(controllerId);
          if (!clients.size) idleSince = Date.now();
          send({
            type: "controller_disconnected",
            controllerId,
            bridgeId,
            connectionId,
          });
          for (const [id, p] of pending)
            if (p.controllerId === controllerId) cancel(id);
        }
      }
      if (
        !clients.size &&
        options.onIdle &&
        Date.now() - idleSince >= (options.idleMs ?? 30000)
      )
        options.onIdle();
    },
    Math.min(
      5000,
      Math.max(10, leaseMs / 2),
      Math.max(10, (options.idleMs ?? 30000) / 2),
    ),
  );
  leases.unref();
  server.on("upgrade", (req, socket, head) => {
    if (
      !validHost(req) ||
      req.headers.origin !== extensionOrigin ||
      req.url !== "/extension"
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => {
      let authenticated = false;
      const deadline = setTimeout(
        () => ws.close(1008, "Authenticate first"),
        3000,
      );
      let lastHeartbeat = Date.now();
      const watchdog = setInterval(() => {
        if (Date.now() - lastHeartbeat > 45000) ws.terminate();
      }, 15000);
      ws.on("message", (data) => {
        try {
          const value = JSON.parse(data.toString());
          if (!authenticated) {
            if (
              value.type !== "hello" ||
              value.bridgeId !== bridgeId ||
              typeof value.token !== "string" ||
              !equal(value.token, extensionToken) ||
              typeof value.instanceId !== "string" ||
              !/^[a-f0-9-]{36}$/.test(value.instanceId) ||
              (instanceId && instanceId !== value.instanceId) ||
              (peer && peer.readyState === WebSocket.OPEN)
            )
              throw new Error();
            authenticated = true;
            clearTimeout(deadline);
            instanceId = value.instanceId;
            connectionId = randomUUID();
            peer = ws;
            ws.send(
              JSON.stringify({ type: "connected", bridgeId, connectionId }),
            );
            return;
          }
          if (ws !== peer) throw new Error();
          if (value.type === "heartbeat") {
            lastHeartbeat = Date.now();
            ws.send(JSON.stringify({ type: "heartbeat" }));
            return;
          }
          if (
            value.type !== "result" ||
            typeof value.id !== "string" ||
            !value.result ||
            typeof value.result.status !== "string"
          )
            throw new Error();
          const p = pending.get(value.id);
          if (!p) return;
          pending.delete(value.id);
          clearTimeout(p.timer);
          p.resolve(value.result);
        } catch {
          ws.close(1008, "Invalid bridge message");
        }
      });
      ws.on("close", () => {
        clearTimeout(deadline);
        clearInterval(watchdog);
        if (peer === ws) disconnect();
      });
      ws.on("error", () => {});
    });
  });
  return {
    bridgeId,
    extensionToken,
    agentToken,
    async listen() {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          port = (server.address() as { port: number }).port;
          resolve();
        });
      });
      return port;
    },
    async close() {
      clearInterval(leases);
      for (const ws of sockets.clients) ws.terminate();
      disconnect();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      sockets.close();
    },
  };
}
