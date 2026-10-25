# Show Me Once

One demonstration becomes a reusable browser skill. This repository is an in-progress Juma Labs take-home project. The first working milestone is a local, privacy-preserving recording flow.

## What works now

- Manifest V3 extension built with WXT and TypeScript.
- Start and stop recording from the popup in an ordinary `http` or `https` tab.
- Capture clicks, changed form controls, full-page navigation and SPA URL changes in that tab.
- Persist the timeline in `chrome.storage.local` after each action, including across service-worker suspension and page navigation.
- Show the timeline in the popup after it is reopened.
- Never read or save typed values, page text, URL queries, fragments, credentials or path values. Password and other sensitive controls are ignored entirely.

The current recording is local to the extension. Skill generation, editable library, auth, sharing, controlled replay and deployment are the next milestones.

## Run locally

Requires Node.js 24.11+ and pnpm 10.

```powershell
pnpm install
pnpm test
pnpm --filter @show-me-once/extension build
pnpm --filter @show-me-once/web dev
```

In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `apps/extension/.output/chrome-mv3`. Open a public website, click the extension icon, start recording, complete a task in that tab, and reopen the popup to stop and inspect the timeline.

The web app runs at `http://localhost:3000`. Its oRPC health procedure accepts POST at `/api/rpc/health`. The web app currently has no account or skill UI.

## Architecture

| Layer | Responsibility |
| --- | --- |
| Content script | Observe click, change and same-document navigation events. It sends only structural selectors, control types, checkbox state and page URL to the background worker. It never reads field values or page text. |
| MV3 service worker | Validate/sanitize every incoming event, bind it to the tab where recording began, serialize writes, and persist the timeline in `chrome.storage.local`. Browser navigation events are captured here too. |
| Popup | Start/stop recording and display the locally saved timeline. |
| Next.js + oRPC | Future skill library and run APIs. A health procedure is wired now. |
| PostgreSQL + Prisma | Schema for users, skills, versions, shares, runs and per-step logs. A connection is required when migrations and persistence are enabled. |

The skill format planned for the next milestone is a versioned `SKILL.md` with YAML `name` and `description`, explicit parameters, step instructions and checkpoints. Input values will be supplied by the user when creating or running the skill. They are not inferred from recorded form contents.

## Deployment preparation

The Next.js app is under `apps/web`. Set the Vercel project root to that directory, use the pnpm workspace install, and configure `DATABASE_URL` for a PostgreSQL database. The web build generates the Prisma client. Apply migrations before using database-backed endpoints. The current web app can build without a database but is not yet the final deliverable.

## Next milestones

1. Turn a recording into a parameterized, editable `SKILL.md`.
2. Run steps one at a time in the extension, showing actions, pause/stop controls and confirmations for destructive or payment actions.
3. Add accounts, backend persistence, sharing and step logs.
4. Verify on three public websites with two distinct inputs each.
5. Deploy to Vercel, provide a test account, build a zip and record a demo under five minutes.

The required personal report about challenges and decisions must be written by the candidate in their own words.
