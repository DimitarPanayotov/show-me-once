# Manual acceptance — 0.6.2

1. Reload the existing extension and confirm 0.6.2. External coding agent must remain optional and collapsed. No separate HTML guide.
2. Under Agent settings either save a personal OpenAI/Anthropic key (session only), or install subscription-helper/Install subscription helper.cmd once for the current extension ID and choose Check subscription. No terminal or external agent chat should remain necessary.
3. Sign into the library. Choose Try GitHub issue triage. In the extension type: Find open issues in microsoft/vscode about terminal with label bug. Sort by recently updated and open the first matching issue. Click Run.
4. Check all four fields. Before search, verify an action-specific Submit search preview identifying the Search button and consequence. Approve once. Remaining steps must continue automatically without a chat message or Next button.
5. Verify Recently updated sorting, an actual matching issue in the requested repository, Completed all 12 steps, and generic Run activity. Missing results must stop. Inspect backend history in the web library; input values must be absent.
6. Return to Advanced search; reuse the same skill with microsoft/TypeScript, inference, open and bug. Do not record again.
7. Pause during a model decision, then Resume. Stop another run before approval. No later action may execute after Stop; an already-dispatched action may finish.
8. Record a fresh task once, Stop & create skill, edit all fields continuously, and choose Run this skill. Save explicitly or let Run save it. Run twice with new inputs; local recordings and the built-in example are distinct tests.
9. Save a new version; share through the web library with another registered account. Recipient can run/read but cannot edit the owner's skill. Check its own backend run history.
10. Close/reopen the popup mid-run. Restart the worker with an uncertain outcome: pause safely. Restart Chrome: helper should still be installed, while API keys and run inputs require re-entry.
11. Optional: expand External coding agent, reconnect the existing MCP integration and confirm its discovery/approval/Stop path still works. Main Run must work with that integration disconnected.

Record actual URLs, tool results and visible outcomes. Automated tests cover controlled documents and simulated Chrome services; they do not establish live Chrome or model performance. No browser-control tool is used under the current user constraint. The candidate writes their own short report and records the demo video.

Recording regression: select a dropdown item whose menu is moved/closed by the page during the gesture. Its pointerdown and click must produce one recorded action. A second deliberate click and keyboard-only click must still record independently. Existing duplicate steps in saved skills require an explicit edited version; the recorder fix does not silently rewrite stored skills or active runs.

Metadata regression (0.6.2): open an owned saved skill. If its field name differed from SKILL.md, confirm they now match and the badge says Draft. Save changes once, then reopen it and confirm Saved. Rename the skill and change its description; check both header values update immediately. Edit those header values directly and check the fields update without losing focus. Download SKILL.md and compare the values. The instructions/parameters/JSON steps must be unchanged. Repeat rename/save/reopen in the web library. An unfinished YAML edit must stay editable and show a clear error rather than exporting inconsistent metadata.
