import {
  mkdir,
  readFile,
  writeFile,
  copyFile,
  readdir,
  stat,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, delimiter } from "node:path";
import { spawn } from "node:child_process";

export const NATIVE_HOST = "com.show_me_once.agent";
export async function findCodex() {
  const names =
    process.platform === "win32" ? ["codex.exe", "codex.cmd"] : ["codex"];
  for (const folder of (process.env.PATH ?? "").split(delimiter))
    for (const name of names) {
      const path = join(folder, name);
      if ((await stat(path).catch(() => undefined))?.isFile())
        return resolve(path);
    }
  const bin = join(
    process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
    "OpenAI",
    "Codex",
    "bin",
  );
  const candidates: { path: string; modified: number }[] = [];
  for (const entry of await readdir(bin, { withFileTypes: true }).catch(
    () => [],
  )) {
    if (!entry.isDirectory()) continue;
    const path = join(bin, entry.name, "codex.exe"),
      info = await stat(path).catch(() => undefined);
    if (info?.isFile()) candidates.push({ path, modified: info.mtimeMs });
  }
  candidates.sort((a, b) => b.modified - a.modified);
  if (!candidates[0])
    throw new Error(
      "Install Codex CLI or the Codex desktop app, sign in with ChatGPT, then run this setup again. A native codex executable must be available.",
    );
  return candidates[0].path;
}

export async function installNative(
  extensionId: string,
  source: string,
  options: {
    home?: string;
    platform?: string;
    executable?: string;
    node?: string;
    register?: (manifest: string) => Promise<void>;
  } = {},
) {
  if (!/^[a-p]{32}$/.test(extensionId))
    throw new Error("Copy the 32-character extension ID from Show Me Once.");
  const platform = options.platform ?? process.platform;
  const home = resolve(options.home ?? homedir()),
    folder = join(home, ".show-me-once", "native"),
    settings = join(folder, "native-settings.json");
  const previous = await readFile(settings, "utf8")
    .then(JSON.parse)
    .catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
  if (previous && previous.extensionId !== extensionId)
    throw new Error(
      "Another extension is already configured. Uninstall that helper explicitly before replacing its access.",
    );
  const executable = options.executable ?? (await findCodex());
  const node = options.node ?? process.execPath;
  if ([node, executable, folder].some((x) => /[\r\n\0]/.test(x)))
    throw new Error("Unsupported installation path.");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await copyFile(source, join(folder, "host.mjs"));
  await writeFile(settings, JSON.stringify({ extensionId, executable }), {
    mode: 0o600,
  });
  const launcher = join(folder, platform === "win32" ? "host.cmd" : "host.sh");
  const batch = (x: string) => x.replaceAll("%", "%%");
  const shell = (x: string) => "'" + x.replaceAll("'", "'\\''") + "'";
  await writeFile(
    launcher,
    platform === "win32"
      ? `@echo off\r\n"${batch(node)}" "${batch(join(folder, "host.mjs"))}" "%~1"\r\n`
      : `#!/bin/sh\nexec ${shell(node)} ${shell(join(folder, "host.mjs"))} "$1"\n`,
    { mode: 0o700 },
  );
  const manifest =
    platform === "win32"
      ? join(folder, `${NATIVE_HOST}.json`)
      : join(
          home,
          platform === "darwin"
            ? "Library/Application Support/Google/Chrome/NativeMessagingHosts"
            : ".config/google-chrome/NativeMessagingHosts",
          `${NATIVE_HOST}.json`,
        );
  await mkdir(resolve(manifest, ".."), { recursive: true });
  await writeFile(
    manifest,
    JSON.stringify({
      name: NATIVE_HOST,
      description: "Show Me Once subscription agent",
      path: launcher,
      type: "stdio",
      allowed_origins: [`chrome-extension://${extensionId}/`],
    }),
    { mode: 0o600 },
  );
  if (platform === "win32") {
    const register =
      options.register ??
      ((file: string) =>
        new Promise<void>((resolve, reject) => {
          const child = spawn(
            "reg.exe",
            [
              "ADD",
              `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST}`,
              "/ve",
              "/t",
              "REG_SZ",
              "/d",
              file,
              "/f",
            ],
            { windowsHide: true, stdio: "ignore" },
          );
          child.on("error", reject);
          child.on("close", (code) =>
            code === 0
              ? resolve()
              : reject(
                  new Error("Could not register the per-user Chrome helper."),
                ),
          );
        }));
    await register(manifest);
  }
  return { folder, manifest, launcher };
}
