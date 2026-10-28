import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setupConnection } from "./managed.ts";
import { createInterface } from "node:readline/promises";
import { registerCodex } from "./install.ts";

try {
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("Install Node.js 24, then reopen this setup.");
  const interactive = !process.argv[2];
  const terminal = interactive
    ? createInterface({ input: process.stdin, output: process.stdout })
    : undefined;
  let extensionId = process.argv[2] ?? "",
    automatic = process.argv.includes("--codex");
  try {
    if (terminal) {
      console.log(
        "Show Me Once — connect once. No helper window is needed during normal use.\n",
      );
      extensionId = (
        await terminal.question(
          "Paste the extension ID (Copy ID in the extension): ",
        )
      ).trim();
      automatic =
        (
          await terminal.question(
            "Your coding agent: 1 = Codex (automatic setup), 2 = other/manual [1]: ",
          )
        ).trim() !== "2";
    }
  } finally {
    terminal?.close();
  }
  const settings = await setupConnection(extensionId);
  const server = join(
    dirname(fileURLToPath(import.meta.url)),
    "server.mjs",
  ).replaceAll("\\", "/");
  let registered = false;
  if (automatic) {
    try {
      await registerCodex(server);
      registered = true;
    } catch {
      console.log(
        "Could not register automatically. Finish using the manual configuration below.\n",
      );
    }
  }
  const next = registered
    ? "✓ Registered with Codex. Restart/reconnect Codex now."
    : `Configure a local stdio MCP server named show_me_once:\nCommand: ${process.execPath}\nArgument: ${server}\n\nFor Codex, you can run:\ncodex mcp add show_me_once -- node "${server}"\nThen restart/reconnect your agent.`;
  console.log(
    `\n${next}\n\nOpen the extension → Connect your coding agent.\nPaste this private pairing code once:\n\n${settings.extensionToken}\n\nWhen the extension says Connected, close this setup window.\nYour agent manages the connection automatically. No helper terminal is needed.\nKeep this code out of chat and Git.\n`,
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Connection setup failed.",
  );
  process.exitCode = 1;
}
