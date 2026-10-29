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
    "Build the extension with WXT_API_BASE_URL=https://show-me-once-dimitar.vercel.app first.",
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
  "host.mjs",
  "setup.mjs",
  "Install subscription helper.cmd",
  "SETUP.md",
])
  files[`subscription-helper/${name}`] = new Uint8Array(
    await readFile(`dist/subscription-helper/${name}`),
  );
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
files["README.txt"] = strToU8(
  `Show Me Once ${version}\n\nRecord a browser task once, then run it with new inputs.\n\n1. Open chrome://extensions, enable Developer mode and Load unpacked. Choose this bundle's extension folder.\n2. Open Show Me Once and sign into the library.\n3. Under Agent settings, add your own OpenAI/Anthropic API key or set up a Codex subscription.\n4. Record a task, save its skill, enter a new request and click Run. Approve protected actions when prompted; Pause and Stop are always available.\n\nCodex subscription setup requires Node.js 24 and Codex signed in with ChatGPT. Open subscription-helper/Install subscription helper.cmd once on Windows, or run node setup.mjs in that folder. Chrome starts the helper automatically afterwards. See subscription-helper/SETUP.md.\n\nOptional MCP integration connects an existing coding agent. Choose your client in the extension, use the supplied setup link/command and approve matching connection codes. The connector folder provides offline setup; see connector/SETUP.md.\n\nApp: https://show-me-once-dimitar.vercel.app\nSource: https://github.com/DimitarPanayotov/show-me-once\n`,
);
const path = `dist/show-me-once-reviewer-kit-${version}.zip`;
await writeFile(path, zipSync(files));
console.log(
  `Release bundle: ${path} (${Object.keys(files).length} files; no credentials included)`,
);
