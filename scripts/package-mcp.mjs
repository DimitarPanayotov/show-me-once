import { mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { withMcpInstructions } from "../packages/shared/src/mcp.ts";
const require = createRequire(
  new URL("../apps/extension/package.json", import.meta.url),
);
const { zipSync, strToU8 } = require("fflate");
await mkdir("dist/mcp", { recursive: true });
const markdown = withMcpInstructions(
  await readFile("examples/wikipedia-search/SKILL.md", "utf8"),
);
const setup = await readFile("docs/mcp.md", "utf8");
await writeFile(
  "dist/mcp/wikipedia-search-agent-skill.zip",
  zipSync({
    ".agents/skills/wikipedia-search/SKILL.md": strToU8(markdown),
    "INSTALL.md": strToU8(setup),
  }),
);
await copyFile("docs/mcp.md", "dist/mcp/SETUP.md");
await writeFile(
  "dist/mcp/codex-config.example.toml",
  `# Run setup.mjs with your extension ID once, then pair in the extension.\n# The agent starts/manages the connector automatically. No bridge terminal.\n# Merge into the trusted workspace's .codex/config.toml or your user config.\n# Replace this absolute path with the extracted MCP bundle path.\n[mcp_servers.show_me_once]\ncommand = "node"\nargs = ["C:/absolute/path/to/mcp/server.mjs"]\nstartup_timeout_sec = 10\ntool_timeout_sec = 30\n`,
);
