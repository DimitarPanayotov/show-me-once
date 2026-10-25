# Manual verification

This is a record of checks reported by the candidate during local Chrome testing. It is not an automated browser test report.

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

## Remaining evidence

- All three chosen sites have two reported successful runs with different inputs from the same skill on each site.
- Verify that **Stop run** prevents further actions and that a mismatched page blocks a step.
- Verify a sensitive field is omitted from a recording and a destructive action requires confirmation.
- Save screenshots or a short video of the final runs for the submission.
