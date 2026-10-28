# Optional local coding-agent connection — 0.7.0

The main product remains request → Run inside the extension. External coding agents are optional and use the same guarded browser actions, approvals and Stop controls. Your existing agent supplies its own model and account; MCP does not launch a second model.

## Connect once

You need Chrome, Node.js 24 (including npx), and an MCP-capable agent. Open **Skills & activity → External coding agent (optional) → Connect your coding agent**.

1. Choose **Codex**, **Claude Code**, **Cursor**, **VS Code / Copilot**, or **Other MCP client**.
2. Cursor/VS Code: choose **Add to…** and approve installation in the editor. Codex/Claude Code: choose **Copy setup command**, run that registration command once in a terminal, then close the terminal. Other clients: paste the supplied configuration into their MCP settings. Reconnect/restart the agent if it asks.
3. Ask the agent: **Use Show Me Once and list my skills.**
4. Open the extension and compare its six-digit code with the code the agent reports. If they match, choose **Codes match — Allow connection**. The code is a comparison value, not a password; nothing needs to be copied back into the extension.
5. The extension shows **Connected to your coding agent**. Ask the agent to use a skill with new inputs. It can discover and read SKILL.md directly; no skill-file installation is needed.

The agent starts the connector automatically and it exits after the last client leaves. No extension ID, pairing-secret copying, separate bridge command, or permanently open terminal is needed for this path. The extension remembers trust and reconnects automatically when the agent returns. Node.js remains a prerequisite for these command-based integrations.

The install links and commands use a self-contained versioned package at the app's `/downloads/show-me-once-mcp-0.7.0.tgz`. It is launched through npx, so it does not depend on an extracted ZIP remaining at the same local path. This download contains connector code only, with no account credentials. The adjacent `.sha256` records the packaged checksum.

## What the statuses mean

- **Waiting for your agent**: registration or startup is still needed. Ask the configured agent to list your skills, or use Check connection.
- **Connection approval needed**: compare the codes, then Allow in the extension. This does not approve protected browser actions.
- **Connected**: an authenticated live connection has completed; registration alone never produces this label.
- **Waiting for your coding agent** after pairing: trust is saved and reconnection is automatic.
- **Different connector**: the saved identity did not match. The extension keeps the previous trust and does not send its credential. Reconnect the original installation, or explicitly Forget connection before approving a replacement.

**Not now** rejects the pending connection. **Forget connection** clears local trust and, when connected, revokes the remembered browser credential on the connector. Neither option changes the extension's primary Run settings. Connection approval expires after two minutes. It can only be granted in an extension page, not through an agent tool or website.

## Everyday use

Open a recorded/saved skill and copy its agent request, or ask the agent to discover a skill. It calls list_skills/get_skill, reads the instructions and starts a run with new non-secret parameters. The extension shows actions and meaningful protected-action approvals. Pause, Resume and Stop remain in the extension. Approval and reconnection never automatically repeat an uncertain action.

The GitHub issue-triage example has twelve steps: fill repository/topic/state/label, submit with approval, sort results by Recently updated and open an issue. Run it twice with different repositories/topics and inspect the visible results. Then test Stop before approving another search.

The seven tools are list_skills, get_skill, start_skill, observe_run, act, get_run_status and stop_run. They expose guarded skill actions, not arbitrary JavaScript or unrestricted browser control. Page text cannot grant extra permissions.

## Offline reviewer kit / development

Online setup in the popup is preferred. For an offline installation, keep the kit's connector folder at a permanent path and open **Connect with Codex.cmd**, or run `node setup.mjs --agent=codex`. Claude Code uses `--agent=claude-code`; `--agent=other` prints configuration. This registers only the chosen MCP server and never asks for an extension ID or prints a private secret. The agent still starts the connector automatically. Existing legacy pairings remain compatible.

Build with `pnpm mcp:bundle`. This also creates the versioned download in `apps/web/public/downloads`; include it when deploying the web app. `pnpm reviewer:package` bundles the extension and offline connector. This MCP setup is independent of the subscription helper under Agent settings.

## Architecture and privacy

The MCP client starts server.mjs over stdio. It initializes private settings if missing and starts/reuses one authenticated relay on 127.0.0.1:4320. Shared leases prevent one agent closing another's connection; the relay exits about 30 seconds after the final controller leaves. Chrome manages its own extension worker and reconnect alarm.

First pairing uses a signed P-256 transcript containing the browser origin, browser instance, relay identity, pairing request ID and random nonces from both sides. The connector commits to its random nonce before receiving the browser's. Both sides derive the six-digit comparison code from the full transcript. No skill, tab observation or action is sent until the user approves in the extension. Subsequent connections verify the pinned public key and fresh signed challenge before sending a browser credential. A process taking over the port cannot obtain that credential merely by answering a request.

Private root credentials live in ~/.show-me-once/mcp-settings.json; approved browser bindings in mcp-browsers.json. Files use private permissions where supported and the user's Windows profile ACL otherwise. Tokens never enter URLs, tool results, install links, skill exports or the clipboard. HTTP agent endpoints reject browser Origins; browser sockets require a literal extension Origin. Host checks, bounded messages and single-controller run ownership remain enforced. Pairing pins a local connector, not the claimed brand/name of a client.

Each action binds controller, connector, browser connection, run, selected tab, step and a fresh single-use observation. Disconnects/restarts pause runs and invalidate observations/approvals. Current MCP activity remains local; extension-led library runs retain their backend per-version history.

## Verification

Automated checks cover real stdio clients, fresh setup without an ID/settings file, first-discovery timing, matching-code approval, blocked access before approval, retained trust across idle restart, changed-identity rejection, browser-Origin rejection and revocation. Popup tests cover all client setup formats and the approval UI while preserving the primary in-extension Run path. Browser automation is not used. Installation through real Cursor/VS Code links and a live Codex/Claude Code browser task still require manual acceptance; protocol tests do not establish those client UI results.

Official configuration references: [Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Claude Code](https://code.claude.com/docs/en/mcp), [Cursor](https://cursor.com/docs/mcp/install-links), [VS Code](https://code.visualstudio.com/api/extension-guides/ai/mcp). The connection UX follows the [Browser MCP](https://browsermcp.io/docs/) pattern.
