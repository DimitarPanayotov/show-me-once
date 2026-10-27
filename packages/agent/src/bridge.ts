import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { codexSubscriptionProvider } from "./codex.ts";
import { checkedInput } from "./providers.ts";

const origin = process.env.SMO_EXTENSION_ORIGIN;
if (!origin || !/^chrome-extension:\/\/[a-p]{32}$/.test(origin))
  throw new Error(
    "Set SMO_EXTENSION_ORIGIN to the exact chrome-extension://ID shown in the extension account panel.",
  );
const token =
  process.env.SMO_BRIDGE_TOKEN || randomBytes(24).toString("base64url");
const provider = codexSubscriptionProvider(process.env.SMO_CODEX_EXE);
let busy = false;
let completedDecisions = 0;

const server = createServer(async (req, res) => {
  const requestOrigin = req.headers.origin;
  if (requestOrigin && requestOrigin !== origin) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (requestOrigin === origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );
  }
  res.setHeader("Cache-Control", "no-store");
  const send = (status: number, body: object) => {
    if (!res.writableEnded) {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    }
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const supplied = Buffer.from(
    (req.headers.authorization || "").replace(/^Bearer /, ""),
  );
  const expected = Buffer.from(token);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    send(401, {
      error: "Pair the extension with the code shown by the local agent.",
    });
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    send(200, { ready: true, provider: provider!.id, completedDecisions });
    return;
  }
  if (req.method !== "POST" || req.url !== "/decide") {
    send(404, { error: "Not found." });
    return;
  }
  if (busy) {
    send(409, { error: "The local agent is already deciding an action." });
    return;
  }
  busy = true;
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });
  try {
    let body = "";
    for await (const chunk of req) {
      body += chunk.toString();
      if (body.length > 150_000) throw new Error("Agent request is too large.");
    }
    const input = checkedInput(JSON.parse(body));
    busy = true;
    const decision = await provider!.decide(input, abort.signal);
    completedDecisions++;
    send(200, { decision });
  } catch (error) {
    send(400, {
      error: error instanceof Error ? error.message : "Agent request failed.",
    });
  } finally {
    busy = false;
  }
});
server.listen(4319, "127.0.0.1", () => {
  console.log(`Local ${provider.id} agent ready at http://127.0.0.1:4319`);
  if (!process.env.SMO_BRIDGE_TOKEN) console.log(`Pairing code: ${token}`);
  console.log(`Only ${origin} can pair. Stop this process to disconnect.`);
});
