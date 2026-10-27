import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createBridge } from "./bridge.ts";

const extensionId = process.argv[2];
if (!extensionId || !/^[a-p]{32}$/.test(extensionId))
  throw new Error("Usage: node bridge.mjs EXTENSION_ID [CONNECTION_FILE]");
const file =
  process.argv[3] ?? join(homedir(), ".show-me-once", "mcp-connection.json");
const bridge = createBridge(`chrome-extension://${extensionId}`);
await mkdir(dirname(file), { recursive: true, mode: 0o700 });
// Refuse to replace a running bridge's credential file.
await writeFile(
  file,
  JSON.stringify({
    url: "http://127.0.0.1:4320",
    token: bridge.agentToken,
    bridgeId: bridge.bridgeId,
  }),
  { flag: "wx", mode: 0o600 },
);
try {
  await bridge.listen();
} catch (error) {
  await rm(file);
  throw error;
}
console.error(
  `Show Me Once MCP bridge: http://127.0.0.1:4320\nPairing code: ${bridge.extensionToken}\nAgent connection file: ${file}\nKeep this process running. No model process is started.`,
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await bridge.close();
  const value = await readFile(file, "utf8").catch(() => "");
  if (value.includes(bridge.bridgeId)) await rm(file);
  process.exit(0);
}
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
