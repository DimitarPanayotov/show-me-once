import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { codexSubscriptionProvider } from "./codex.ts";
import { checkedInput } from "./providers.ts";
import { signedInWithChatGPT } from "./subscription-auth.ts";
import { readNative, writeNative } from "./native-protocol.ts";

const abort = new AbortController();
process.stdin.on("end", () => abort.abort());
process.stdin.on("close", () => abort.abort());
process.stdout.on("error", () => {
  abort.abort();
  process.exitCode = 1;
});
try {
  const config = JSON.parse(
    await readFile(
      process.env.SMO_NATIVE_SETTINGS ??
        join(dirname(fileURLToPath(import.meta.url)), "native-settings.json"),
      "utf8",
    ),
  ) as { extensionId: string; executable: string };
  if (
    !/^[a-p]{32}$/.test(config.extensionId) ||
    process.argv[2] !== `chrome-extension://${config.extensionId}/`
  )
    throw new Error(
      "This extension is not authorized to use the subscription helper.",
    );
  const message = (await readNative(process.stdin)) as {
    type?: string;
    input?: unknown;
  };
  process.stdin.resume();
  if (message?.type === "status") {
    const ready = await signedInWithChatGPT(config.executable);
    writeNative(process.stdout, { ready });
  } else if (message?.type === "decide") {
    if (!(await signedInWithChatGPT(config.executable)))
      throw new Error(
        "Sign into Codex with ChatGPT to use the subscription helper.",
      );
    const provider = codexSubscriptionProvider(config.executable);
    const decision = await provider.decide(
      checkedInput(message.input),
      abort.signal,
    );
    writeNative(process.stdout, { decision });
  } else throw new Error("Unsupported subscription-helper request.");
} catch (error) {
  writeNative(process.stdout, {
    error:
      error instanceof Error
        ? error.message
        : "The subscription helper failed.",
  });
}
process.stdin.pause();
