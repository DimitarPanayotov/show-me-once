# Manual verification

## Cached preset selection cleanup — extension 0.9.4

Removing the preset button did not clear an already selected built-in skill. The popup now removes that idle cached selection, clears its heading/editor fields and no longer supplies a hardcoded GitHub request. A running external task still exposes progress, approval and Stop; after it ends, an unchanged built-in selection returns to the empty recording screen. Saved owned copies and edited local documents are preserved.

Popup regression checks reproduce the already-selected current preset both signed in and signed out, the transition from an active external run to completion, and retention of saved/edited work. These checks execute the real popup code in a controlled document. Chrome acceptance remains manual; the optional MCP example is still available through explicit agent use.

## Recording-first interface — extension 0.9.3

The ready-made GitHub example button has been removed from the extension interface. New accounts start with Record a new task. The demo instructions now record GitHub Advanced Search, save the generated skill and run that same recording with new inputs. Existing popup checks exercise this recording-to-request flow and confirm there is no preset button or automatically opened task tab. All 17 popup checks pass. The optional MCP example and connector protocol are unchanged.

## Skill-list and account cleanup — extension 0.9.2

The popup previously mixed the built-in example and browser-local drafts into “Your skills.” External MCP runs could also import the unchanged example as a new dirty draft on each run, leaving duplicate local entries. Those runs now reuse the built-in identity. The example remains discoverable through MCP and the explicit Try GitHub issue triage button, but does not appear as an owned skill in the picker.

On reload, unchanged local MCP copies of the current example and its previous approval wording are removed. The check requires the MCP-generated identity, original name/description and matching document; recorded skills, cloud copies and edited documents are retained. Local drafts are visible and loadable only in their creating account, or in the signed-out workspace for unassigned older drafts. Account changes clear selection, requests and local activity while retaining drafts for their original owner. Signing in specifically to save/run a selected guest draft transfers only that draft. Active recordings/runs block account changes.

All 135 automated checks pass (25 shared, 10 helper/model, 73 extension, 24 MCP, 3 web). New checks cover old-copy cleanup without losing edits, repeated example runs, empty-account UI, local-skill access after switching accounts, recovering the original owner's work, explicit guest-draft transfer and credential clearing. These use controlled documents and the actual worker with simulated browser services; live acceptance of the new cleanup remains manual. Connector 0.9.0 and its published download remain unchanged; reloading the existing unpacked extension applies the cleanup without re-pairing.

## Delivery package — extension 0.9.1

The extension no longer shows the redundant external-agent request box or its copy button. The main editable request/Run flow and optional MCP connection setup remain available. All 16 existing popup checks, the extension type check and production extension build passed for this UI change. The reviewer kit is repackaged as 0.9.1; connector 0.9.0 and its published download bytes are unchanged.

On October 29, 2026, the candidate reported that the GitHub MCP test and native approval worked properly in Codex CLI. Startup initially failed because a verified 0.8.0 server/relay was still running. After stopping only those old connector processes, the configured 0.9.0 server initialized successfully and listed all eight tools, including review_action. The browser run and native approval were performed manually by the candidate; the assistant did not automate Chrome or answer the approval. This confirms the reported Codex test, not live acceptance in Claude Code or all other execution modes.

## Native MCP action approval — 0.9.0

The review_action tool requests a native form for the current protected action, showing its site, target and consequence. An explicit checked boolean response is required; the model has no approval flag. The extension approval remains available. HMAC-sealed expiring state, a consumed server nonce and a worker review bound to controller/bridge/connection/run/tab/step/browser-token prevent cross-run, stale and replayed consent. Live target revalidation stays in the existing executor. Unsupported form capability or rejected/cancelled/empty input leaves the action waiting; client policies are not modified.

