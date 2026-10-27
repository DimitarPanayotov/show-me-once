import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_DECISION_SCHEMA,
  checkedDecision,
  type AgentInput,
} from "@show-me-once/shared/agent";
import {
  AGENT_INSTRUCTIONS,
  agentPrompt,
  checkedInput,
  type AgentProvider,
} from "./providers.ts";

/** Local development only. Codex owns its subscription authentication; credentials never enter this app. */
export function codexSubscriptionProvider(executable = "codex"): AgentProvider {
  return {
    id: "codex-local",
    async decide(raw: AgentInput, signal?: AbortSignal) {
      const input = checkedInput(raw);
      const cwd = await mkdtemp(join(tmpdir(), "show-me-once-agent-"));
      const schema = join(cwd, "decision.schema.json");
      try {
        await writeFile(schema, JSON.stringify(AGENT_DECISION_SCHEMA));
        const text = await new Promise<string>((resolve, reject) => {
          const child = spawn(
            executable,
            [
              "exec",
              "--ignore-user-config",
              "--ephemeral",
              "--skip-git-repo-check",
              "--sandbox",
              "read-only",
              "--disable",
              "shell_tool",
              "--disable",
              "apps",
              "--disable",
              "plugins",
              "--disable",
              "multi_agent",
              "-c",
              'web_search="disabled"',
              "-c",
              'model_reasoning_effort="low"',
              "--output-schema",
              schema,
              "--json",
              "-",
            ],
            { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
          );
          let stdout = "",
            settled = false;
          const finish = (error?: Error, value?: string) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            signal?.removeEventListener("abort", abort);
            if (error) {
              child.kill();
              reject(error);
            } else resolve(value ?? "");
          };
          const abort = () => finish(new Error("Agent request cancelled."));
          const timeout = setTimeout(
            () =>
              finish(new Error("The local agent timed out. Retry this step.")),
            25000,
          );
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) {
            abort();
            return;
          }
          child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
            if (stdout.length > 200_000)
              finish(new Error("Unexpected local agent output."));
          });
          // Never print process stderr: it can contain account identifiers or request context.
          child.stderr.on("data", () => {});
          child.on("error", () =>
            finish(
              new Error(
                "Could not start Codex. Install it and sign in with ChatGPT.",
              ),
            ),
          );
          child.on("close", (code) => {
            if (code !== 0) {
              finish(
                new Error(
                  "Codex could not complete the decision. Check its sign-in and usage limits.",
                ),
              );
              return;
            }
            try {
              const messages = stdout
                .split(/\r?\n/)
                .filter(Boolean)
                .map((line) => JSON.parse(line));
              const answer = messages
                .filter(
                  (e) =>
                    e.type === "item.completed" &&
                    e.item?.type === "agent_message",
                )
                .at(-1)?.item?.text;
              if (typeof answer !== "string") throw new Error();
              finish(undefined, answer);
            } catch {
              finish(
                new Error("Codex did not return a structured browser action."),
              );
            }
          });
          child.stdin.on("error", () => {});
          child.stdin.end(`${AGENT_INSTRUCTIONS}\n\n${agentPrompt(input)}`);
        });
        let decision: unknown;
        try {
          decision = JSON.parse(text);
        } catch {
          throw new Error("Codex returned an invalid action format.");
        }
        return checkedDecision(decision, input);
      } finally {
        await rm(schema, { force: true });
        await rmdir(cwd).catch(() => {});
      }
    },
  };
}
