import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { registerCodex } from "./install.ts";
import spawn from "cross-spawn";

try {
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Install Node.js 24, then reopen this setup.");
  const server = join(dirname(fileURLToPath(import.meta.url)), "server.mjs").replaceAll("\\", "/");
  let agent = process.argv.find(a => a.startsWith("--agent="))?.slice(8);
  if (!agent) {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
      console.log("Show Me Once — connect once. No extension ID or pairing secret is needed.");
      const choice = (await terminal.question("Agent: 1 = Codex, 2 = Claude Code, 3 = other/manual [1]: ")).trim();
      agent = choice === "2" ? "claude-code" : choice === "3" ? "other" : "codex";
    } finally { terminal.close(); }
  }
  if (agent === "codex") await registerCodex(server);
  else if (agent === "claude-code") await new Promise<void>((resolve, reject) => {
    const child = spawn("claude", ["mcp", "add", "--scope", "user", "--transport", "stdio", "show_me_once", "--", process.execPath, server], { stdio: "ignore", windowsHide: true });
    child.on("error", reject); child.on("close", code => code === 0 ? resolve() : reject(new Error("Claude Code registration failed.")));
  });
  else if (agent === "other") console.log(JSON.stringify({ mcpServers: { show_me_once: { command: process.execPath, args: [server] } } }, null, 2));
  else throw new Error("Choose codex, claude-code or other.");
  console.log("Added Show Me Once. Reconnect your agent and ask it to list your skills. Open the extension, compare the six-digit code and click Allow connection once. The agent starts the connector automatically.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Connection setup failed."); process.exitCode = 1;
}
