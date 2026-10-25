# Show Me Once

One demonstration becomes a reusable browser skill. This repository is an in-progress Juma Labs take-home project. Recording is working, and the extension can now generate an editable local `SKILL.md` draft.

## What works now

- Manifest V3 extension built with WXT and TypeScript.
- Start and stop recording from the popup in an ordinary `http` or `https` tab.
- Capture clicks, changed form controls, Enter in a nonsensitive input, full-page navigation and SPA URL changes in that tab.
- Persist the timeline in `chrome.storage.local` after each action, including across service-worker suspension and page navigation.
- Show the timeline in the popup after it is reopened.
- Start recording in a tab that was already open when the extension was loaded, without refreshing the page.
- Generate, edit, retain locally and download a `SKILL.md` draft with `name` and `description` frontmatter, parameters, steps and checkpoints.
- Run the generated plan one step at a time in the extension, with visible logs, Stop, page checkpoints and explicit confirmation for detected submit, destructive and payment actions.
- Never save recorded form values, page text, URL queries, fragments, credentials or path values. Password and other sensitive controls are ignored entirely. During a run, interactive labels are compared locally for target selection and never logged or sent to a model.

The recording, draft and run log are local to the extension. The backend library, auth, sharing and deployment are the next milestones.

## Run locally

Requires Node.js 24.11+ and pnpm 10.

```powershell
pnpm install
pnpm test
pnpm --filter @show-me-once/extension build
pnpm --filter @show-me-once/web dev
```

In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `apps/extension/.output/chrome-mv3`. Open a public website, click the extension icon, start recording, complete a task in that tab, and reopen the popup to stop and inspect the timeline. After stopping, edit the suggested name and description, click **Generate SKILL.md**, review or edit the draft, then click **Download SKILL.md**. A draft stays in extension storage if the popup closes.

To test generalization, record a public search task. The query value is omitted from the timeline. Its generated step should use a placeholder such as `{{search_1}}`. A recording made only of clicks instead asks for target descriptions such as `{{target_1}}`.

Search forms submitted with Enter produce a separate **press Enter** step. The runner requires explicit confirmation before submitting it. A navigation checkpoint after a click or Enter must observe an actual page or SPA URL change, even when redacted URLs have the same shape.

To run a new input, regenerate a skill made before the runner was added so it includes the `json show-me-once` plan block. Navigate to the starting site, enter new parameters under **Run this skill**, and click **Start run**. Click **Next step** once for each action. A submit button or detected destructive/payment target requires **Confirm this action** before it is clicked. Reopen the popup after navigation to continue. **Stop run** prevents later steps. Parameter values live only in `chrome.storage.session` for the run and are removed on stop or completion; they are not written to the local run log.

The web app runs at `http://localhost:3000`. Its oRPC health procedure accepts POST at `/api/rpc/health`. The web app currently has no account or skill UI.

## Architecture

| Layer | Responsibility |
| --- | --- |
| Content script | Observe click, change and same-document navigation events. It sends only structural selectors, control types, checkbox state and page URL to the background worker. During a run, it executes one validated step and compares interactive labels locally when needed. |
| MV3 service worker | Validate/sanitize every incoming event, bind it to the tab where recording began, serialize writes, persist the timeline and manage one-step run state. Browser navigation events are captured here too. |
| Popup | Start/stop recording, display the timeline, generate/edit/download a local skill draft, and control a step-by-step run. |
| Next.js + oRPC | Future skill library and run APIs. A health procedure is wired now. |
| PostgreSQL + Prisma | Schema for users, skills, versions, shares, runs and per-step logs. A connection is required when migrations and persistence are enabled. |

The generated skill uses YAML `name` and `description` frontmatter, explicit parameters, step instructions, checkpoints and a validated JSON executable plan. Generation is deterministic and local. Input values are not inferred from recorded form contents. Structural selectors are hints that the runner validates before acting. Because URL paths are redacted, navigation steps are checkpoints rather than executable URLs; the user starts on the intended site. The runner reads the JSON block; edits to the prose alone do not change executable actions. The skill is not yet saved to the backend.

## Deployment preparation

The Next.js app is under `apps/web`. Set the Vercel project root to that directory, use the pnpm workspace install, and configure `DATABASE_URL` for a PostgreSQL database. The web build generates the Prisma client. Apply migrations before using database-backed endpoints. The current web app can build without a database but is not yet the final deliverable.

## Next milestones

1. Verify the step-by-step runner on the three public websites with two distinct inputs each and improve selectors where checkpoints block.
2. Add accounts, backend persistence, sharing and database-backed step logs.
3. Deploy to Vercel, provide a test account, build a zip and record a demo under five minutes.

The required personal report about challenges and decisions must be written by the candidate in their own words.
