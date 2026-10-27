# Agent execution

Version 0.3.0 adds an AI decision loop inside the extension experience. The user selects a skill, asks for the task with new inputs, and starts one run. The background worker observes the page, asks the selected provider to choose one guarded action, validates the response, executes it through the content script, and repeats. Safe steps advance automatically. The model cannot approve protected actions or disable Stop.

## Current local demo

The local Codex adapter uses the existing ChatGPT sign-in through the installed Codex CLI. It does not extract OAuth tokens. The companion process is required for this mode; this is additional setup beyond the original “load the extension and log in” goal. Hosted providers avoid the helper but require server credentials and are not configured in the current demo.

### Standalone helper

1. Install Node.js 24 and have Codex CLI signed in with ChatGPT. Verify `codex login status`.
2. Extract the extension ZIP and load its `manifest.json` folder at `chrome://extensions`. Confirm version 0.3.1.
3. Extract the local-agent helper ZIP. On Windows open `start-local-agent.cmd`; elsewhere run `node start.mjs`.
4. Paste the extension ID when asked. The process prints a pairing code and stays running.
5. In the popup's Run view, expand **Connect a local agent**, enter the pairing code, and choose **Connect local agent**. A green **Connected to local Codex. Ready to run.** message confirms success even with the settings collapsed. The code is kept in browser session storage. The helper's version remains 0.3.0 and is compatible with extension 0.3.1.
6. Open a skill, visit its starting page, and enter a request such as “Search Wikipedia for Katherine Johnson”. Parameters can also be supplied explicitly under the optional parameters section.
7. Choose **Run skill**. The popup identifies the agent provider and shows each action. A protected submission pauses with its exact target and effect. Stop can cancel an in-flight model request.

The pairing token and origin must both match. The helper binds only to `127.0.0.1:4319`. Close it with Ctrl+C. Restarting it generates a new pairing code. The extension never sends its library password or session token to the helper.

The popup checks the helper when opened. Under **Local agent settings**, **Check connection** verifies it again. An unavailable helper shows an explicit notice and disables starting a local-agent run. Start the helper again and enter its new pairing code if it changed.

### Run from the repository

```powershell
pnpm install
codex login status
$env:SMO_EXTENSION_ORIGIN = 'chrome-extension://YOUR_EXTENSION_ID'
pnpm agent:local
```

Use a native Codex executable on PATH. The standalone Windows launcher also detects the native CLI bundled with the Codex desktop app. `SMO_CODEX_EXE` can select its absolute path. `pnpm agent:bundle` creates a standalone helper folder in `dist/local-agent`, without requiring the source repository or pnpm at runtime. The tested CLI was 0.164.0-alpha.11.1; the adapter requires support for ephemeral execution and structured output.

## Common provider interface

`packages/agent` owns provider adapters. Each implements `decide(input, signal)` and returns the same normalized action: click, fill, press Enter, or ask the user. OpenAI uses Responses function calls; Anthropic uses Messages client tools; the local Codex adapter uses a bounded structured decision through an ephemeral CLI invocation. Changing a provider does not change browser permissions, target validation, confirmations, recording, skill storage, or run logs.

The full SKILL.md and the new task request are passed as context. The executable plan bounds the allowed action kinds and checkpoints; recorded selectors are hints. The agent chooses current live control IDs using labels, roles, types, and structural context, so a moved control can be selected instead of blindly replaying its old selector. This is a constrained browser agent, not an unrestricted planner for arbitrary websites.

Raw page HTML, document text, field values, passwords, tokens, and payment fields are not included in observations. Observations include at most 60 eligible control descriptors and a redacted URL. The task request may contain the user's new non-secret inputs. Requests, model responses, replacement values, and live labels are excluded from persistent application run logs. Codex invocations use ephemeral mode with shell, app, plugin, and subagent tools disabled. The model only proposes an action; browser operations run through the extension's existing guards.

MCP is not required by this first adapter implementation. The shared tool/action contract can later be exposed through MCP for other agent applications. No MCP server is currently shipped.

## Optional hosted providers

Configure one or both on the backend:

```text
OPENAI_API_KEY=...
OPENAI_MODEL=...
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=...
```

Use a tool-capable model available to the account. Credentials remain server-side. The authenticated provider listing exposes only availability, never keys. Model calls have a bounded timeout and return one schema-checked action. The extension does not fall back to recorded replay when an agent is unavailable.

OpenAI and Anthropic adapters have contract tests. Live provider verification is recorded separately; availability of one provider does not establish another provider's behavior or account access.

## Verification

`pnpm --filter @show-me-once/extension test:agent` uses the controlled fixture and a real local Codex provider. Set `SMO_BRIDGE_TOKEN` to the temporary helper's pairing code and `SMO_EXTENSION_ID` when its worker is inactive. This tests natural-language input extraction, a moved search control, two replacement inputs, popup closure, protected-action approval, Stop during a model request, and omitted values in persistent extension state.

The existing replay and confirmation regression suites explicitly choose **Recorded steps (no AI)** to preserve their diagnostic scope. Passing those suites alone is not evidence of agent execution.
