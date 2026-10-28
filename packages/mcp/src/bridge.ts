import { createServer, type IncomingMessage } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import {
  checkedExternalCommand,
  type ExternalResult,
} from "@show-me-once/shared/mcp";
import { nonceCommitment, pairingCode, type PairingProof } from '@show-me-once/shared/pairing';
import type { BrowserBinding, ConnectorIdentity } from './pairing.ts';

const equal = (a: string, b: string) => {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
export function createBridge(
  extensionOrigin: string | undefined,
  options: {
    port?: number;
    extensionToken?: string;
    agentToken?: string;
    timeoutMs?: number;
    leaseMs?: number;
    idleMs?: number;
    onIdle?: () => void;
    identity?: ConnectorIdentity;
    bindings?: BrowserBinding[];
    saveBindings?: (bindings: BrowserBinding[]) => Promise<void>;
  } = {},
) {
  if ((extensionOrigin && !/^chrome-extension:\/\/[a-p]{32}$/.test(extensionOrigin)) || (!extensionOrigin && !options.identity))
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
  let bindings = options.bindings ?? [];
  let savingBinding: Promise<unknown> = Promise.resolve();
  const pairingRequests = new Map<string, { code?: string; expiresAt: number }>();
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
    if (origin && (!extensionOrigin || origin !== extensionOrigin)) {
      reply(403, { error: "Origin rejected." });
      return;
    }
    if (origin && origin === extensionOrigin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization,Content-Type",
      );
      res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(origin && origin === extensionOrigin ? 204 : 403);
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
      reply(200, { ok: true, bridgeId, connected: !!peer, protocolVersion: 2 });
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
      // First discovery can arrive just before the open popup's automatic retry.
      // Give that handshake a short window; no browser command is dispatched.
      if (options.identity && (command.kind === 'list_skills' || command.kind === 'get_skill')) {
        const until = Date.now() + 2500;
        while (!peer && ![...pairingRequests.values()].some(p => p.code && p.expiresAt > Date.now()) && Date.now() < until && !res.destroyed)
          await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!peer || peer.readyState !== WebSocket.OPEN) {
        const requests = [...pairingRequests.values()].filter(p => p.code && p.expiresAt > Date.now());
        reply(200, {
          status: requests.length ? "needs_approval" : "disconnected",
          ...(requests.length ? { pairingCodes: requests.map(p => p.code) } : {}),
          message: requests.length
            ? `Connection approval needed. Ask the user to open Show Me Once, compare its six-digit code with ${requests.map(p => p.code).join(' or ')}, then click Allow connection. Do not approve for them. After approval, retry this discovery call.`
            : "Open Show Me Once → External coding agent → Connect, then approve the connection there. The connector is already running; no helper terminal is needed.",
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
    const origin = req.headers.origin;
    if (
      !validHost(req) ||
      !(origin && (origin === extensionOrigin || (options.identity && /^chrome-extension:\/\/[a-p]{32}$/.test(origin)))) ||
      sockets.clients.size >= 8 ||
      req.url !== "/extension"
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => {
      let authenticated = false;
      let deadline = setTimeout(
        () => ws.close(1008, "Authenticate first"),
        3000,
      );
      let lastHeartbeat = Date.now();
      let proof: PairingProof | undefined;
      let serverNonce: string | undefined;
      let expiry = 0;
      let challengeComplete = false;
      const connected = () => {
        if ((peer && peer.readyState === WebSocket.OPEN) || (instanceId && instanceId !== proof!.instanceId)) throw new Error();
        authenticated = true; clearTimeout(deadline);
        pairingRequests.delete(proof!.pairingId);
        instanceId = proof!.instanceId; connectionId = randomUUID(); peer = ws;
        ws.send(JSON.stringify({ type: 'connected', bridgeId, connectionId }));
      };
      const watchdog = setInterval(() => {
        if (authenticated && Date.now() - lastHeartbeat > 45000) ws.terminate();
      }, 15000);
      let processing = Promise.resolve();
      ws.on("message", (data) => { processing = processing.then(async () => {
        try {
          const value = JSON.parse(data.toString());
          if (!authenticated) {
            if (options.identity && value.type === 'pairing-start' && !proof) {
              if (!/^[a-f0-9-]{36}$/.test(value.instanceId) || (instanceId && instanceId !== value.instanceId)) throw new Error();
              serverNonce = randomBytes(32).toString('base64url');
              proof = { pairingId: randomUUID(), bridgeId, origin: origin!, instanceId: value.instanceId,
                publicKey: options.identity.publicKey, serverNonce, clientNonce: '' };
              expiry = Date.now() + 120000;
              clearTimeout(deadline);
              deadline = setTimeout(() => ws.close(1008, 'Approval expired'), 120000);
              pairingRequests.set(proof.pairingId, { expiresAt: expiry });
              ws.send(JSON.stringify({ type: 'pairing-offer', pairingId: proof.pairingId, bridgeId,
                publicKey: proof.publicKey, commitment: await nonceCommitment(serverNonce), expiresAt: expiry }));
              return;
            }
            if (proof && options.identity) {
              if (value.pairingId !== proof.pairingId || Date.now() >= expiry) throw new Error();
              if (value.type === 'pairing-challenge' && !challengeComplete) {
                if (typeof value.clientNonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.clientNonce)) throw new Error();
                proof.clientNonce = value.clientNonce;
                challengeComplete = true;
                pairingRequests.set(proof.pairingId, { code: await pairingCode(proof), expiresAt: expiry });
                ws.send(JSON.stringify({ type: 'pairing-proof', serverNonce, signature: options.identity.sign(proof) }));
                return;
              }
              if (!challengeComplete) throw new Error();
              if (value.type === 'pairing-wait') {
                ws.send(JSON.stringify({ type: 'heartbeat' })); return;
              }
              if (value.type === 'resume') {
                if (!bindings.some(b => b.origin === origin && b.instanceId === proof!.instanceId && typeof value.token === 'string' && equal(b.token, value.token))) throw new Error();
                connected(); return;
              }
              if (value.type === 'approve') {
                if ((peer && peer.readyState === WebSocket.OPEN) || (instanceId && instanceId !== proof.instanceId)) throw new Error();
                const binding = { origin: origin!, instanceId: proof.instanceId, token: randomBytes(32).toString('base64url') };
                const save = savingBinding.then(async () => {
                  const next = [...bindings.filter(b => b.instanceId !== binding.instanceId), binding];
                  if (next.length > 20) throw new Error();
                  await options.saveBindings?.(next); bindings = next;
                });
                savingBinding = save.catch(() => {}); await save;
                if (ws.readyState !== WebSocket.OPEN || Date.now() >= expiry) throw new Error();
                ws.send(JSON.stringify({ type: 'paired', pairingId: proof.pairingId, token: binding.token }));
                connected(); return;
              }
              throw new Error();
            }
            if (
              origin !== extensionOrigin ||
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
          if (value.type === 'forget' && proof) {
            const save = savingBinding.then(async () => {
              const next = bindings.filter(b => !(b.origin === origin && b.instanceId === proof!.instanceId));
              await options.saveBindings?.(next); bindings = next;
            });
            savingBinding = save.catch(() => {}); await save;
            instanceId = undefined;
            ws.send(JSON.stringify({ type: 'forgotten' })); ws.close(); return;
          }
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
      }); });
      ws.on("close", () => {
        if (proof) pairingRequests.delete(proof.pairingId);
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
