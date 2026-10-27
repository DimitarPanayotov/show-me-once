# Recorded example skills

These SKILL.md files were generated from one public browser demonstration per task. Each unchanged skill was then used by the local Codex agent with two new natural-language requests, leaving explicit parameters empty.

| Skill | Starting page | Demonstration | New requests |
| --- | --- | --- | --- |
| [Wikipedia](wikipedia-search/SKILL.md) | https://www.wikipedia.org/ (English) | Ada Lovelace | Search Wikipedia for Grace Hopper; Search Wikipedia for Alan Turing |
| [GitHub repositories](github-repository-search/SKILL.md) | https://github.com/orgs/github/repositories | copilot | Search repositories for actions; Search repositories for docs |
| [Python documentation](python-docs-search/SKILL.md) | https://docs.python.org/3/search.html | json | Search Python documentation for asyncio; Search Python documentation for pathlib |

The agent selected live controls and extracted replacement text from each request. The test harness approved the displayed public search submission; the model never approved itself. Results are in [agent-results.json](agent-results.json), including the two incomplete Open Library attempts. Known human-verification and connection-error pages now pause the runner. See [verification](../docs/verification.md) for the distinction between earlier replay checks and actual agent runs.

These are snapshots of real pages, whose structure can change. To reproduce from scratch, use the [manual test guide](../docs/manual-test.md) or [browser test harness](../docs/browser-testing.md). No site-specific selectors are built into the application runtime.
