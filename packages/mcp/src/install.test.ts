import test from "node:test";
import assert from "node:assert/strict";
import { registerCodex, registrationArgs } from "./install.ts";

test("one-time registration only adds the MCP integration and passes paths as distinct arguments", async () => {
  const server = "C:/A folder & other/connector/server.mjs";
  const seen: unknown[] = [];
  await registerCodex(server, {
    executable: "fake-codex",
    run: async (exe, args) => {
      seen.push(exe, args);
    },
  });
  assert.deepEqual(seen, [
    "fake-codex",
    registrationArgs(process.execPath, server),
  ]);
  assert.equal((seen[1] as string[]).includes("exec"), false);
  assert.deepEqual(registrationArgs("node", server), [
    "mcp",
    "add",
    "show_me_once",
    "--",
    "node",
    server,
  ]);
});
test("registration failure is reported without inventing an active connection", async () => {
  await assert.rejects(
    registerCodex("server.mjs", {
      run: async () => {
        throw new Error("not installed");
      },
    }),
    /not installed/,
  );
});
