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

## Production verification

The current production build was tested with an explicit production origin and temporary accounts. The original real-site verification remains a separate manual evidence table; the controlled browser tests do not claim unrestricted website compatibility.
