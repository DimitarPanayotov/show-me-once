# Architecture — 0.6.0

Show Me Once turns one browser demonstration into a reusable parameterized skill. The primary flow stays inside the Chrome extension: Record → review SKILL.md → backend library → enter a request → Run. The extension owns the automatic decision loop. External coding-agent control is an optional additional integration.

## What runs where

| Component                 | Responsibility                                                                                                                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content script            | Records structural click/input/Enter/navigation events, excludes values and sensitive controls, exposes bounded live control descriptions, validates and executes one guarded action.                                         |
| MV3 service worker        | Owns recording/run state, account session, model calls, action sequencing, checkpoint validation, cancellation and backend log synchronization. Short timers advance work; Chrome alarms recover scheduling after suspension. |
| Popup                     | Record/review/library selection, editable task request and Run, clear approval previews, Pause/Resume/Stop, activity and completion. Agent configuration and the external integration are secondary.                          |
| Next.js + oRPC backend    | Auth, authorized skill CRUD, immutable versions, sharing, per-user run history, and transient API-key forwarding to the selected model provider.                                                                              |
| PostgreSQL + Prisma       | Users, sessions, skills, versions, shares, runs pinned to versions, and ordered per-step logs.                                                                                                                                |
| Subscription helper       | Chrome native-messaging host, launched hidden on demand. Uses Codex CLI with its existing ChatGPT sign-in to produce one constrained decision. No OAuth token extraction or manually running bridge.                          |
| Optional MCP server/relay | Existing coding-agent chats discover skills and choose actions through seven guarded tools. This independent path is collapsed in the popup.                                                                                  |

## Skill format and generation

SKILL.md contains name/description frontmatter, readable instructions, typed parameters, checkpoints, safety rules and a schema-versioned JSON executable plan. Generation is deterministic and local; no recording is sent to an LLM to generate the draft. A user can edit the prose and plan, and validation rejects malformed or unsafe executable data.

Recorded controls use bounded structural selectors without page text, IDs or attribute values that may contain private data. Text/select values become placeholders. URLs retain origin and path depth while dropping credentials, actual path segments, query and fragment. The human-readable skill and executable block travel together; edits must keep them aligned.

The agent reads the complete skill and user's new request. Each step uses a fresh sanitized observation of eligible controls, not raw HTML/screenshots/field values. Selectors are hints: the model chooses a live control by purpose. Accessible labels and menu items are supported. Only a schema-checked action for the current step and known control can execute. Replacement values must come from the explicit request or locally supplied parameters.

## Extension-owned Run loop

The popup requires a signed-in library account, checks the chosen execution option, saves a new/edited owned skill, and starts a run against its saved version. The built-in example becomes an owned library copy on first Run; shared skills remain read-only.

The worker validates the starting page, observes the current step, asks the configured model for one decision, checks the decision, executes through the content script and validates the next checkpoint. Safe steps continue automatically. A protected action pauses for a target-bound preview. Approval executes only that pending action; subsequent steps then continue automatically. No external chat message or manual Next button is required.

Pause and Stop abort the pending model call and are checked before dispatch. An action already dispatched may finish. A worker interruption with an uncertain browser outcome pauses rather than replaying it. Popup closure does not stop a run. Browser restart clears session inputs and requires inspecting/restarting interrupted work.

## Model access

Personal OpenAI/Anthropic keys live only in trusted Chrome session storage and are cleared from the settings input after saving. Signed-out users cannot invoke the backend model API. The key passes over HTTPS through that backend only to the chosen provider; it is not saved in database rows, skill exports, prompts or logs. Provider/model names are remembered without the key. Logout removes the key.

Alternatively, a one-time installer copies the bundled subscription helper into the user's .show-me-once/native directory, registers the exact extension origin with Chrome and resolves the installed Codex CLI. Windows registration uses HKCU only. Chrome starts a hidden process over framed stdin/stdout. Disconnect cancels the model request. The CLI runs ephemerally in a temporary directory, with schema output, read-only access and shell/apps/plugins/subagents/web search disabled. Codex owns authentication and subscription limits. The helper currently supports Codex subscriptions; it is not a generic subscription-to-API proxy.

## Backend access and history

Web auth uses HttpOnly session cookies; extension requests omit cookies and use their own bearer session. Skills are visible only to owners and explicit recipients. Only owners edit or share. Runs and ordered logs belong to the person executing and reference a saved skill version. Logs contain step number, kind, status and timestamp, without new inputs, request text or live page labels.

The optional external MCP path reauthorizes cloud discovery for the current account, pins controllers/runs/tabs, uses single-use observations and keeps extension-only approval/Pause/Stop. Its activity remains local; the primary extension-owned Run path synchronizes backend history. Details: [MCP setup](mcp.md).

## Deployment and limits

The Next.js/oRPC app deploys to Vercel with PostgreSQL/Prisma and DATABASE_URL. No owner model key is necessary when users provide their own keys or use the local subscription helper. The extension is a production WXT MV3 build pointed at that deployed API; the reviewer kit contains no credentials.

Known challenge/connection-error pages block execution and human verification remains manual. Closed Shadow DOM is unsupported. Origin/path-depth checkpoints cannot establish repository/topic semantics; inspect actual results. This is a constrained skill-following agent, not an unrestricted planner for arbitrary websites. Current automated and live-model evidence, and pending Chrome acceptance, are recorded in [verification](verification.md).
