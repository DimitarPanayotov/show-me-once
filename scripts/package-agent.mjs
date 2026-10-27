import { copyFile, mkdir } from "node:fs/promises";
const target = new URL("../dist/local-agent/", import.meta.url);
await mkdir(target, { recursive: true });
for (const file of [
  "start.mjs",
  "start-local-agent.cmd",
  "start-local-agent.sh",
  "README.txt",
]) {
  await copyFile(
    new URL(`../packages/agent/launcher/${file}`, import.meta.url),
    new URL(file, target),
  );
}
console.log("Standalone local agent helper ready in dist/local-agent.");
