import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setupConnection } from "./managed.ts";

try {
  const settings = await setupConnection(process.argv[2] ?? "");
  const server = join(
    dirname(fileURLToPath(import.meta.url)),
    "server.mjs",
  ).replaceAll("\\", "/");
  console.log(
    `Show Me Once — one-time connection setup\n\n1. Register with Codex (once):\n   codex mcp add show_me_once -- node "${server}"\n   Restart/reconnect your coding agent. It starts the connector automatically.\n\n2. Open the extension → Connect your coding agent.\n   Paste this private pairing code once:\n   ${settings.extensionToken}\n\nAfter pairing, just open your agent and ask it to use a skill.\nNo helper terminal needs to stay open. Keep this pairing code out of chat and Git.`,
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Connection setup failed.",
  );
  process.exitCode = 1;
}
