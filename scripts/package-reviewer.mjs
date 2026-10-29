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
  `Show Me Once ${version}\n\nLoad the extension folder at chrome://extensions, then open Show Me Once and sign into the library.\nRecord -> review SKILL.md -> save -> type a new request -> Run inside the extension. Safe steps continue automatically; approve protected actions or Stop at any time.\n\nUnder Agent settings, choose your own OpenAI/Anthropic API key or a Codex subscription on this computer. Keys stay only in the Chrome session and are forwarded transiently through the app backend.\nFor a subscription, you need Node.js 24 and Codex signed in with ChatGPT. Open subscription-helper/Install subscription helper.cmd once, paste the extension ID, then Check subscription in the extension. Chrome starts the helper automatically; close the installer. No bridge terminal or external chat is required during normal use. See subscription-helper/SETUP.md.\n\nTry GitHub issue triage for a twelve-step example, then record your own task. Saving, versions, sharing and extension-led run history use the web library.\nFor External coding agent (optional), choose your tool in the extension and use its install link or one-time registration command. Compare the six-digit codes and Allow connection. No extension ID, pairing secret or helper terminal is needed for MCP. The connector folder is an offline fallback. It is independent of Run. After pairing, ask your agent to run a skill: Chrome and a dedicated task tab open automatically. No manual tab selection. Unsaved edits to another library skill are kept on this device and do not block the MCP example. Reopen the skill in its original account to continue editing. Extension 0.8.1 uses connector 0.8.0 without re-registration. Upgrade older registrations to connector 0.8.0 once, then restart the agent.\nReal Chrome acceptance is still required before claiming the demo is verified.\n`,
);
const path = `dist/show-me-once-reviewer-kit-${version}.zip`;
await writeFile(path, zipSync(files));
console.log(
  `Reviewer kit: ${path} (${Object.keys(files).length} files; no credentials included)`,
);