All 127 automated tests pass (25 shared, 10 helper/model, 65 extension, 24 MCP, 3 web), including real legacy and 2026-07-28 SDK transports with two input sets and native form responses; an actual-worker automatic run with cancellation, replay rejection and one approved dispatch; expiry, tampered/cross-client state, controller/connection/tab changes, Pause and Stop. Workspace type checks and production package builds pass. Tests use simulated human form responses and browser API mocks. The candidate subsequently confirmed native approval in Codex CLI as recorded above; other client UIs remain unverified. No actual browser was automated for this change.

Extension/connector versions are both 0.9.0. The private relay protocol is 4, so close older coding-agent sessions after upgrading registration; browser pairing remains compatible. Earlier 0.7.0 and 0.8.0 download bytes remain immutable.


## Unsaved draft isolation — extension 0.8.1

The previous external-run guard blocked unrelated tasks when an edited library skill was open, even while signed out. Switching now retains the exact draft, remote skill identity and saved version in local recovery storage. Cached cloud edits never become local catalog skills. Recovery requires freshly authorized access as the original owner; a shared recipient receives only the server version. Reopening for editing allows an incomplete YAML header, while agent export/execution still rejects invalid instructions. The picker labels recoverable work as unsaved edits, and the popup explains that the other task can run immediately. Successfully saving removes only its matching recovery snapshot.

All 116 automated tests pass, including actual-worker signed-out Start with unfinished library edits, automatic task opening, recovery by the owner, shared-recipient isolation, no upload/model call during local MCP Start, and exact/newer snapshot preservation. Workspace type checks and the production extension/reviewer package pass. These use Chrome API mocks and actual protocol transports; live Chrome acceptance remains manual. The deployed connector stays 0.8.0, with its package bytes unchanged. No MCP re-registration, new account or connection approval is required for this fix.


## Automatic MCP startup — 0.8.0

Normal MCP use now starts from an agent request: the connector can wake installed Chrome after a prior pairing, and Start opens a new dedicated task tab without any manual page opening or tab selection. The builtin routes to GitHub Advanced Search; origin-only recordings resolve directly. Legacy redacted routes require a public starting address in chat, or an explicitly saved start_url header. Raw recorded paths remain uncaptured. Start reauthorizes catalog access and validates parameters before opening a tab; arbitrary undiscovered Markdown cannot navigate the browser.

All 112 automated tests pass (24 shared, 10 model/helper, 57 extension, 18 MCP, 3 web). Actual-worker mocks cover unrelated focused tabs, creating a window when none exists, waiting for initial load even when its event races, legacy route input, unsaved-draft/undiscovered-plan guards and real run IDs after partial storage failure. Real HTTP/WebSocket tests cover wake coalescing, no wake before pairing or on heartbeat, reconnection and cancelled requests without delayed dispatch. Fixed process-launch arguments are tested by injection; no real browser is launched.

Workspace type checks, production extension/reviewer packaging, isolated packaged setup and real SDK/npx transport checks pass. Live Chrome startup/profile selection and the end-to-end Codex/Claude browser task still require manual acceptance. The noisy Chrome attachment supplied in this session contains the generated worker source rather than an exception message; it does not establish the cause of a runtime exception.

The connector package is now 0.8.0, so older agent registrations need the updated install link/command once and an agent restart. Existing trust files remain compatible; an old live relay is not silently reused. Previous verification entries below describe their respective versions, including the replaced manual tab-selection approach.

## MCP target-tab selection — extension 0.7.2

A live retry reported START_PAGE_REQUIRED while the candidate had GitHub Advanced Search open. MCP start previously depended on the service worker's currentWindow lookup. It now uses lastFocusedWindow, the Chrome-documented service-worker pattern, and can find one exact public starting page for the built-in GitHub plan across normal Chrome windows. It does not infer a page from a matching origin/path depth or choose among duplicate starting pages.

