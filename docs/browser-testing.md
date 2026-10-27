# Browser regression tests

These tests use a clean Chromium / Chrome for Testing profile with the unpacked extension and the Chrome DevTools Protocol. They create disposable application accounts and skills. Use a local app/database by default.

## Setup

1. Start the local app and database using the README.
2. Build the extension with its default local API origin:

```powershell
pnpm --filter @show-me-once/extension build
```

3. Start the controlled fixture in a separate terminal:

```powershell
pnpm --filter @show-me-once/extension test:fixture
```

4. Start a test Chromium executable with a fresh profile, a debugging port, and the built extension. Replace the executable path and workspace path with your local paths:

```powershell
$extensionPath = (Resolve-Path apps/extension/.output/chrome-mv3).Path
$testProfile = Join-Path $env:TEMP ('show-me-once-' + [guid]::NewGuid().ToString('N'))
Start-Process -FilePath 'C:\path\to\chromium\chrome.exe' -ArgumentList @('--headless=new', '--remote-debugging-port=9226', "--user-data-dir=$testProfile", "--disable-extensions-except=$extensionPath", "--load-extension=$extensionPath") -WindowStyle Hidden
```

Use Chromium or Chrome for Testing with support for loading extensions through launch flags. A branded Chrome installation may restrict those flags.

5. Run:

```powershell
pnpm --filter @show-me-once/extension test:browser
```

If the extension's worker has already become inactive, set `SMO_EXTENSION_ID` to the ID shown at `chrome://extensions` before running the test. `SMO_API_BASE` can select a different app origin, but it must match the extension's build-time API origin. `SMO_SCREENSHOTS` optionally selects an existing directory for screenshots.

## What is checked

- A website session and extension session can coexist.
- Recording creates a parameterized draft automatically on Stop, excluding password and input values.
- Save reports progress and success adjacent to the button, without scrolling to a global notice.
- One saved skill runs automatically with two inputs and syncs per-step logs without the input values.
- Protected submission pauses for confirmation. Automatic execution continues with the popup closed.
- Pause/Resume, Stop, and optional manual execution retain their intended behavior.
- Ambiguous targets pause without clicking.
- A deliberately terminated service worker recovers persisted automatic work through the recovery alarm. This check can take about a minute.

The separate unit tests cover uncertain in-flight outcomes: recovery pauses for inspection before an action could be repeated.

## Confirmation regression tests

With the same fixture and isolated browser running, use `pnpm --filter @show-me-once/extension test:confirmation`. No application account is required. This focused test covers action-specific search/delete/payment/Enter previews, reopening the popup, changed labels, replaced DOM elements, expired preview recovery without execution, stale approval rejection, Stop, and excluding preview labels and inputs from persistent logs. Optional screenshots use `SMO_SCREENSHOTS`; activating the popup tab first can be necessary in headless browsers.

## Production verification

The current production build was tested with an explicit production origin and temporary accounts. The original real-site verification remains a separate manual evidence table; the controlled browser tests do not claim unrestricted website compatibility.

## AI agent tests

Start the token-protected local helper described in [agent setup](agent.md). Set `SMO_BRIDGE_TOKEN` to its pairing code, and use `pnpm --filter @show-me-once/extension test:agent` for the controlled fixture with a real model. Set `SMO_EXTENSION_ID` if the worker is inactive. The agent test checks extraction from a task request, a shifted search control, two inputs, popup closure, protected-action confirmation, cancellation during inference, and excluded values in persistent state.

`test:agent:sites` records one fresh workflow each on Wikipedia, GitHub, Open Library, and Python documentation, then runs two new inputs per recording through the connected model. `SMO_SITE_FILTER` can select one case (for example `python-docs-search`); filtered evidence uses its own filename. `SMO_SKILL_OUTPUT` optionally saves generated skills and results. `SMO_CDP_BASE` selects a different isolated browser debugging address. Human-verification challenges require user intervention; the test does not bypass them. Open Library's final agent results are pending because its challenge and connection-error pages prevented completion; the three verified sites are Wikipedia, GitHub, and Python documentation.

The replay/confirmation suites explicitly select **Recorded steps (no AI)**. Their successful results should not be presented as agent execution evidence. Hosted provider tests use mocked network responses and do not establish live account/model access.
