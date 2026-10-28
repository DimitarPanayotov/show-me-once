import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installNative } from "./native-install.ts";

try {
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("Install Node.js 24, then reopen setup.");
  let id = process.argv[2];
  if (!id) {
    const terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      id = (
        await terminal.question(
          "Copy the extension ID from Show Me Once → Agent settings, and paste it here: ",
        )
      ).trim();
    } finally {
      terminal.close();
    }
  }
  await installNative(
    id,
    join(dirname(fileURLToPath(import.meta.url)), "host.mjs"),
  );
  console.log(
    "Subscription helper installed for this user and extension. Open Show Me Once → Agent settings → Check subscription. Chrome starts the helper automatically when you click Run; close this window. Codex must be signed in with ChatGPT. No pairing code or API key is needed.",
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Installation failed.",
  );
  process.exitCode = 1;
}
