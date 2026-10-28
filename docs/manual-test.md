# Current manual test — 0.5.1

Load the extension and follow its inline connection steps. No separate HTML guide is required. The full setup, two-input test, Stop test and recovery checks are in [the agent-led guide](mcp.md).

1. Verify version 0.5.1 and connect your coding agent once. No library account or owner API key is needed for local tests.
2. Try GitHub issue triage with microsoft/vscode + terminal + open + bug, then microsoft/TypeScript + inference + open + bug, using the same agent conversation and skill. Verify all four fields, search approval, Recently updated sorting, the opened issue's repository/topic, final status, and absence of manual Next buttons. The full workflow has 12 steps. A missing result must stop rather than silently selecting a navigation link.
3. Record a fresh task, edit its name/description/instructions continuously, choose Use with agent and run with two different inputs. The agent must discover the skill directly, without an exported file installation.
4. Check Pause/Resume, Stop before approval, popup closure, connector restart and worker recovery. No uncertain action may repeat automatically.
5. Sign into the library, save a version, edit/save another version, and share with a second registered account. Check owner-only editing, recipient access and local activity. MCP activity is not yet automatically associated with backend library history.
6. Sign out; cloud skills must disappear from agent discovery. Local skills and the example should remain usable.

Save actual URLs, tool results and visible outcomes. Automated document tests use a simulated popup and automated controller tests simulate browser execution; neither replaces the real model/Chrome test. No browser-control tool was used for the current change at the user's request.

The historical replay and extension-led model results remain in [verification](verification.md); they do not establish current MCP browser acceptance. The candidate must write their own personal reflection and record the demo video.
