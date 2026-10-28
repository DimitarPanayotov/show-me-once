import { rolldown } from "rolldown";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
const bundle = await rolldown({
  input: new URL("./agent-api.test.ts", import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    "$1",
  ),
  platform: "node",
  plugins: [
    {
      name: "no-database-for-agent-contract",
      resolveId(id, importer) {
        if (
          importer?.replaceAll("\\", "/").endsWith("/server/router.ts") &&
          ["./auth", "./db"].includes(id)
        )
          return "\0" + id;
      },
      load(id) {
        if (id === "\0./db")
          return 'export function db(){if(globalThis.__skillMetadataDb)return globalThis.__skillMetadataDb;throw new Error("Agent requests must not access the database.")}';
        if (id === "\0./auth")
          return "export const loginAccount=()=>{},registerAccount=()=>{},revokeSession=()=>{};";
      },
    },
  ],
});
const output = await bundle.generate({ format: "cjs" });
await bundle.close();
const folder = await mkdtemp(join(tmpdir(), "smo-api-test-")),
  file = join(folder, "agent.test.cjs");
try {
  await writeFile(file, output.output.find((x) => x.type === "chunk").code);
  const child = spawn(process.execPath, ["--test", file], {
    stdio: "inherit",
    windowsHide: true,
  });
  process.exitCode = await new Promise((resolve) => child.on("close", resolve));
} finally {
  await unlink(file);
  await rmdir(folder);
}
