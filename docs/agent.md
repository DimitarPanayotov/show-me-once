# Run a skill inside the extension — 0.7.1

Record once, review the generated skill, save it to the library, then select it, type a new request and click **Run**. The extension owns the automatic observe → model decision → guarded action → checkpoint loop. Approvals, Pause, Resume and Stop stay in the popup. No coding-agent chat is required.

## Choose model access once

Open **Agent settings** and choose one of these options. Changing settings is blocked during an active run.

### Codex subscription on this computer

Requires Chrome, Node.js 24 and Codex signed in with ChatGPT. This helper currently supports Codex subscriptions; it does not convert subscriptions into generic API credentials or read OAuth tokens.

1. Load/reload the extension and copy its ID under **Agent settings**.
2. Open **subscription-helper/Install subscription helper.cmd** on Windows, or run `node setup.mjs` in that folder on macOS/Linux. Paste the ID.
3. Setup copies the helper into your user profile and registers a Chrome native-messaging host for that exact extension. On Windows it uses only HKCU; no administrator access is required.
4. Close setup. In the extension choose **Check subscription** and wait for **Ready**.
5. Sign into the library. Open the skill's original starting page, enter a request and click **Run**.

Chrome starts a hidden helper for each decision and closes the connection afterwards. You do not start a bridge or keep a terminal open. Subscription limits and Codex availability still apply. Existing Codex MCP settings are not changed by this installer.

For source builds, run `pnpm subscription:bundle`, then `node dist/subscription-helper/setup.mjs` once. Keep the loaded extension at the same path so its ID stays stable. Setup rejects silently replacing a different extension. To remove this helper on Windows, remove only HKCU\Software\Google\Chrome\NativeMessagingHosts\com.show_me_once.agent and the files under your user profile's .show-me-once/native folder. On macOS/Linux also remove its com.show_me_once.agent.json from Chrome's NativeMessagingHosts directory. Codex sign-in files and the optional MCP integration are separate.

### Your OpenAI or Anthropic API key

1. Select **My OpenAI API key** or **My Anthropic API key**.
2. Enter your own key and a tool-capable model available to your account. Defaults are gpt-5.4-mini and claude-sonnet-4-6; model names are editable.
3. Click **Save agent settings**, sign into the library, then use **Run**.

The key is stored only in trusted extension session storage. It is cleared from the settings input after saving, removed on sign-out or **Remove saved session key**, and lost when Chrome restarts. It is sent over HTTPS to the app backend and forwarded only to the selected provider; the backend does not save it. Keys never enter skill documents, model prompts, database rows or run logs. Owner-configured credentials remain a compatibility option, not a requirement for personal-key calls.

## Everyday flow

1. **Record**: open a starting page, click Start recording, demonstrate a task, then Stop & create skill.
2. **Generate/review**: edit its name, description and SKILL.md; parameters replace field values. Recorded actions and Markdown stay collapsed until requested.
3. **Library**: sign in and Save to library. Sharing and version editing are in the web app. Run also saves a new/edited owned skill before starting its backend history; the built-in example becomes a personal copy.
4. **Run**: open the starting page, enter a request with the new inputs and click Run. Safe steps continue automatically, including after an approval. No manual Next button, copied prompt or extra chat message.
5. Review each protected action's verb, target and consequence. Approve it in the extension, Pause/Resume, or Stop. Closing the popup does not stop a run.
6. Inspect completion and Run activity. Saved-skill runs write generic per-step history to the backend against the saved version.

## GitHub issue-triage example

Choose **Try GitHub issue triage**. It opens Advanced search and an editable sample request inside the extension. First input: microsoft/vscode, terminal, open, bug. After completion, return to Advanced search and run the same skill with microsoft/TypeScript, inference, open, bug.

Twelve steps cover four form inputs, protected search submission, Recently updated sorting, result selection and an issue-page checkpoint. Verify the actual repository/topic manually: sanitized origin/path-depth checkpoints do not prove page meaning. Missing controls or results should stop the run. This example makes no repository changes and reads no issue body.

## Safety and limits

Page field values, passwords, raw HTML and screenshots are not sent to the model. Only eligible bounded control descriptors and sanitized URLs cross that boundary. The user's explicit new request is sent to the chosen model; do not put secrets in it. The application rejects obvious secret patterns. User requests, parameter values, model responses and live page labels are excluded from persistent run history.

Model outputs are schema-checked and bound to the current step and live control. Same/next-checkpoint scope applies to links/forms. Protected actions require a target-bound approval; a changed target needs a new preview. Stop aborts the model request and checks cancellation before browser dispatch. An already-dispatched action may finish. Human verification remains manual.

A worker interruption with an uncertain browser outcome pauses execution rather than blindly repeating the action. Browser restart clears session inputs and API keys; inspect the page and restart an interrupted run. This is a constrained skill-following browser agent, not an unrestricted planner for arbitrary sites.

## Optional external coding agents

**External coding agent (optional)** retains the MCP integration. It is independent of the main Run button; see [MCP setup](mcp.md). That optional path still gets decisions from the external chat. Its activity is local; the extension-led path writes backend history.

## Verification

Automated tests cover the actual popup and background worker, provider/API contracts, native-host processes and framing, two replacement inputs, automatic progression after approval, Pause/Resume, cancellation during a model request, secret rejection and parameter-free history. Controlled documents exercise the twelve-step example. These checks do not replace real Chrome acceptance; see [verification](verification.md).

Sources: [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [Codex CLI](https://learn.chatgpt.com/docs/cli/reference), [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling), [Claude model lifecycle](https://platform.claude.com/docs/en/about-claude/model-deprecations).
