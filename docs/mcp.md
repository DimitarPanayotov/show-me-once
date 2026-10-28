# Use Show Me Once with your coding agent

After connecting once, open your coding agent and ask it to use a skill. It starts the connector automatically. Chrome shows progress and asks for approval. **No separate helper terminal needs to stay open.**

Your existing agent owns the conversation, model and decisions. MCP supplies guarded browser tools and never starts another Codex/model process. The older extension-led AI and recorded-step modes remain available separately.

## One-time setup (0.4.1)

Use Node.js 24. Extract the standalone MCP ZIP to a permanent folder; it needs no pnpm or repository installation. The examples use the already-built source bundle.

1. Reload the extension from `apps/extension/.output/chrome-mv3`. Confirm version **0.4.1**. Copy its ID from `chrome://extensions` or **Run → Connect your coding agent**.
2. Run once, replacing `YOUR_EXTENSION_ID`:

   ```powershell
   node C:/dev/interviews-prep/juma-task/dist/mcp/setup.mjs YOUR_EXTENSION_ID
   ```

   This creates private settings, prints a pairing code, and exits. Repeating setup for the same extension preserves the code. Keep it out of chat, skills and Git.

3. Register the integration once:

   ```powershell
   codex mcp add show_me_once -- node C:/dev/interviews-prep/juma-task/dist/mcp/server.mjs
   codex mcp list
   ```

   Other MCP clients: configure a stdio server named `show_me_once`, command `node`, with the absolute `server.mjs` path as its argument. The ZIP includes a Codex TOML example; other clients use their own format. Node must be available to the client. Do not launch the server manually.

4. Restart/reconnect the agent client. In Codex CLI, `/mcp` must show `show_me_once` connected with five tools. A config edit alone does not connect a running session.
5. Open the extension's **Run → Connect your coding agent**, paste the code, and select **Connect coding agent**. A visible **Connected to your coding agent** status confirms success; settings collapse automatically.

After setup, the connector starts with the MCP client, is shared by concurrent sessions, and exits when idle. Pairing survives Chrome/agent restarts. The extension retries automatically (up to 30 seconds), or immediately when you open its popup or choose **Check connection**. **Forget connection** removes pairing; ordinary restarts need no new code.

Upgrading from 0.4.0: close the old manual bridge terminal once, run setup, then use **Forget connection** and pair with the new code. Do not leave the old relay occupying port 4320. The older decision helper on port 4319 is separate.

Official Codex references: [MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [skill discovery](https://learn.chatgpt.com/docs/build-skills).

## Install a skill

For the first test, extract `wikipedia-search-agent-skill.zip` at the agent workspace root, creating `.agents/skills/wikipedia-search/SKILL.md`. Confirm it appears in the skill selector; reload/restart if needed.

For your own demonstration: record, stop, review, then select **Instructions & download → Export for coding agent (ZIP)**. Extract at the agent workspace root, preserving `.agents/skills/<name>/SKILL.md`. A plain file in Downloads does not register a skill. A conversation in another workspace does not automatically discover it. User-wide Codex skills can instead go in `$HOME/.agents/skills/<name>/SKILL.md`.

The export preserves original frontmatter and executable plan, then adds the five-tool workflow. All replacement inputs must be supplied to `start_skill`; they stay in extension session storage and never appear in observations or persistent logs.

## Everyday use and demo

Complete one-time setup and skill installation before filming. No bridge terminal is part of normal use.

1. Open your coding agent in the skill's workspace; the extension should show **Connected to your coding agent**.
2. Open `https://www.wikipedia.org/` in the active Chrome tab, English selected. Do not start another recording or click the extension's regular Run button.
3. Ask: `Use $wikipedia-search through show_me_once to search Wikipedia for Grace Hopper. Pause for approval in the extension and stop if blocked.`
4. The agent calls `start_skill`, `observe_run`, and `act`. Chrome fills the field; the extension shows **External coding agent · MCP** and an action-specific preview.
5. Review and approve the submission in the extension. The agent cannot approve. If it ended its response while waiting, say `I approved in the extension. Continue the same run.`
6. Confirm the visible Grace Hopper result and `completed`. Return to the starting page and repeat with **Alan Turing** using the same skill.
7. During another run, choose **Stop run** instead of approving. Ask the agent to inspect status. It must report `stopped`; no later action may execute.

A clear demo sequence is: demonstration → generated/exported skill → natural-language request → browser actions → meaningful approval → result → same skill, new input. Explain one-time integration setup briefly; do not repeat it for every task.

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

Actions bind controller, bridge/connection, run, selected tab, current step and a single-use observation expiring after 15 seconds. Unknown/ambiguous/sensitive targets block dispatch. No arbitrary JS, HTML, screenshots, unrestricted page text, shell, free navigation, approval or Resume tool is exposed. Known destinations must fit current/next checkpoint scope; unexpected JavaScript navigation is blocked by the subsequent checkpoint. Page text and skill prose cannot grant extra capabilities.

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