The optional Use this tab for the agent button binds the popup's tab explicitly. Only extension pages may set it, only normal non-incognito websites are accepted, and the choice cannot change during a run/recording. Each start revalidates the chosen tab; running actions keep their original tab binding. Diagnostics exclude unrelated origins and raw paths/query values.

All 107 automated tests pass, including actual-worker starts with a different window focused, explicit tab binding, ambiguity/loading/closed-tab rejection, same-depth wrong-page rejection, privacy checks and the popup control. Workspace type checks and the extension/reviewer build pass. Live Chrome acceptance requires the candidate's retry. The MCP package remains 0.7.0 and needs no registration or backend change.

## MCP start diagnostics — extension 0.7.1

The transport previously replaced every thrown start error with a generic rejection, hiding whether another task was active, an edited cloud draft needed saving, the starting page was wrong or Chrome denied page access. Known application errors now produce fixed, actionable messages in both MCP results and the extension. Unexpected exception text remains private. A persisted run whose start response fails returns its ID as an unknown outcome rather than encouraging a duplicate start.

The actual-worker test starts the built-in GitHub skill while signed out, on Advanced Search, with no backend/model request. Additional worker tests reproduce start-page and unsaved-cloud-draft blockers and assert that no new run ID is invented and edits remain intact. Error redaction and separate connection/run-error popup behavior are covered. Imported MCP drafts now retain their frontmatter name/description consistently.

All 101 automated tests, workspace type checks and the extension/reviewer build pass. The MCP package remains 0.7.0; no server registration or web deployment is needed for this extension-only correction. The reported live failure needs a retry with the new diagnostic message to establish its exact cause.

## Local MCP connection — 0.7.0

The optional MCP setup now provides an agent picker: Codex/Claude Code receive a one-time registration command, Cursor/VS Code receive install links, and other clients receive configuration. Commands launch a self-contained versioned download through npx, eliminating dependency on an extracted folder path. Node.js 24 remains required. The primary in-extension request/Run settings are independent.

First use automatically creates private connector settings and starts the shared relay. The extension and authenticated agent show the same six-digit code from a signed, nonce-bound transcript. Only an extension-page approval grants browser access; no extension ID or long-lived secret is copied. Trust persists across automatic idle shutdown/restart. Reconnect verifies the pinned public key before disclosing its credential. Forget while connected persists revocation. Pending-pairing heartbeat traffic keeps the MV3 worker alive while the user compares codes, within the two-minute approval limit.

The automated suite has 96 tests: client-specific install/config formats, actual popup approval/status behavior, real stdio first-use without settings or ID, discovery-before-browser timing, approval gating, retained trust after restart, changed-identity rejection without token disclosure, website-Origin rejection, revocation, and existing guarded run/Stop behavior. A fresh-cache npx check downloads and launches the actual tarball, discovers all seven tools and initializes settings without an extension ID. No existing agent configuration is changed. Workspace type checks, the extension/reviewer build and Next.js production compile pass. Vercel deployment and its migration check passed with no pending migrations. The live connector download returns 200 and matches the packaged SHA-256; the 18-file reviewer kit passes its isolated offline-setup and popup checks. Protocol fixtures use controlled documents, not browser automation; real client install-button behavior and live Chrome acceptance remain manual.

## Skill metadata synchronization — 0.6.2

The Name/Description fields and the SKILL.md YAML header previously persisted independently, so a renamed skill could display one name and export another. Both editors now synchronize these values in either direction using a shared YAML parser. Partial edits remain editable without losing focus. Invalid headers block saving/export; the API also aligns the header to submitted metadata before creating a version. Existing saved versions and workflow bodies are not rewritten.

Opening an editable legacy skill repairs only its local header and marks the draft unsaved; Save changes creates the corrected library version. Read-only shared versions and active runs are not migrated. The built-in example now uses its actual frontmatter metadata.

