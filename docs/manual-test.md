# Manual testing

Use the [live app](https://show-me-once-dimitar.vercel.app) and both ZIPs from [the current release](https://github.com/DimitarPanayotov/show-me-once/releases/tag/v0.3.1-demo). Extract the extension and load the folder containing `manifest.json` through **Load unpacked** at `chrome://extensions`. Existing source installations can use **Reload** after stopping a run. Confirm version 0.3.1. Follow [local agent setup](agent.md) to start the helper and pair it. This mode requires Node.js 24 and Codex signed in with ChatGPT.

## Sign in

1. Sign in on the website.
2. Open the extension, choose **Sign in**, and use the same account. Keep the website signed in to exercise cookie/session isolation.
3. The account panel should close after sign-in and saved skills should appear in **Run**.

## Record, create, and save

1. Open `https://www.wikipedia.org` with English selected.
2. Choose **Record → Start recording**. Search for Ada Lovelace using the search button, then wait for the article.
3. Reopen the popup and choose **Stop & create skill**. A draft should appear automatically.
4. Review Name and Description. The timeline and **Instructions & download** should be collapsed.
5. Expand the timeline and Markdown to confirm that the search value is absent and the skill uses `search_1`.
6. Choose **Save to library**. The button should show Saving, then a visible saved state and version message at the same location. It should not require scrolling to find success.
7. Choose **Run saved skill**. The popup should switch to Run and show the skill inputs.
8. Edit the name, description, and Markdown in both views. Continuous typing, spaces, selections, and cursor placement should work without refocusing. Reopen the popup and confirm the edits remain.

## AI agent runs

1. Return to the starting Wikipedia page and enter **Search Wikipedia for Grace Hopper** in **What would you like to do?** Leave optional parameters empty to test extraction from the request.
2. Choose the connected local Codex provider and **Run skill**. **AI agent** is the default executor. During decisions, the popup should show **Agent is choosing a safe action** and identify Codex.
3. Safe actions should advance without Next. Search submission should pause with **Submit search on www.wikipedia.org**, **Click the “Search” button**, and a description of the effect. The badge should show `!` when attention is needed.
4. Choose **Submit search & continue**. This approves only the displayed action and resumes automatic execution. Close the popup during navigation; it should continue and finish the checkpoint without requiring the popup to remain open.
5. Reopen it and verify the completed summary, activity log, and Grace Hopper result.
6. Return to the starting page and request **Search Wikipedia for Alan Turing** using the same skill, without recording again.
7. Repeat the record/save/run flow for GitHub's organization repository search (`https://github.com/orgs/github/repositories`, inputs actions/docs) and Python documentation (`https://docs.python.org/3/search.html`, record json with the search button, then request asyncio/pathlib). These are the other two verified live agent demonstrations.
8. Open Library Advanced Search (`https://openlibrary.org/advancedsearch`, Title inputs Foundation/Frankenstein) is an additional example whose current final agent verification is pending. If a website shows human verification, complete it yourself and inspect the page before resuming. A connection-error screen is not a successful run; wait for the website to recover before retrying.

## Pause, Stop, and manual execution

1. Start an automatic run, choose **Pause**, and check that no additional actions execute until **Resume run**.
2. Stop a run before confirming submission. No later search action should execute; the web history should show a stopped run.
3. Under **Execution options**, choose **Recorded steps (no AI)** and **Step by step** to test the diagnostic replay mode. Only **Next step** should advance it; protected actions still require confirmation. Switch back to **AI agent** for agent acceptance testing.
4. Start a Wikipedia skill on `https://example.com`. The first checkpoint should block and nothing should be clicked. Stop afterward.

## Library, versions, and sharing

1. Refresh the web library and open the saved skill. Main actions should have visible filled or outlined button styles.
2. Change its description and choose **Save new version**. Both version numbers should remain listed.
3. Refresh and reopen that skill in the extension.
4. Register a second disposable account before sharing with its email. As the recipient, confirm the shared skill is readable and runnable but owner editing is unavailable.
5. Run the shared skill and inspect the recipient's Run history. **View steps** should expose step types/statuses without input values.
6. Sign out in the extension and refresh the website; the independent website session should remain signed in.

## Privacy and recovery

Use disposable inputs on a controlled page for password filtering and dummy Delete/Pay confirmation tests. Never exercise this check on a real payment or deletion. Automated fixture tests cover omitted password values, blocked duplicate targets, and confirmation pauses.

For worker suspension, close extension DevTools and the popup while recording, wait until the worker becomes inactive, then click another link in the recorded tab. The timeline must retain both earlier and later actions. An automatic run should recover after suspension; an interrupted action with an unknown outcome must pause for inspection.
