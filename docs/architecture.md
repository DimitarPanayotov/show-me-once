# Architecture

## Agent-led MCP path (0.4.0)

An existing coding-agent session owns the model and loads an exported skill. Its stdio MCP server forwards typed commands through a separate authenticated loopback relay at port 4320. The extension opens the outbound WebSocket and retains run/tab/step binding, fresh control observations, target validation, confirmation, Pause and Stop. This path does not import or invoke the Codex decision adapter. The extension-led modes below remain separate. See [MCP design and setup](mcp.md) for process ownership, pairing, lifecycle, credential storage and exact Codex configuration. Browser acceptance remains pending under the requested non-browser testing constraint.

## What runs where

| Layer | Responsibility |
| --- | --- |
| Content script | Records structural click/input/Enter/navigation metadata. Values and page text never leave the page during recording. During execution it verifies that a target is unique, visible, enabled, and non-sensitive before performing an action. |
| MV3 service worker | Owns recording, run progress, account sessions, and execution. It serializes state writes and browser actions. Automatic execution uses short scheduled ticks with a Chrome alarm as a recovery mechanism; it does not depend on an open popup. |
| Agent provider adapter | Receives the complete skill, task request, current allowed step, and sanitized live controls. It returns one typed action. OpenAI and Anthropic adapters call the hosted model; the local Codex adapter uses an ephemeral CLI invocation under the user's existing sign-in. |
| Popup | Has focused Run and Record views. Stopping a recording creates a draft locally. Save feedback stays beside the action; timeline and Markdown are expandable. It collects new run inputs and offers Pause, Stop, confirmation, retry, and optional manual execution. |
| Next.js + oRPC | Provides authenticated skill versions, sharing, and per-step run history. The web app uses HttpOnly session cookies; the extension explicitly omits cookies and uses its own bearer token. |
| PostgreSQL + Prisma | Persists users, hashed sessions, skills, immutable versions, shares, runs, and step types/statuses. Run parameter values are not in the database schema. |

## Skill format and generalization

`SKILL.md` contains name/description frontmatter, parameter definitions, numbered instructions, checkpoints, safety rules, and a validated `json show-me-once` executable plan. The plan constrains allowed action kinds and checkpoints. In agent mode the model also reads the prose and selects a current live control; in recorded mode the plan is interpreted directly.

Generation is deterministic and local. Form values are never recorded, so parameters replace input values rather than reproducing them. Click-only tasks ask for a target description, matched against visible local labels at run time. Structural selectors are hints; missing or ambiguous targets pause the run. URLs retain origin and path depth while dropping credentials, path text, query strings, and fragments. A checkpoint following an action also requires observing navigation.

In AI mode the content script builds at most 60 eligible control descriptors: temporary ID, role, bounded/redacted label, input kind, and structural hint. It excludes raw page text, HTML, field values, sensitive controls, and credential/payment forms. The agent can choose a moved control from those live candidates. It cannot return arbitrary JavaScript, invent a target outside the snapshot, change the allowed step kind, or approve an action. Major workflow redesigns remain outside this constrained agent's scope.

Task requests and replacement values stay in browser session storage and are omitted from persistent application logs. A natural-language task request is intentionally sent to the model so it can extract new non-secret inputs. Explicit parameter values can remain locally bound. The local helper does not receive library credentials or copy Codex OAuth tokens; Codex owns its sign-in. See [agent setup](agent.md) for provider and deployment details.

## Automatic execution and recovery

Run state, plan, execution mode, pause reason, confirmation index, and step logs are stored in `chrome.storage.local`. Inputs and the extension session remain in `chrome.storage.session`. Safe steps advance automatically; navigation waits for the target tab to finish loading. Confirmation, a failed target check, or a navigation timeout pauses execution. Confirming a protected action resumes automatic execution; manual mode advances only on explicit steps.

A short timer provides prompt progress while the worker is active. A repeating alarm recovers automatic work after worker suspension. Listeners are registered synchronously at startup, and persisted work is checked on each new worker lifetime. [Chrome's service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [alarm API](https://developer.chrome.com/docs/extensions/reference/api/alarms).

Before dispatching a browser action, the worker persists an in-flight marker. If the worker restarts without knowing the action's outcome, execution pauses for inspection instead of automatically repeating it. Pause and Stop interrupt scheduling immediately; an action already dispatched to a page cannot be undone. Run history sync is retried independently of the locally persisted action log.

An in-flight model decision is cancellable and does not itself operate the browser. Stop/Pause abort the fetch; the local helper stops its Codex process. A restarted worker can safely request a new decision before dispatch, while an unknown browser action outcome still requires inspection. Snapshot IDs and live-element fingerprints prevent a delayed model response from acting on a replaced control.

## Safety and access

- Sensitive controls, including passwords, token fields, and payment fields, are excluded from recording. Raw values and page text are omitted from recordings and server logs.
- Submit controls, Enter submissions, and detected destructive/payment controls require explicit confirmation in both execution modes. The current detection is conservative and heuristic; it does not prove that every possible custom control is harmless.
- Confirmation previews name the live action, control label, origin, and likely effect; cross-origin form destinations are shown separately. Preview labels and approval tokens stay in `chrome.storage.session` and are removed after the action or Stop. They never enter recordings, skill Markdown, persistent run state, or backend logs. Consent is bound to the run, step, live DOM element, and action signature; a changed/replaced target requires fresh approval. Rebuilding a missing preview cannot execute an action.
- Only extension pages may invoke account, library, and run-control messages. The server retains cross-origin cookie protection; extension requests omit website cookies.
- Skill access is limited to owners and explicit recipients. Only an owner can edit versions or share a skill. A recipient can read and run it. Run history belongs to the person who ran it.
- Recording and drafts remain local until Save to library. The backend receives the skill and generic step types/statuses, without run input values.

## Current limits

Closed Shadow DOM controls are unsupported. A human-verification challenge must be completed by the user. Known challenge and connection-error pages block completion. URL checkpoints otherwise check origin/path depth, so the user should still inspect the actual result. Background recovery timing depends on Chrome alarm scheduling. The AI agent completed two inputs each on Wikipedia, GitHub, and Python documentation. Open Library's final agent verification is pending; the earlier recorded executor had completed it. These examples do not establish compatibility with arbitrary websites.
