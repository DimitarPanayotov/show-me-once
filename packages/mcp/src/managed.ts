import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

export type ManagedSettings = {
  extensionId?: string;
  extensionToken: string;
  agentToken: string;
};
export const managedHome = () =>
  process.env.SMO_MCP_HOME ?? join(homedir(), ".show-me-once");
const settingsFile = (home: string) => join(home, "mcp-settings.json");

export async function readSettings(
  home = managedHome(),
): Promise<ManagedSettings> {
  let value: ManagedSettings;
  try {
    value = JSON.parse(await readFile(settingsFile(home), "utf8"));
  } catch {
    throw new Error(
      "Show Me Once connection settings are unavailable. Reconnect your agent.",
    );
  }
  if (
    (value.extensionId !== undefined && !/^[a-p]{32}$/.test(value.extensionId)) ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(value.extensionToken) ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(value.agentToken)
  )
    throw new Error(
      "Invalid Show Me Once connection settings. Run setup.mjs again.",
    );
  return value;
}

export async function initializeConnection(home = managedHome()): Promise<ManagedSettings> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  try {
    await writeFile(settingsFile(home), JSON.stringify({
      extensionToken: randomBytes(32).toString('base64url'),
      agentToken: randomBytes(32).toString('base64url'),
    }), { flag: 'wx', mode: 0o600 });
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  // Another MCP process may have just created the file but not finished its write.
  for (let attempt = 0; ; attempt++) {
    try { return await readSettings(home); }
    catch (error) {
      if (attempt >= 9) throw error;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
}

// Idempotent setup: restarting an agent must not rotate the browser credential.
export async function setupConnection(
  extensionId: string,
  home = managedHome(),
) {
  if (!/^[a-p]{32}$/.test(extensionId))
    throw new Error(
      "Copy the 32-character extension ID from chrome://extensions.",
    );
  await mkdir(home, { recursive: true, mode: 0o700 });
  const value: ManagedSettings = {
    extensionId,
    extensionToken: randomBytes(32).toString("base64url"),
    agentToken: randomBytes(32).toString("base64url"),
  };
  try {
    await writeFile(settingsFile(home), JSON.stringify(value), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const saved = await readSettings(home);
  if (saved.extensionId !== extensionId)
    throw new Error(
      "A different extension is already configured. Keep its installation, or explicitly remove your private mcp-settings.json before setting up a replacement.",
    );
  return saved;
}

export type BridgeConnection = { url: string; token: string; bridgeId: string };
export async function ensureManagedBridge(
  controllerId: string,
  options: {
    home?: string;
    port?: number;
    relayPath?: string;
    idleMs?: number;
    leaseMs?: number;
  } = {},
): Promise<BridgeConnection> {
  const home = options.home ?? managedHome();
  const settings = await initializeConnection(home);
  const port = options.port ?? Number(process.env.SMO_MCP_PORT ?? 4320);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid connector port.");
  const url = `http://127.0.0.1:${port}`;
  let previousConnector = false;
  const probe = async () => {
    try {
      const response = await fetch(`${url}/heartbeat`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.agentToken}`,
          "X-SMO-Controller": controllerId,
        },
        signal: AbortSignal.timeout(400),
      });
      if (!response.ok) return undefined;
      const value = (await response.json()) as { bridgeId?: string; protocolVersion?: number };
      if (value.protocolVersion !== 2) { previousConnector = true; return undefined; }
      return typeof value.bridgeId === "string" &&
        /^[a-f0-9-]{36}$/.test(value.bridgeId)
        ? { url, token: settings.agentToken, bridgeId: value.bridgeId }
        : undefined;
    } catch {
      return undefined;
    }
  };
  const existing = await probe();
  if (existing) return existing;
  if (previousConnector) throw new Error('The previous connector is still running. Close and reopen your coding agents to finish the update.');
  const entry = fileURLToPath(import.meta.url);
  const relayPath =
    options.relayPath ??
    join(
      dirname(entry),
      extname(entry) === ".ts" ? "managed-relay.ts" : "relay.mjs",
    );
  // The agent owns startup; the relay exits itself after the last client leaves.
  // Shared sessions reuse one authenticated listener. No model is launched here.
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", relayPath],
    {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        SMO_MCP_HOME: home,
        SMO_MCP_PORT: String(port),
        ...(options.idleMs !== undefined
          ? { SMO_MCP_IDLE_MS: String(options.idleMs) }
          : {}),
        ...(options.leaseMs !== undefined
          ? { SMO_MCP_LEASE_MS: String(options.leaseMs) }
          : {}),
      },
    },
  );
  child.on("error", () => {});
  child.unref();
  for (let attempt = 0; attempt < 25; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const ready = await probe();
    if (ready) return ready;
    if (previousConnector) throw new Error('Close and reopen your coding agents to finish the connector update.');
  }
  throw new Error(
    "Could not start the Show Me Once connector. Close an old manually started MCP bridge, then reconnect the agent. Do not start another helper terminal.",
  );
}
