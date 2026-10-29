# MCP integration

Connect an existing coding agent to Show Me Once. The agent uses its own model account and runs skills through the extension.

## Connect

Requires Chrome, Node.js 24 and an MCP-capable client.

1. Open **External coding agent (optional)** in the extension.
2. Choose Codex, Claude Code, Cursor, VS Code or another MCP client.
3. Use the installation link or run the supplied setup command once. Restart the client if required.
4. Ask the agent to list your Show Me Once skills.
5. Compare the six-digit codes in the agent and extension, then choose **Codes match — Allow connection**.

The client starts the connector automatically. Trust is remembered, so later connections need no helper terminal, extension ID or secret copying. **Forget connection** revokes the pairing.

For offline setup, keep the downloaded bundle's `connector` folder at a stable path and run `node setup.mjs --agent=codex`. Use `--agent=claude-code` for Claude Code or `--agent=other` to print configuration.

## Run a skill

Ask the agent to use a saved skill with new inputs. It discovers the skill, reads its parameters and opens a dedicated Chrome tab automatically.

Clients supporting MCP confirmation forms can show protected-action approvals inside the agent. Other clients use the extension's approval controls. Pause and Stop remain available in the extension.

Recordings redact URL paths. If a skill's starting route is unavailable, the agent asks for its public starting address in chat. A fixed public route can also be saved as `start_url` in the skill header.

## Tools

- `list_skills`, `get_skill`: discover and read available skills.
- `start_skill`: validate inputs and open the task tab.
- `observe_run`, `act`: inspect the current step and perform a guarded action.
- `review_action`: request human approval for a pending protected action.
- `get_run_status`, `stop_run`: inspect progress or stop execution.

These tools follow the saved skill; they do not expose arbitrary JavaScript or unrestricted navigation. A disconnected or uncertain action is paused for review.

## Connection and data

The client launches a local stdio server and an authenticated connector on `127.0.0.1:4320`. The connector closes when idle and can reopen Chrome after pairing.

Browser credentials stay in the user's profile. Each action is bound to the current controller, browser tab, run, step and observation. Shared skill access is checked against the signed-in library account.

MCP run activity currently stays local. Runs started inside the extension save per-version history to the backend.
