# Architecture note

## Boundaries

| Layer | Responsibility |
| --- | --- |
| Content script | Observes clicks, non-sensitive input types, Enter and SPA navigation. It sends structural selectors and sanitized action metadata to the service worker. During replay it checks that the target is unique, visible and enabled, then executes one requested action. It never sends a form value or page text to the service worker. |
| MV3 service worker | Owns the active tab, serializes action writes, sanitizes every event, stores the recording/run in `chrome.storage.local`, and keeps run parameters and the account token in `chrome.storage.session`. It validates and advances one step per popup request. |
| Popup | Shows timeline, generates and edits the skill, collects per-run parameter values, shows step logs, and controls Stop/Confirm. It signs in to the library and loads/saves skills. |
| Next.js + oRPC | Validates account, skill, sharing and run requests. The browser app exposes the library and versions. |
| PostgreSQL + Prisma | Persists users, hashed sessions, skills, immutable versions, shares, runs and per-step status logs. Parameter values are not in the database schema. |

## Skill format

`SKILL.md` has `name` and `description` frontmatter, human-readable parameters, numbered actions, navigation checkpoints, and a `json show-me-once` executable plan. The plan is parsed and validated before any run; edits to prose alone do not alter executable actions. This keeps the document readable while giving the extension a deterministic, reviewable action list.

Recorded selectors are structural hints. For a click-only task, the generator asks for a target description so replay checks local link/button labels before choosing a target. For form tasks, parameter placeholders replace values that were never recorded. The runner stops on missing or ambiguous targets. URL origin and path depth are recorded; path text, queries, fragments and credentials are removed. A navigation checkpoint after an action requires observing a real navigation before it can pass, even if the sanitized URL shape is unchanged.

Generation is local and deterministic; no page text, passwords, search terms or recorded secret values are sent to an LLM. The present runner executes the validated plan step by step rather than asking a model to invent browser actions at runtime. This limits generalization to the recorded flow and the available local target checks.

## Safety and access

- Password, payment, token and other sensitive controls are ignored by the recorder. Form values are omitted from recordings and server logs.
- Submit controls, Enter submissions and detected destructive or payment controls require an explicit user confirmation. Stop halts subsequent steps.
- Web sessions use HttpOnly cookies. Extension tokens are stored in browser session storage; only the extension popup can invoke its account/library messages. Server session tokens are stored as hashes.
- Skill read access is limited to the owner and explicit recipients. Only the owner can create a new version or share/unshare it. Run history belongs to the user who ran the skill.
- Browser recordings and drafts stay local until the user chooses **Save to library**. The backend receives `SKILL.md` and step kind/status, never run parameter values.

## Known limits

Selectors can break after large page redesigns; the current runner stops instead of guessing. Controls inside closed Shadow DOM are outside the recorder. A site's human verification challenge must be completed by the user and is not part of a reusable skill. Local library and run-log sync passed an automated Chromium test; the deployed build still needs manual Chrome verification.
