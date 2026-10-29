# Setup

## Install the extension

1. Download and extract the [release bundle](https://github.com/DimitarPanayotov/show-me-once/releases/latest).
2. Open **chrome://extensions**, enable **Developer mode**, select **Load unpacked** and choose the bundle's `extension` folder.
3. Open Show Me Once and sign into the library.
4. Choose model access under **Agent settings**.

Keep the extension folder at a stable path when updating so its ID stays the same.

## OpenAI or Anthropic API key

Choose your provider, enter a key and a compatible model, then select **Save agent settings**.

The key is held for the Chrome session and cleared on sign-out or browser restart. It is forwarded through the backend to the chosen provider without being saved in the database or run history.

## Codex subscription

Requires Node.js 24 and Codex CLI signed in with ChatGPT.

1. Copy the extension ID shown under **Agent settings**.
2. On Windows, open `subscription-helper/Install subscription helper.cmd`. On macOS/Linux, run `node setup.mjs` from that folder.
3. Paste the extension ID when prompted, then close setup.
4. Select **Check subscription** in the extension and wait for **Ready**.

Chrome starts the helper automatically when a decision is needed. Codex sign-in stays managed by Codex; the helper does not copy OAuth tokens.

## Record and run

1. Open the task's starting page and select **Record → Start recording**.
2. Perform the task, then select **Stop & create skill**.
3. Review the generated name, description, parameters and instructions, then **Save to library**.
4. Return to the starting page, enter a request with new inputs and click **Run**.

Approve protected actions when prompted. Pause, Resume and Stop are available during execution. Closing the popup leaves the run active. If an unfinished run blocks recording, use **Stop run to record**.

The web library supports editing, versions, sharing with another account and owner-only deletion. Deletion asks for confirmation before removing the skill, its versions, shares and run history.

For use from an existing coding agent, see [MCP integration](https://github.com/DimitarPanayotov/show-me-once/blob/main/docs/mcp.md).
