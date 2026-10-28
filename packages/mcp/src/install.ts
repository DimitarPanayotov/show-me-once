import spawn from "cross-spawn";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export function registrationArgs(node: string, server: string) {
  return ["mcp", "add", "show_me_once", "--", node, server];
}
export async function registerCodex(
  server: string,
  options: {
    executable?: string;
    run?: (executable: string, args: string[]) => Promise<void>;
  } = {},
) {
  const run =
    options.run ??
    ((executable: string, args: string[]) =>
      new Promise<void>((resolve, reject) => {
        // cross-spawn safely handles npm's Windows .cmd shim as well as native executables.
        const child = spawn(executable, args, {
          windowsHide: true,
          stdio: "ignore",
        });
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0
            ? resolve()
            : reject(new Error("Codex registration failed.")),
        );
      }));
  const executable = options.executable ?? process.env.SMO_CODEX_EXE ?? "codex";
  const args = registrationArgs(process.execPath, server);
  try {
    await run(executable, args);
    return;
  } catch (error) {
    if (options.executable || options.run || process.platform !== "win32")
      throw error;
  }
  const bin = join(
    process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
    "OpenAI",
    "Codex",
    "bin",
  );
  const candidates: { file: string; modified: number }[] = [];
  for (const entry of await readdir(bin, { withFileTypes: true }).catch(
    () => [],
  )) {
    if (!entry.isDirectory()) continue;
    const file = join(bin, entry.name, "codex.exe"),
      info = await stat(file).catch(() => undefined);
    if (info?.isFile()) candidates.push({ file, modified: info.mtimeMs });
  }
  candidates.sort((a, b) => b.modified - a.modified);
  if (!candidates[0])
    throw new Error(
      "Codex was not found. Use the manual configuration printed below.",
    );
  await run(candidates[0].file, args);
}
