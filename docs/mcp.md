# Agent-led browser automation through MCP

The external coding-agent session is the decision-maker. An exported skill gives it instructions; MCP supplies browser capabilities. This path does not invoke the local Codex decision helper or start a second model/agent process.

## Components and ownership

| Component | Started by | Responsibility |
| --- | --- | --- |
| Existing Codex session | User | Loads the skill, interprets new inputs, chooses actions and calls tools. |
| `server.mjs` | Codex's MCP client, over stdio | Exposes five typed tools and forwards commands to the bridge. It has no model provider or shell/browser execution tool. |
| `bridge.mjs` | User, in a separate terminal | Authenticated relay on `127.0.0.1:4320`. Keeps pending commands in memory; never records requests or responses. |
| Extension service worker | Chrome | Opens the outbound WebSocket, owns run/tab/step binding, observes safe controls, and dispatches guarded browser actions. |
| Content script | Extension | Supplies bounded/redacted controls and performs existing target, sensitivity and confirmation checks. |

The existing extension-led **AI agent** and **Recorded steps** modes remain available. Their local Codex decision helper uses port 4319 and is a separate process. You do not need that helper for agent-led MCP execution.

## Build and configure Codex CLI

The standalone MCP ZIP already contains the bundled server and relay; recipients need Node.js 24 rather than pnpm or this repository. Extract it, use the extension ZIP separately, and skip the source-build commands below. Replace the example absolute paths with your extracted folder.

1. Use Node.js 24, install workspace dependencies, then build:

   ```powershell
   pnpm install
   pnpm mcp:bundle
   $env:WXT_API_BASE_URL='https://show-me-once-dimitar.vercel.app'
   pnpm --filter @show-me-once/extension zip
   ```

2. Load/reload `apps/extension/.output/chrome-mv3` in Chrome. Confirm version 0.4.0 and note its extension ID. The new loopback bridge permission is limited to port 4320.

3. Start the relay yourself and keep its terminal open:

   ```powershell
   node C:/dev/interviews-prep/juma-task/dist/mcp/bridge.mjs YOUR_EXTENSION_ID
   ```

   It prints an extension pairing code and writes a separate agent credential file at `$HOME/.show-me-once/mcp-connection.json`. That file uses a private user directory and restrictive file mode where supported; Windows inherits the user's profile permissions. It is outside the repository and never belongs in an export or commit. The bridge removes its own file on normal shutdown. After a crash, close the old process and remove its stale connection file before restarting, or supply a different file path as the second argument.

4. In the extension's **Run** view, expand **Use an external agent (MCP)**. Enter this bridge's pairing code and choose **Connect MCP bridge**. The Codex decision-helper pairing code is different.

5. Register the MCP server with Codex CLI:

   ```powershell
   codex mcp add show_me_once -- node C:/dev/interviews-prep/juma-task/dist/mcp/server.mjs
   codex mcp list
   ```

   Replace these absolute paths if you extract the standalone bundle elsewhere. `codex-config.example.toml` contains the equivalent `[mcp_servers.show_me_once]` configuration for a trusted workspace's `.codex/config.toml` or the user's `~/.codex/config.toml`. If you chose a custom connection file, set `SMO_MCP_CONNECTION_FILE` in that MCP server's environment. Do not put the token itself in skill instructions or chat.

6. Reload/reconnect the client so it reads the configuration, then continue your existing conversation. In Codex CLI, `/mcp` must show `show_me_once` connected with the five tools. Configuration on disk alone does not prove the already-open session has loaded it. Do not launch `codex exec` to perform this workflow.

Codex's documented configuration and skill-discovery rules: [MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [local skills](https://learn.chatgpt.com/docs/build-skills). The current SDK uses the [official stdio implementation](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio).

## Export and install a skill

1. Record a Wikipedia search once, stop, and review the skill.
2. Under **Instructions & download**, select **Export for coding agent (ZIP)**.
3. Extract the ZIP at the root of the workspace in which you use Codex. It contains `.agents/skills/<skill-name>/SKILL.md` and installation instructions. Preserve that folder structure; placing `SKILL.md` in Downloads does not register it as a skill.
4. Confirm the skill appears in the client's skill selector after reloading its skills. Explicitly invoke `$<skill-name>` for the first test. Codex scans `.agents/skills` from its working directory up to the repository root; a conversation running in another project will not automatically see this folder. User-wide skills can instead go under `$HOME/.agents/skills/<skill-name>/SKILL.md`.

The original frontmatter and executable JSON plan are preserved. The export adds MCP workflow instructions. The agent must supply each declared parameter to `start_skill`; replacement values stay in extension session storage and never appear in observations or persistent run logs.

## Acceptance procedure — manual verification pending