All 90 automated tests pass, including the supplied name mismatch, forward/reverse edits, continuous focus, incomplete YAML, quotes/multiline descriptions, CRLF/BOM preservation, alias/duplicate-key rejection, and actual create/update API contracts with a fake database. Tests assert that recorded instructions and the executable plan remain unchanged. Workspace type checks and production builds pass. Chrome interaction remains a manual acceptance step under the no-browser-automation constraint. The Vercel production build and migration check passed with no pending migrations; the neutral live address serves the updated app. The rebuilt 18-file reviewer kit passes isolated setup and manifest/popup checks without modifying the user configuration.

## Moving-menu click regression — 0.6.1

A candidate-recorded GitHub workflow stopped at step 15 of 18 after Recently updated sorting. The supplied SKILL.md contained consecutive clicks on the same menu item with long and shortened ancestor paths: the early pointer event and later click had been assigned different IDs after the menu element moved. The paused run correctly refused to invent a target after the menu closed.

The recorder now keeps the interactive DOM element privately alongside the early gesture ID and reuses the original selector/ID if the same element moves before click. No DOM reference, label or field value is serialized. Intentional later clicks and click-only fallback events remain separate. A controlled-document regression failed against 0.6.0 and passes with the fix, including the worker's actual appendAction deduplication.

All 82 automated tests, workspace type checks and the production extension/reviewer-kit build pass. The regression test verifies one stored action per gesture, preservation of a second intentional click, and click-only fallback without capturing labels or URL queries. Live acceptance of the corrected saved skill awaits the candidate's retry.

A corrected copy of the supplied skill removes only original step 15, keeps all four parameters and every other action, and renumbers the plan/prose to 17 steps. Saved skills and active runs are not silently migrated. Apply the corrected text as a new skill version and start a new run; a new recording is unnecessary. The subscription helper and backend API are unchanged and need no reinstall/deployment for this fix.

## Extension-owned Run — 0.6.0

The main popup now accepts an editable task request and starts the extension-owned automatic agent loop. External coding-agent integration is optional and collapsed. Agent settings support session-only personal OpenAI/Anthropic keys or a one-time Chrome native-messaging helper using a Codex subscription. New/edited owned skills are saved before Run and per-step backend history is tied to the saved version.

Eighty-one automated tests pass on Windows: actual popup/background-worker tests, two inputs through both execution transports, automatic continuation after approval, Pause/Resume without chat, Stop during a model request, private credential boundaries, real native-host processes, framed-message validation and a Windows launcher path containing spaces/ampersands. API contracts exercise both personal-key providers without owner environment keys and reject anonymous or secret-containing requests before model calls. The twelve-step GitHub flow remains covered by controlled-document tests.

The bundled subscription helper made two real Codex decisions for Foundation and Frankenstein and selected the moved Search topic control over a Newsletter control. This used an isolated native protocol process and the existing Codex sign-in, without browser automation. API providers have contract tests, not live credential tests.

Workspace type checks and the Next.js production compile pass. The default local web build stopped at its migration step because the development PostgreSQL service at localhost:6543 was offline; there are no schema changes. Hosted deployment runs migrations against its configured database. Real Chrome/native-host discovery and full live GitHub acceptance remain pending under the no-browser-automation constraint.

The production Vercel build and database migration check passed with no pending migrations. The neutral app address serves the new deployment; page/health checks returned 200, and a non-secret schema probe confirmed the new personal-key endpoint validation without making a provider call. The extracted 18-file kit passes four native-helper and four optional-MCP process/protocol checks plus isolated setup verification. It contains no credentials or separate HTML guide. Real provider-key tests and Chrome acceptance remain distinct pending checks.

## Inline onboarding and issue triage — 0.5.1

The default example is now a twelve-step public GitHub issue-triage workflow: four inputs, protected submission, sort menu, first matching result, and issue-page checkpoint. First-use connection guidance is inside the popup; no START-HERE.html is required or packaged.

