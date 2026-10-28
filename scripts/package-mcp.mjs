import { mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { withMcpInstructions } from "../packages/shared/src/mcp.ts";
import { exampleDraft } from "../apps/extension/lib/example-skill.ts";
const require = createRequire(
  new URL("../apps/extension/package.json", import.meta.url),
);
const { zipSync, strToU8 } = require("fflate");
const mcpRequire = createRequire(new URL('../packages/mcp/package.json', import.meta.url));
const spawn = mcpRequire('cross-spawn');
const { version } = JSON.parse(await readFile('packages/mcp/package.json', 'utf8'));
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
  '@echo off\r\nwhere node >nul 2>&1\r\nif errorlevel 1 (\r\n echo Install Node.js 24, then open this setup again.\r\n pause\r\n exit /b 1\r\n)\r\nnode "%~dp0setup.mjs" --agent=codex\r\npause\r\n',
);
await writeFile(
  "dist/mcp/connect.sh",
  '#!/bin/sh\ncd -- "$(dirname -- "$0")" || exit 1\nnode setup.mjs\n',
);
await writeFile(
  "dist/mcp/codex-config.example.toml",
  `# Optional offline setup. Online users choose their agent in the extension.\n# On first use compare the code in your agent and extension, then Allow.\n[mcp_servers.show_me_once]\ncommand = "node"\nargs = ["C:/absolute/path/to/mcp/server.mjs"]\nstartup_timeout_sec = 10\ntool_timeout_sec = 30\n`,
);

// A self-contained, versioned package can be launched by npx from our existing app.
// No npm account, global installation, extracted-folder path or model credentials.
const folder = resolve('dist/mcp-package');
const destination = resolve('apps/web/public/downloads');
await mkdir(folder, { recursive: true }); await mkdir(destination, { recursive: true });
for (const file of ['server.mjs', 'relay.mjs']) await copyFile(`dist/mcp/${file}`, `${folder}/${file}`);
await writeFile(`${folder}/server.mjs`, '#!/usr/bin/env node\n' + await readFile(`${folder}/server.mjs`, 'utf8'));
await writeFile(`${folder}/package.json`, JSON.stringify({ name: 'show-me-once-mcp', version, private: true,
  description: 'Guarded browser skills through the Show Me Once extension', type: 'module',
  bin: { 'show-me-once-mcp': 'server.mjs' }, files: ['server.mjs', 'relay.mjs'], engines: { node: '>=24' } }, null, 2));
const packed = spawn.sync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', destination], {
  cwd: folder, encoding: 'utf8', windowsHide: true, env: { ...process.env, npm_config_cache: resolve('dist/npm-cache') },
});
if (packed.status !== 0) throw new Error('Could not package the MCP download: ' + packed.stderr);
const archive = `show-me-once-mcp-${version}.tgz`;
const digest = createHash('sha256').update(await readFile(`${destination}/${archive}`)).digest('hex');
await writeFile(`${destination}/${archive}.sha256`, `${digest}  ${archive}\n`);
console.log(`Versioned MCP download: ${archive} (sha256 ${digest})`);
