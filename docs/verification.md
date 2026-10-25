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

## Remaining evidence

- All three chosen sites have two reported successful runs with different inputs from the same skill on each site.
- Verify that **Stop run** prevents further actions and that a mismatched page blocks a step.
- Verify a sensitive field is omitted from a recording and a destructive action requires confirmation.
- Save screenshots or a short video of the final runs for the submission.