Controlled-document tests execute the actual content script and run controller for microsoft/vscode + terminal and microsoft/TypeScript + inference. They verify native text/select input, approval before submission, accessible menu-item execution, sort-before-open ordering, sanitized link destinations and parameter-free persistent logs. A separate test checks recording a nested menu-item click. The model/provider boundary rejects unredacted destination URLs.

The current suite has 66 passing automated tests. Inline first-launch guidance and clean starter migration have document tests; user-authored local recordings are preserved. A SPA-navigation regression verifies that a fresh observation survives the delayed URL poll and old observations are rejected after a query change.

Workspace type checks and production extension/connector/reviewer-kit builds pass. The extracted kit passes four stdio/lifecycle checks and a one-time setup smoke check using temporary settings without changing the user's agent registration. Its popup has unique IDs, the inline connection steps, and no separate HTML guide; the manifest is 0.5.1.

Static HTTP reads confirmed GitHub Advanced search's repository/state/label controls and public issue-search results with a Sort by control. This is DOM evidence, not a real browser or model run. The reference skill is a built-in example; live two-input GitHub acceptance is still pending. No Chrome automation was used.

## Agent-first reviewer flow — 0.5.0

The current popup exposes one agent-led flow. In-memory document tests execute the actual popup code and check the example handoff, no provider/replay controls, recording without an account, continuous editor focus, direct skill discovery, and action-specific approval/Pause/Resume/Stop. Catalog tests check current-account cloud access and local secret/invalid-skill exclusion. Real stdio protocol tests discover seven tools and read an example without installing a skill file. Installer tests check safe MCP-registration arguments and failure reporting.

The current suite has 60 passing automated tests. Workspace type checks and the production extension/connector/reviewer-kit builds pass. A static HTTP read of Wikipedia confirmed its search form uses a same-origin redirect endpoint; regression tests cover that path, actual content-script discovery/approval/dispatch in an in-memory document, and cross-origin/credential/unsafe-scheme rejection. No browser was controlled for this check.

These checks use simulated Chrome storage/content execution. A real model and ordinary Chrome have not completed acceptance of this version under the user's no-browser-automation constraint. The reviewer kit includes the exact manual procedure; do not claim it has already passed. Older real-site evidence below applies to earlier execution paths.

## Agent-led MCP preview — 0.4.1

This is a separate path from all earlier browser evidence. Non-browser automated tests exercise the official MCP SDK over stdio, authenticated HTTP/WebSocket relay, strict tool contracts, controller/run/tab/step binding, stale and single-use observations, extension-only approval, two replacement inputs, Stop, disconnect/timeout recovery, and controller lease expiry. Browser/content execution is simulated in the vertical test. Additional real-process tests cover automatic connector startup, concurrent clients, idle shutdown, forced-crash recovery and restart with stable pairing; the extension connection test simulates Chrome storage and sockets to verify remembered pairing and identity refresh. No new Codex decision process or browser automation is used.

All 48 automated tests and the workspace TypeScript checks pass. The extension ZIP and standalone MCP relay/server bundles build successfully. Matching edited drafts are preserved; a different external skill cannot silently replace unrelated unsaved work. These checks establish the tested protocol and simulated execution behavior, not real Chrome acceptance.

**Real agent/browser acceptance is pending.** This conversation is not connected to the newly configured MCP server, and the user explicitly prohibited browser automation for this change. The manual Codex/Chrome procedure and exact blocker are in [MCP setup](mcp.md). Earlier real-site runs below must not be presented as verification of the MCP path. The ignored system guide was updated in place and remains excluded from Git.

The three-site table records checks reported by the candidate during local Chrome testing. Automated production checks are documented separately below.

