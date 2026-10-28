import { browser } from "wxt/browser";
import { checkedDecision, type AgentInput } from "@show-me-once/shared/agent";

const HOST = "com.show_me_once.agent";

// Chrome owns this process. Disconnecting also cancels its outstanding model call.
async function nativeCall(
  message: object,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const port = browser.runtime.connectNative(HOST);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      port.disconnect();
      if (error) reject(error);
      else resolve(value!);
    };
    const abort = () => finish(new Error("Agent request cancelled."));
    const timeout = setTimeout(
      () =>
        finish(
          new Error(
            "The subscription helper timed out. Check Codex sign-in and retry.",
          ),
        ),
      60000,
    );
    port.onDisconnect.addListener(() => {
      void browser.runtime.lastError;
      finish(
        new Error(
          "Install the subscription helper, then check its connection. Codex must be signed in on this computer.",
        ),
      );
    });
    port.onMessage.addListener((value: unknown) => {
      if (!value || typeof value !== "object")
        return finish(new Error("Invalid subscription helper response."));
      const result = value as Record<string, unknown>;
      if (result.error)
        finish(
          new Error(
            typeof result.error === "string"
              ? result.error
              : "The subscription helper could not complete this request.",
          ),
        );
      else finish(undefined, result);
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    else port.postMessage(message);
  });
}

export async function checkNativeAgent() {
  const result = await nativeCall({ type: "status" });
  return { ready: result.ready === true };
}

export async function nativeAgentDecision(
  input: AgentInput,
  signal: AbortSignal,
) {
  const result = await nativeCall({ type: "decide", input }, signal);
  return checkedDecision(result.decision, input);
}
