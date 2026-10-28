import { createBridge } from "./bridge.ts";
import { readSettings } from "./managed.ts";

const settings = await readSettings();
let closing = false;
const bridge = createBridge(`chrome-extension://${settings.extensionId}`, {
  port: Number(process.env.SMO_MCP_PORT ?? 4320),
  extensionToken: settings.extensionToken,
  agentToken: settings.agentToken,
  leaseMs: Number(process.env.SMO_MCP_LEASE_MS ?? 30000),
  idleMs: Number(process.env.SMO_MCP_IDLE_MS ?? 30000),
  onIdle: () => void close(),
});
async function close() {
  if (closing) return;
  closing = true;
  await bridge.close();
}
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
try {
  await bridge.listen();
} catch {
  // Concurrent MCP sessions may race to start it. The existing listener wins.
  await close();
  process.exitCode = 1;
}
