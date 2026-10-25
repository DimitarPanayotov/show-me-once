# Manual test checklist

For the deployed test, download the extension ZIP from the [demo release](https://github.com/DimitarPanayotov/show-me-once/releases/tag/v0.1.1-demo), extract it, and choose the extracted folder containing `manifest.json` in Chrome's **Load unpacked** dialog at `chrome://extensions`. Open [the live app](https://show-me-once-juma.vercel.app) and use the reviewer account supplied separately. For local development, load `apps/extension/.output/chrome-mv3` and run the web app at `http://localhost:3000`. After each rebuild, press **Reload** on the extension card.

## Record and safety

1. Open `https://www.wikipedia.org`, open the extension, and choose **Start recording**. Search for a public topic and stop after the result page loads.
2. The timeline should contain the initial navigation, focus click, input with **value omitted**, submit click, and result navigation. It must not show the search value or URL query.
3. Generate `SKILL.md`, inspect its `search_1` parameter and executable plan, then download it. Search text must not appear in the file.
4. Close and reopen the popup. The timeline and draft should remain. Reload the tab and start another recording to check that event capture still works after extension reload.
5. On a page with a password field, type a disposable value while recording and confirm that no password input action appears in the timeline. Do not use a real password for this test.

## Run

1. Return to the starting page, enter a new topic in `search_1`, and choose **Start run**.
2. Advance one step at a time. Confirm the search submission when the popup asks. Reopen the popup after navigation and finish the checkpoint. The result page should match the supplied topic.
3. Repeat with a different topic. Start a third run and choose **Stop run** before the next action; later steps must not execute.
4. A missing or ambiguous control should leave the step blocked. A payment or destructive action must require explicit confirmation.

## Library and sharing

1. Register or sign in through the web app. Keep that website session signed in, then sign in with the same account in the extension popup. Both should work together; the extension uses its own bearer session and excludes website cookies.
2. Choose **Save to library** on a generated draft. The popup should show a success message and list the skill under **Saved and shared skills**. Refresh the web app and confirm it appears there.
3. Edit the skill in the web app and choose **Save new version**. The version number should increase and older versions remain listed.
4. Register a second account, share the skill with its email from the owner's web app, then sign in as that account. It should appear as shared and be loadable but not editable as owner.
5. Run the saved skill. The web app's **Run history** should show step types and statuses, without parameter values.
6. Sign out in the extension and refresh the web app. The website should remain signed in because its cookie session is independent.

## Three-site evidence

The candidate's manual replay results are recorded in [verification.md](verification.md): Wikipedia search, GitHub repository filtering, and Open Library title search, each with two different inputs. If Open Library presents human verification, complete it manually and start from the intended search page again.
