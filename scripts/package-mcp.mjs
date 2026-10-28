import { mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { withMcpInstructions } from "../packages/shared/src/mcp.ts";
import { exampleDraft } from "../apps/extension/lib/example-skill.ts";
const require = createRequire(
  new URL("../apps/extension/package.json", import.meta.url),
);
const { zipSync, strToU8 } = require("fflate");
await mkdir("dist/mcp", { recursive: true });
const markdown = withMcpInstructions(exampleDraft.markdown);
const setup = await readFile("docs/mcp.md", "utf8");
await writeFile(
  "dist/mcp/github-issue-triage-agent-skill.zip",
  zipSync({
    ".agents/skills/github-issue-triage/SKILL.md": strToU8(markdown),
    "INSTALL.md": strToU8(setup),
  }),
);
await copyFile("docs/mcp.md", "dist/mcp/SETUP.md");
await writeFile(
  "dist/mcp/Connect with Codex.cmd",
  '@echo off\r\nwhere node >nul 2>&1\r\nif errorlevel 1 (\r\n echo Install Node.js 24, then open this setup again.\r\n pause\r\n exit /b 1\r\n)\r\nnode "%~dp0setup.mjs"\r\npause\r\n',
);
await writeFile(
  "dist/mcp/connect.sh",
  '#!/bin/sh\ncd -- "$(dirname -- "$0")" || exit 1\nnode setup.mjs\n',
);
await writeFile(
  "dist/mcp/codex-config.example.toml",
  `# Run setup.mjs with your extension ID once, then pair in the extension.\n# The agent starts/manages the connector automatically. No bridge terminal.\n# Merge into the trusted workspace's .codex/config.toml or your user config.\n# Replace this absolute path with the extracted MCP bundle path.\n[mcp_servers.show_me_once]\ncommand = "node"\nargs = ["C:/absolute/path/to/mcp/server.mjs"]\nstartup_timeout_sec = 10\ntool_timeout_sec = 30\n`,
);
