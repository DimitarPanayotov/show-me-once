# Manual verification

The three-site table records checks reported by the candidate during local Chrome testing. Automated production checks are documented separately below.

| Site | Recorded task | New input | Result | Evidence |
| --- | --- | --- | --- | --- |
| Wikipedia | Search from `www.wikipedia.org` | Grace Hopper | Passed (reported) | Five steps completed; search submit required confirmation; the candidate reported the destination opened. |
| Wikipedia | Same recording and skill | Alan Turing | Passed (reported) | Five steps completed with confirmation; destination was `https://en.wikipedia.org/wiki/Alan_Turing`. |
| GitHub | Public repository search/filter | actions | Passed (reported) | Five steps completed; Enter required confirmation; destination was `https://github.com/orgs/github/repositories?q=actions`. |
| GitHub | Same recording and skill | docs | Passed (reported) | Five steps completed with confirmation; destination was `https://github.com/orgs/github/repositories?q=docs`. |
| Open Library | Advanced Search by title | Foundation | Passed (reported) | Five steps completed; search submit required confirmation; destination was `https://openlibrary.org/search?title=Foundation`. |
| Open Library | Same recording and skill | Frankenstein | Passed (reported) | Five steps completed with confirmation; destination was `https://openlibrary.org/search?title=Frankenstein`. |

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

| Site | Demonstration | New automatic inputs | Result |
| --- | --- | --- | --- |
| Wikipedia | Ada Lovelace search | Grace Hopper; Alan Turing | Both completed, including www → en cross-origin navigation. |
| GitHub | Organization repository search for copilot | actions; docs | Both completed, including Enter submission and SPA navigation. |
| Open Library | Advanced Search Title: Dune | Foundation; Frankenstein | Both completed with the expected title query URLs. |

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

| Site | New inputs through the Codex agent | Verified outcome |
| --- | --- | --- |
| Wikipedia | Grace Hopper; Alan Turing | Both reached the correct article URLs. |
| GitHub | actions; docs | Both reached the expected organization repository search URLs. |
| Python documentation | asyncio; pathlib | Both reached the correct query URLs and populated visible search results. One freshly recorded json search skill was reused unchanged for both requests. |
| Open Library | Foundation; Frankenstein | The agent filled and submitted both titles, but the site redirected to human verification. These are not completed searches. A subsequent manual attempt encountered a connection-error page, and independent requests timed out. Live end-result verification remains pending. |

The eight attempts used 24 real model decisions. Six runs on three live websites completed. Earlier Open Library evidence above belongs to the previous recorded executor and must not be presented as successful 0.3.0 agent verification. Python documentation was added as the third verified agent demonstration because Open Library was unavailable.

The selected demo mode requires Node.js and a local Codex helper. This is a documented deviation from the original extension-only setup goal. A hosted provider can use the same browser action contract once server credentials are configured. The candidate's personal report and demo video remain separate deliverables.

## Remaining manual evidence

- Perform a final user acceptance check of the redesigned popup in regular Chrome.
- Complete Open Library's human check once the site is reachable, then verify the Foundation/Frankenstein result pages through the AI agent.
- Exercise a dummy destructive/payment control manually when preparing the demonstration; automated tests already cover protected submission, privacy, ambiguous targets, and Stop.
- Save screenshots or a short video of the final runs for the submission.
