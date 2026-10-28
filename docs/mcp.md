# Use Show Me Once with your coding agent

After connecting once, open your coding agent and ask it to use a skill. It starts the connector automatically. Chrome shows progress and asks for approval. **No separate helper terminal needs to stay open.**

Your existing agent owns the conversation, model and decisions. MCP supplies guarded browser tools and never starts another Codex/model process. Version 0.5 focuses the interface on this single agent-led workflow.

## One-time setup (0.5.0)

Download the reviewer kit and open **START-HERE.html**. You need Chrome, Node.js 24 and a local coding agent supporting MCP over stdio. Codex is the configured example.

1. Load/reload the kit's **extension** folder in Chrome (source builds: apps/extension/.output/chrome-mv3). Confirm **0.5.0**.
2. Open **Skills & activity → Connect your coding agent**, then **Copy ID**.
3. Open **connector/Connect with Codex.cmd** on Windows, or run **node setup.mjs** in the connector folder on macOS/Linux. Paste the ID and choose Codex. Setup registers the connection automatically and prints a private pairing code.
4. Restart/reconnect Codex. Paste the code into the extension and choose **Connect coding agent**.
5. The visible **Connected to your coding agent** status confirms success. Close setup; no helper window needs to stay open.

The wizard changes only the named MCP registration through Codex's CLI. It does not launch a model or extract sign-in credentials. If automatic registration is unavailable, it prints manual stdio settings and a command. Other clients use those settings; their exact UI and end-to-end behavior have not been verified.

For source builds, run node dist/mcp/setup.mjs interactively after pnpm mcp:bundle. Noninteractive setup remains available as node setup.mjs YOUR_EXTENSION_ID --codex. Without --codex it only creates settings and prints manual configuration.

Codex's /mcp should show seven tools: list_skills, get_skill, start_skill, observe_run, act, get_run_status, stop_run. Configuring a server does not refresh an already-running session. [Official configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

Existing 0.4.1 users can keep their installed extension folder, reload it to 0.5.0, and restart/reconnect their agent to load the seven tools; pairing is retained.

Pairing survives browser/agent restarts. The extension retries automatically, or immediately through **Check connection**. **Forget connection** removes pairing. Close the old manual relay once when upgrading from 0.4.0; it must not occupy port 4320.

## Everyday use and demo

1. Connect once, then choose **Open Wikipedia & copy example request**.
2. Select English on Wikipedia and paste the request into your existing agent.
3. The agent calls list_skills/get_skill, reads the full parameterized SKILL.md, and starts a run. No account or filesystem skill installation is needed.
4. Watch Chrome and the popup. Approve the search only after reviewing its action-specific preview. If the agent ended its reply while waiting, say: **I approved in the extension. Continue the same run.**
5. Verify the Grace Hopper result and completed activity. Return to www.wikipedia.org and ask the same agent to use the same skill for Alan Turing.
6. On a third run, choose **Stop run** before approval. Ask the agent for status; it must report stopped and perform no later action.

For your own task, choose **Record**, demonstrate it once and select **Stop & create skill → Use with agent**. Open its starting page and copy the request into your agent. The new skill is immediately discoverable. Earlier local drafts are retained when switching skills; a library account is optional for local tasks.

Sign in to save versions and share with another registered user. Cloud access is checked for the current account; signing out removes cloud entries from discovery. Markdown and agent ZIP exports remain optional under **Edit skill & export**.

The recommended demo is: demonstrate → review the generated skill → copy a request → agent reads it → browser actions → meaningful approval → result → same skill with a new input. Keep setup separate from normal use.

## Current product scope

The popup offers one execution path: the connected coding agent. Hosted-provider selection, the old decision-helper pairing and manual/replay controls have been removed from the interface. Compatibility adapters remain in source and older releases, outside the reviewer flow. The current extension requests only the deployed API and managed connector host permissions.

No owner-funded API configuration is part of the default product. A reviewer's model and authentication belong to their existing agent. The connector cannot approve or resume itself.

## Lifecycle checks

- Close all agent sessions; the connector should exit after about 30 seconds. Reopen the agent: saved pairing should reconnect without another terminal/code.
- With two sessions open, closing one must leave the other connected. Each run retains one owner; another session cannot take it over.
- A crash/disconnect pauses a run. Automatic reconnection never automatically resumes interrupted actions. Inspect the page; Stop and start again if controller/bridge identity changed.
- Restart the extension worker mid-run: observations must be invalidated and execution paused. Lost results are uncertain; never blindly repeat the action.
- Use **Stop run** to cancel a task. **Forget connection** removes pairing.

