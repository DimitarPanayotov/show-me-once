# Architecture

## What runs where

| Layer | Responsibility |
| --- | --- |
| Content script | Records structural click/input/Enter/navigation metadata. Values and page text never leave the page during recording. During execution it verifies that a target is unique, visible, enabled, and non-sensitive before performing an action. |
| MV3 service worker | Owns recording, run progress, account sessions, and execution. It serializes state writes and browser actions. Automatic execution uses short scheduled ticks with a Chrome alarm as a recovery mechanism; it does not depend on an open popup. |
| Popup | Has focused Run and Record views. Stopping a recording creates a draft locally. Save feedback stays beside the action; timeline and Markdown are expandable. It collects new run inputs and offers Pause, Stop, confirmation, retry, and optional manual execution. |
| Next.js + oRPC | Provides authenticated skill versions, sharing, and per-step run history. The web app uses HttpOnly session cookies; the extension explicitly omits cookies and uses its own bearer token. |
| PostgreSQL + Prisma | Persists users, hashed sessions, skills, immutable versions, shares, runs, and step types/statuses. Run parameter values are not in the database schema. |

## Skill format and generalization

`SKILL.md` contains name/description frontmatter, parameter definitions, numbered instructions, checkpoints, safety rules, and a validated `json show-me-once` executable plan. Prose edits alone do not change executable actions.

Generation is deterministic and local. Form values are never recorded, so parameters replace input values rather than reproducing them. Click-only tasks ask for a target description, matched against visible local labels at run time. Structural selectors are hints; missing or ambiguous targets pause the run. URLs retain origin and path depth while dropping credentials, path text, query strings, and fragments. A checkpoint following an action also requires observing navigation.

This provides a predictable action list without sending page data to a model. It generalizes within the demonstrated flow and local target checks; it does not perform open-ended planning or recover from major page redesigns.

## Automatic execution and recovery

Run state, plan, execution mode, pause reason, confirmation index, and step logs are stored in `chrome.storage.local`. Inputs and the extension session remain in `chrome.storage.session`. Safe steps advance automatically; navigation waits for the target tab to finish loading. Confirmation, a failed target check, or a navigation timeout pauses execution. Confirming a protected action resumes automatic execution; manual mode advances only on explicit steps.

A short timer provides prompt progress while the worker is active. A repeating alarm recovers automatic work after worker suspension. Listeners are registered synchronously at startup, and persisted work is checked on each new worker lifetime. [Chrome's service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [alarm API](https://developer.chrome.com/docs/extensions/reference/api/alarms).

Before dispatching a browser action, the worker persists an in-flight marker. If the worker restarts without knowing the action's outcome, execution pauses for inspection instead of automatically repeating it. Pause and Stop interrupt scheduling immediately; an action already dispatched to a page cannot be undone. Run history sync is retried independently of the locally persisted action log.

## Safety and access

- Sensitive controls, including passwords, token fields, and payment fields, are excluded from recording. Raw values and page text are omitted from recordings and server logs.
- Submit controls, Enter submissions, and detected destructive/payment controls require explicit confirmation in both execution modes. The current detection is conservative and heuristic; it does not prove that every possible custom control is harmless.
- Only extension pages may invoke account, library, and run-control messages. The server retains cross-origin cookie protection; extension requests omit website cookies.
- Skill access is limited to owners and explicit recipients. Only an owner can edit versions or share a skill. A recipient can read and run it. Run history belongs to the person who ran it.
- Recording and drafts remain local until Save to library. The backend receives the skill and generic step types/statuses, without run input values.

## Current limits

Closed Shadow DOM controls are unsupported. A human-verification challenge must be completed by the user. URL checkpoints check origin/path depth, so the user should still inspect the actual result. Background recovery timing depends on Chrome alarm scheduling. Automatic execution has controlled-fixture coverage and completed two-input runs on Wikipedia, GitHub, and Open Library; these examples do not establish compatibility with arbitrary websites.
