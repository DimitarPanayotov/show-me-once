import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../apps/extension/package.json", import.meta.url),
);
const { zipSync, strToU8 } = require("fflate");
const { version } = JSON.parse(
  await readFile("apps/extension/package.json", "utf8"),
);
const root = "apps/extension/.output/chrome-mv3";
const manifest = JSON.parse(
  await readFile(join(root, "manifest.json"), "utf8"),
);
if (
  !manifest.host_permissions.includes(
    "https://show-me-once-dimitar.vercel.app/*",
  )
)
  throw new Error(
    "Build the reviewer extension with WXT_API_BASE_URL=https://show-me-once-dimitar.vercel.app first.",
  );
const files = {};
async function collect(folder, prefix) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = join(folder, entry.name),
      name = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await collect(file, name);
    else if (entry.isFile()) files[name] = new Uint8Array(await readFile(file));
  }
}
await collect(root, "extension");
for (const name of [
  "server.mjs",
  "relay.mjs",
  "setup.mjs",
  "Connect with Codex.cmd",
  "connect.sh",
  "SETUP.md",
  "codex-config.example.toml",
])
  files[`connector/${name}`] = new Uint8Array(
    await readFile(`dist/mcp/${name}`),
  );
files["START-HERE.html"] = new Uint8Array(
  await readFile("apps/extension/public/setup.html"),
);
files["README.txt"] = strToU8(
  `Show Me Once ${version}\n\nOpen START-HERE.html for the short setup and first test.\n\nYou need Chrome, Node.js 24 and a local MCP-capable coding agent (Codex is the configured example).\nLoad the extension folder, run the connector's one-time setup, restart the agent and pair once.\nNo API key, library account or separate helper terminal is required for the example or local recordings.\nThe agent discovers skills directly; exporting/installing a skill file is optional.\n\nCloud saving, versions and sharing are available through the library account.\nManual real-agent/Chrome acceptance is still required before claiming the demo is verified.\n`,
);
const path = `dist/show-me-once-reviewer-kit-${version}.zip`;
await writeFile(path, zipSync(files));
console.log(
  `Reviewer kit: ${path} (${Object.keys(files).length} files; no credentials included)`,
);