## Architecture and credentials

| Component                       | Lifecycle                     | Responsibility                                                |
| ------------------------------- | ----------------------------- | ------------------------------------------------------------- |
| Existing coding-agent session   | Opened by user                | Model, skill, conversation, tool decisions                    |
| `server.mjs`                    | Started by MCP client         | Five guarded tools; automatic connector startup               |
| `relay.mjs`                     | Started automatically, hidden | Authenticated shared loopback transport; exits when idle      |
| Extension worker/content script | Managed by Chrome             | Tab/run/step checks, safe observations, approvals, Pause/Stop |

The relay binds only `127.0.0.1:4320`, validates literal Host and exact extension Origin, rejects browser Origins for agent endpoints, and separates extension and agent credentials. One browser instance is pinned per relay lifetime. Concurrent startups race for one listener; losing processes exit without replacing it. No model subprocess is launched.

Stable credentials live in `$HOME/.show-me-once/mcp-settings.json`, outside the repository (directory 700/file 600 where supported; Windows inherits private profile ACL). The extension remembers its credential in local storage, never sync. Run inputs remain session-only. Reconnection authenticates with the saved token and refreshes relay identity. Tokens are never in URLs, tool results or skill exports.

Clients renew leases every 10 seconds; vanished clients expire after roughly 30 seconds. The relay exits about 30 seconds after the last controller leaves/expires (up to about a minute after a crash). The extension uses WebSocket heartbeats and a reconnect alarm. Dropped connections, expired leases and worker restarts pause runs and invalidate observations; no command is replayed.

Actions bind controller, bridge/connection, run, selected tab, current step and a single-use observation expiring after 15 seconds. Unknown/ambiguous/sensitive targets block dispatch. No arbitrary JS, HTML, screenshots, unrestricted page text, shell, free navigation, approval or Resume tool is exposed. Links and cross-origin form destinations must fit current/next checkpoint scope; unexpected JavaScript navigation is blocked by the subsequent checkpoint. Same-origin form submissions may use an intermediate endpoint, such as Wikipedia's search redirect, but still require explicit action-specific approval and the final navigation checkpoint. Form-action overrides are checked, and destructive destination wording takes precedence over search labels. Page text and skill prose cannot grant extra capabilities.

MCP runs currently retain the current generic activity log locally; they are not automatically linked to backend library version/history. Extension-led library runs retain their backend history behavior.

## Troubleshooting

- **Waiting for your coding agent:** open/reconnect the configured client; open the popup or choose **Check connection**. No bridge command is needed.
- **MCP startup fails:** run one-time setup; check Node 24 and the permanent absolute server path. Close an old manual bridge once. An unrelated process on port 4320 is never killed or replaced.
- **Pairing not recognized:** verify extension ID and setup code. Repeat setup to see the same code. Forget an old pairing before replacing it. Changing extension ID requires explicit new setup.
- **Skill/tools missing:** verify `/mcp`, skill selector, workspace and folder structure; restart/reconnect.
- **Unsaved draft conflict:** save before starting a different imported skill. Matching skill runs preserve edited name/description.
- **Stale observation:** obtain a fresh one after navigation, approval, Pause or reconnect.
- **Unknown outcome:** inspect page/activity; Stop and restart when uncertain. Do not blindly retry.

Build from source with `pnpm mcp:bundle`; set `WXT_API_BASE_URL` to the deployment and run `pnpm --filter @show-me-once/extension zip`. Custom installations can set `SMO_MCP_HOME` to a private settings directory. Legacy explicit `SMO_MCP_CONNECTION_FILE` configuration remains compatible with manually managed relays for development; it is not the default demo path.

## Verification limit

Automated tests use real stdio MCP processes, automatic startup/sharing/idle shutdown/restart, HTTP/WebSocket authentication, saved browser pairing, and the actual run controller with simulated content execution. No browser automation was used, as requested. Real Codex/Chrome acceptance remains pending: this conversation has not loaded the integration's MCP tools. Earlier 0.3.x real-site evidence validates the separate extension-led mode. Follow the manual procedure above before claiming a successful two-input real-agent demo.