| Site         | Recorded task                   | New input    | Result            | Evidence                                                                                                                      |
| ------------ | ------------------------------- | ------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Wikipedia    | Search from `www.wikipedia.org` | Grace Hopper | Passed (reported) | Five steps completed; search submit required confirmation; the candidate reported the destination opened.                     |
| Wikipedia    | Same recording and skill        | Alan Turing  | Passed (reported) | Five steps completed with confirmation; destination was `https://en.wikipedia.org/wiki/Alan_Turing`.                          |
| GitHub       | Public repository search/filter | actions      | Passed (reported) | Five steps completed; Enter required confirmation; destination was `https://github.com/orgs/github/repositories?q=actions`.   |
| GitHub       | Same recording and skill        | docs         | Passed (reported) | Five steps completed with confirmation; destination was `https://github.com/orgs/github/repositories?q=docs`.                 |
| Open Library | Advanced Search by title        | Foundation   | Passed (reported) | Five steps completed; search submit required confirmation; destination was `https://openlibrary.org/search?title=Foundation`. |
| Open Library | Same recording and skill        | Frankenstein | Passed (reported) | Five steps completed with confirmation; destination was `https://openlibrary.org/search?title=Frankenstein`.                  |

The run log showed step kind, status and generic result text. The candidate's pasted logs contained no search terms. Recorded form values are absent from the generated `SKILL.md`; parameters are supplied when running.

## Repeat a skill on another input

1. Open the starting page in Chrome and open the extension popup.
2. Enter a different value for the generated parameter; do not start a new recording.
3. Click **Start run**, then **Next step** once per step.
4. If prompted, click **Confirm this action** only after checking the intended target.
5. Reopen the popup after navigation, finish the checkpoint, and inspect the run log for success and for absence of parameter values.

## Production sign-in regression — extension 0.1.1

- Reproduced the reported plain-text `Forbidden` / JSON parsing error in Chromium by signing in on the deployed website before signing in through extension 0.1.0.
- Extension 0.1.1 explicitly omits website cookies and authenticates library requests with its own bearer session. The server's cross-origin cookie protection is unchanged.
- A fresh Chromium profile passed website cookie login, extension login, saving a skill, and extension logout while preserving the website session. A cookie-authenticated request from an unrelated origin still returned 403.
- Five API regression tests cover cookie omission, bearer authentication, plain-text errors, structured errors, and invalid success responses.

## Automatic runner and interface — extension 0.2.0

- The controlled browser fixture passed real recording, automatic draft creation, excluded password/input values, local save progress/success, and collapsed timeline/Markdown.
- A saved search skill completed automatic runs with Alpha and Beta. Submission paused for explicit confirmation; navigation and the final checkpoint completed with the popup closed.
- Pause/Resume, Stop before submission, optional manual mode, duplicate-target blocking, and parameter-free server logs passed.
- The extension worker was deliberately terminated during a persisted automatic run. The alarm woke a new worker and all remaining checkpoints completed without opening the popup.
- Nineteen unit tests and the workspace typecheck pass. The production web build passes, and the deployed primary buttons have a blue background, white text, and visible outlines for secondary actions.
- The public app and current release use neutral Show Me Once branding.

Real-site automatic runs were also verified using one new recording per site:

| Site         | Demonstration                              | New automatic inputs      | Result                                                         |
| ------------ | ------------------------------------------ | ------------------------- | -------------------------------------------------------------- |
| Wikipedia    | Ada Lovelace search                        | Grace Hopper; Alan Turing | Both completed, including www → en cross-origin navigation.    |
| GitHub       | Organization repository search for copilot | actions; docs             | Both completed, including Enter submission and SPA navigation. |
| Open Library | Advanced Search Title: Dune                | Foundation; Frankenstein  | Both completed with the expected title query URLs.             |

Each run advanced safe steps automatically, paused for explicit submission confirmation, and completed its final checkpoint. The popup was closed after confirmation acceptance while navigation and checkpoint execution continued.

## Action-specific approval — extension 0.2.1

