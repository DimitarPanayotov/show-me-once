import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
// Windows desktop installs bundle a native CLI even when Explorer's PATH lacks it.
if (process.platform === "win32" && !process.env.SMO_CODEX_EXE) {
  const bin = join(
    process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
    "OpenAI",
    "Codex",
    "bin",
  );
  const candidates = [];
  for (const entry of await readdir(bin, { withFileTypes: true }).catch(
    () => [],
  )) {
    if (!entry.isDirectory()) continue;
    const file = join(bin, entry.name, "codex.exe");
    const info = await stat(file).catch(() => null);
    if (info?.isFile()) candidates.push({ file, modified: info.mtimeMs });
  }
  candidates.sort((a, b) => b.modified - a.modified);
  if (candidates[0]) process.env.SMO_CODEX_EXE = candidates[0].file;
}
const terminal = createInterface({ input: stdin, output: stdout });
try {
  if (!process.env.SMO_EXTENSION_ORIGIN) {
    const id = (
      await terminal.question(
        "Paste the 32-character Show Me Once extension ID from chrome://extensions: ",
      )
    ).trim();
    if (!/^[a-p]{32}$/.test(id))
      throw new Error(
        "Invalid extension ID. Use the ID on the Show Me Once extension card.",
      );
    process.env.SMO_EXTENSION_ORIGIN = `chrome-extension://${id}`;
  }
} finally {
  terminal.close();
}
await import("./bridge.mjs");
