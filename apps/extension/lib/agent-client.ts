import { browser } from "wxt/browser";
import {
  checkedDecision,
  type AgentInput,
  type AgentDecision,
  type AgentProviderId,
} from "@show-me-once/shared/agent";
import { requestApi } from "./api";

const LOCAL = "http://127.0.0.1:4319";
async function checkLocalAgent(token: string) {
  const response = await fetch(`${LOCAL}/health`, {
    credentials: "omit",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok)
    throw new Error(
      "Could not pair. Check the local agent process and pairing code.",
    );
  const result = (await response.json()) as {
    ready?: boolean;
    provider?: string;
  };
  if (!result.ready || result.provider !== "codex-local")
    throw new Error("The local Codex agent is not ready.");
  return { ready: true, provider: result.provider };
}

export async function pairLocalAgent(token: string) {
  const result = await checkLocalAgent(token);
  await browser.storage.session.set({ localAgentToken: token });
  return result;
}

export async function localAgentStatus() {
  const { localAgentToken } =
    await browser.storage.session.get("localAgentToken");
  if (typeof localAgentToken !== "string")
    return { localPaired: false, localConnected: false };
  const localConnected = await checkLocalAgent(localAgentToken).then(
    () => true,
    () => false,
  );
  return { localPaired: true, localConnected };
}

export async function chooseAgentAction(
  provider: AgentProviderId,
  input: AgentInput,
  apiBase: string,
  bearer: string | undefined,
  signal: AbortSignal,
): Promise<AgentDecision> {
  let result: { decision: unknown };
  if (provider === "codex-local") {
    const token = (await browser.storage.session.get("localAgentToken"))
      .localAgentToken as string | undefined;
    if (!token) throw new Error("Connect your local agent first.");
    const response = await fetch(`${LOCAL}/decide`, {
      method: "POST",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
      signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        payload?.error || "The local agent could not choose an action.",
      );
    result = payload;
  } else {
    if (!bearer) throw new Error("Sign in to use a hosted agent.");
    result = await requestApi(
      apiBase,
      "agent/decide",
      { provider, input },
      bearer,
      fetch,
      { signal, timeoutMs: 28000 },
    );
  }
  return checkedDecision(result.decision, input);
}