This implementation has non-browser automated checks. No browser automation was used for this change, as requested. A real already-open coding-agent/Chrome acceptance run has **not** been completed: this conversation has no live connection to the newly configured MCP server, and Chrome interactions must be performed manually under the requested constraint. SDK tests are not a substitute for that evidence.

1. Open `https://www.wikipedia.org/` in your active Chrome tab, English selected.
2. In your already-open, reconnected Codex session, ask: `Use $wikipedia-search through show_me_once to search Wikipedia for Grace Hopper. Use the extension for approval and stop if blocked.` Use your actual exported skill name if different.
3. Verify the agent loads the skill and calls `start_skill`, `observe_run`, and `act`. For navigation steps, it calls `act` with `checkpoint`; it cannot navigate to an arbitrary URL.
4. The extension should show **External coding agent · MCP**. Search submission must pause for the existing action-specific preview. Approve only in the extension. The agent can inspect status, but it has no approval tool.
5. Confirm the visible Grace Hopper result and the final `completed` status. Return to the starting page and repeat with Alan Turing using the same installed skill.
6. During another run, choose **Stop run** in the extension. The agent's next status must be `stopped`; no later action should execute.
7. During another run, stop the bridge or disconnect it in the extension. The run should pause. Pending tool calls report a disconnect or unknown outcome rather than silently retrying. Inspect the page. Reconnect the original bridge and explicitly Resume in the extension to get a fresh observation, or Stop and start a new run if the bridge/client identity changed.
8. Restart the extension worker during a run. It must invalidate observations and pause for inspection. An action with an unknown outcome must not run again automatically.

Record actual URLs, tool results and whether the model used the installed skill. Until these checks are performed, do not claim two-input real-agent/browser acceptance for this new path. Earlier 0.3.x tests validate the different extension-led decision loop.

## Safety and lifecycle

- All actions are bound to controller, bridge connection, run, selected tab, current step and a single-use observation with a 15-second lifetime. Only the active run's allowed action kind and eligible live target IDs are accepted.
- The extension chooses the active Chrome tab at run start and verifies the starting checkpoint. Agents cannot choose arbitrary tabs, execute JavaScript, read HTML, request screenshots/page text, navigate freely, approve, or resume themselves through this interface.
- Only one run can be active. Another controller cannot operate or inspect it. The relay accepts one paired extension instance and pins that identity for its lifetime.
- Extension and agent credentials are separate. WebSocket authentication occurs in the first message, never a URL. HTTP checks literal loopback Host, exact Chrome extension Origin for pairing, and bearer credentials. Agent command endpoints reject browser Origins. No listener binds to a public interface.
- The extension sends a heartbeat every 20 seconds. Chrome 120 supports this WebSocket lifecycle; a 30-second alarm restores a lost connection after worker suspension. State and inputs use the existing local/session split. A restart invalidates observations and pauses the run, rather than replaying queued actions. [Chrome WebSocket lifecycle](https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets).
- Disconnects and request cancellation pause the owning run. Results lost during browser dispatch are treated as uncertain; requests are not replayed. A dispatched browser action cannot be undone by Stop.
- The MCP process renews a controller lease every 10 seconds. A crashed/killed process loses that lease after about 30 seconds, which pauses its run even if no tool call was in flight. The relay and extension socket have separate liveness checks.
- Website text and imported skills remain untrusted. Tool schemas and extension code enforce the allowed action set; prose cannot grant additional capabilities.

## Troubleshooting

- **MCP server fails at startup:** start the bridge first and check the connection-file path. `server.mjs` is started by the coding agent, not manually in a terminal expecting prompts.
- **Bridge restarted:** its credentials and identity rotate. Pair the extension again and reconnect/restart the client's MCP server so it rereads the connection file. Stop the old run before starting under the new controller/bridge identity.
- **Pairing fails:** use the MCP bridge code, confirm the exact extension ID, and close duplicate paired test profiles. The bridge intentionally rejects a second extension instance.
- **Skill missing:** verify the agent workspace, `.agents/skills/<name>/SKILL.md` path, valid frontmatter and actual selector discovery. Reconnect/reload the client as needed.
- **Tools missing:** inspect `/mcp`; do not assume a config edit updates a running conversation automatically.
- **Stale observation:** call `observe_run` again. Do not reuse old control IDs after navigation, approval, Pause or reconnect.
- **Unsaved draft conflict:** save your current draft before asking the external agent to start a different skill. Running the same exported skill preserves your edited name and description.
- **Unknown outcome:** inspect the page and extension history before doing anything further. Stop and restart when uncertain; never retry the previous action blindly.

Imported MCP runs currently keep the current run's generic per-step log in the extension. They are not automatically linked to a saved backend skill version; extension-led runs of library skills retain their existing backend history behavior.