- Twenty-three unit tests pass, including action classification, readable approval text, bounded labels, and run/step-bound preview validation.
- Focused browser checks passed for search/delete/payment/Enter previews, popup reopening, changed-label and replaced-element reapproval, expired-preview rebuilding without execution, stale consent rejection, Stop, and excluding preview labels/input values from persistent logs. These tests use a controlled local fixture and require no new account.
- A fresh real Wikipedia recording produced the live preview **Submit search on www.wikipedia.org**, **Click the “Search” button**, and **Submit search & continue**. Approval completed the automatic Grace Hopper search. The popup was visually checked at 420 × 600.

## In-extension AI agent — extension 0.3.0 (27 October 2026)

- Local Codex is a real model provider under the existing ChatGPT sign-in. The extension passes SKILL.md, the task request, and safe live controls to a normalized provider adapter; it validates and executes the returned action. These runs do not use recorded replay mode.
- The controlled browser test passed with six real Codex decisions: extraction of Foundation/Frankenstein from task requests, a moved search input, an untouched decoy field, popup closure during inference, protected-action confirmation, Stop during inference, and omitted input/password values in persistent extension state. The standalone bundled helper was used in the final fixture check.
- Known human-verification and browser connection-error pages now block a checkpoint. A verification page must not be reported as a successful search merely because its origin/path depth matches.
- Thirty-one unit tests and the workspace typecheck pass. OpenAI and Anthropic adapters have network-contract tests; they have not been exercised with live provider credentials.

| Site                 | New inputs through the Codex agent | Verified outcome                                                                                                                                                                                                                                                                |
| -------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wikipedia            | Grace Hopper; Alan Turing          | Both reached the correct article URLs.                                                                                                                                                                                                                                          |
| GitHub               | actions; docs                      | Both reached the expected organization repository search URLs.                                                                                                                                                                                                                  |
| Python documentation | asyncio; pathlib                   | Both reached the correct query URLs and populated visible search results. One freshly recorded json search skill was reused unchanged for both requests.                                                                                                                        |
| Open Library         | Foundation; Frankenstein           | The agent filled and submitted both titles, but the site redirected to human verification. These are not completed searches. A subsequent manual attempt encountered a connection-error page, and independent requests timed out. Live end-result verification remains pending. |

The eight attempts used 24 real model decisions. Six runs on three live websites completed. Earlier Open Library evidence above belongs to the previous recorded executor and must not be presented as successful 0.3.0 agent verification. Python documentation was added as the third verified agent demonstration because Open Library was unavailable.

The selected demo mode requires Node.js and a local Codex helper. This is a documented deviation from the original extension-only setup goal. A hosted provider can use the same browser action contract once server credentials are configured. The candidate's personal report and demo video remain separate deliverables.

## Popup editor and agent connection — extension 0.3.1

- Reproduced the single-character focus loss against 0.3.0. The editor was reattached on each storage refresh; name/description values were also trimmed on every keystroke.
- Focused Chromium checks pass for continuous typing in all three fields in both Run and Record, spaces, cursor placement, selection replacement, and persistence after reopening. The editor now moves only when switching views, and editing preserves the entered text.
- Pairing shows progress and inline failure feedback. A green connected message remains visible outside collapsed settings. The popup verifies helper health on opening and through Check connection; an unavailable helper disables starting a local-agent run. Browser checks cover success, failure, reopening, unavailability, rechecking, and disconnecting with a stubbed health transport, without invoking a model or touching a real helper.
- All 31 unit tests, workspace typechecks, and the extension ZIP build pass. The existing 0.3.0 helper remains compatible.

## Remaining manual evidence

- Perform a final user acceptance check of the redesigned popup in regular Chrome.
- Complete Open Library's human check once the site is reachable, then verify the Foundation/Frankenstein result pages through the AI agent.
- Exercise a dummy destructive/payment control manually when preparing the demonstration; automated tests already cover protected submission, privacy, ambiguous targets, and Stop.
- Save screenshots or a short video of the final runs for the submission.
