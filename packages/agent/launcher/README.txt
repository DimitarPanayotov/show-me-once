Show Me Once — local Codex agent helper (0.3.0)

Requires Node.js 24 and Codex CLI signed in with ChatGPT. The helper uses that
existing sign-in through Codex; it does not read or copy OAuth credentials.

1. Load the extension ZIP at chrome://extensions using Load unpacked.
2. Confirm Codex CLI works: codex login status
3. Windows: double-click start-local-agent.cmd.
   macOS/Linux: run node start.mjs in this folder.
4. Paste the extension's 32-character ID when asked.
5. Leave the helper running. Copy its Pairing code.
6. In the extension's Run view, expand Connect a local agent, paste the code,
   and choose Connect local agent.
7. Open a saved skill and its starting website. Enter a task request with new
   inputs, then choose Run skill. Approve the displayed protected action when
   required. Pause and Stop remain available while the model is deciding.

The Windows launcher detects the CLI bundled with the Codex desktop app.
Otherwise Codex must be a native executable on PATH. If needed, set SMO_CODEX_EXE
to the full native executable path before starting this helper.
Pairing codes last only for this helper process/browser session. Stop the
helper with Ctrl+C. The helper listens only on 127.0.0.1:4319 and only accepts
the configured extension origin plus its pairing token.

This local demo requires this extra helper and the user's Codex access.
The hosted OpenAI/Anthropic adapters are separate optional configurations.

Source and setup: https://github.com/DimitarPanayotov/show-me-once
App: https://show-me-once-dimitar.vercel.app
