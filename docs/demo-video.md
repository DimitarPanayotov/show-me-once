# Demo video (under 5 minutes)

Show one complete GitHub workflow: record it, save its skill, then let the extension's agent repeat it with new inputs. Aim for an edited length of 4:30–4:50.

## Before recording

1. Reload extension 0.9.2, pin its icon and maximize Chrome.
2. Sign in and check that the Codex subscription shows Ready under Agent settings. Install the helper beforehand. Explain its one-time setup in the introduction.
3. Open GitHub Advanced search at https://github.com/search/advanced with empty fields. Open the web library in another tab.
4. Have a second library account signed in in another browser window for the sharing check. Keep passwords, API keys and setup codes off camera.
5. Rehearse the whole flow once. Check that both replacement inputs return issues. Human-verification challenges must be completed by the user.

## Start the screen recording

Use Windows Snipping Tool: press Win + Shift + R, select the Chrome area, enable the microphone and click Start. Include the address bar and the extension popup in the recording area. Make a ten-second test and play it back before the full take.

Microsoft instructions: [screen recording](https://support.microsoft.com/en-gb/windows/apps/use-snipping-tool-to-capture-screenshots?nochrome=true), [microphone recording](https://www.microsoft.com/en-us/windows/learning-center/how-to-use-snipping-tool-on-windows-screenshots-shortcuts-and-screen-recordings).

## What to show

These are target timings for the edited video. Record complete actions first; trim idle loading or label any sped-up waiting afterward.

| Time | Show and explain |
| --- | --- |
| 0:00–0:15 | Introduce the idea: teach a browser task once and reuse it with new inputs. Mention that this demonstration uses the installed helper and your Codex subscription; users can also supply an API key. |
| 0:15–1:15 | Click Record → Start recording. In GitHub Advanced search, enter topic terminal, repository microsoft/vscode, state open and label bug. Search, sort by Recently updated and open the first issue. Return to the extension and click Stop & create skill. |
| 1:15–1:40 | Name it github-issue-triage-demo and give it a clear description. Show the generated parameters, page checkpoints and executable plan briefly, then Save to library. Explain that typed values were omitted from the recording. |
| 1:40–3:15 | Return to Advanced search. Select the skill, enter the first request below and click Run. Show automatic field filling, the exact search approval, automatic continuation and the final issue. Open the extension to show completion. |
| 3:15–3:40 | Run that same skill with the second request below. Keep the new request, approval and completed result visible in the edited clip. Trim the waiting to fit this slot. |
| 3:40–4:15 | In the web library, open the saved skill, save an edited description as a new version and share it with the second account. Switch to that account and open the shared skill. |
| 4:15–4:35 | Start another run and press Stop before approving its search. Show the stopped status and the web library's step history for the extension-led runs. |
| 4:35–4:50 | Show the live app, repository and architecture note. Remind reviewers where to download the extension and choose their model access. |

First replacement request:

```text
Find open issues in microsoft/vscode about debugger with label bug.
Sort by recently updated and open the first matching issue.
```

Second replacement request:

```text
Find open issues in microsoft/TypeScript about inference with label bug.
Sort by recently updated and open the first matching issue.
```

The newly recorded skill is the subject of this video. Use the built-in example separately if you want an additional demonstration. A brief MCP clip is optional if time remains.

## Finish

Stop the recording and save the video. Use Edit in Clipchamp if you need to trim waiting. Keep the approvals and actual outcomes understandable, and label sped-up sections. Play the exported video once to check readable text, microphone audio and a duration below five minutes. Test the final video link in a signed-out window before submitting it.

Keep evidence for the three-site/two-input requirement separately; a short video does not replace those checks. Only show successful runs you have actually completed. The personal reflection remains the candidate's own writing.
