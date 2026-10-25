# Show Me Once

Teach a browser task once, save it as a reusable skill, and run it again with new inputs.

[Open the app](https://show-me-once-dimitar.vercel.app) · [Download the Chrome extension](https://github.com/DimitarPanayotov/show-me-once/releases/tag/v0.2.0-demo)

## How it works

1. **Record:** open a task's starting page, switch to **Record**, and demonstrate the task. Choose **Stop & create skill** when finished.
2. **Save:** a parameterized skill is created locally. Review its name and choose **Save to library**. The button shows progress and confirms the saved version in place.
3. **Run:** switch to **Run**, choose a saved skill, enter new inputs, and choose **Run skill**. Automatic execution is the default. It continues with the popup closed and pauses for confirmation or an unavailable target.
4. **Control:** use **Pause**, **Resume run**, or **Stop run** at any time. **Step by step** execution is also available. The extension badge shows when a run needs attention.
5. **Share:** use the web app to edit versions, share with another registered account, and inspect run history. **Instructions & download** contains the editable `SKILL.md` and export action.

## Stack and design

- WXT, TypeScript, and Chrome Manifest V3 for recording and execution.
- Next.js and shadcn/ui for the skill library, versions, sharing, and run history.
- oRPC, Prisma, PostgreSQL, and Vercel for the backend and deployment.
- Local deterministic skill generation: recorded values and page text are excluded. No model service or API key is required.

The **Run** and **Record** views keep unrelated controls out of the way. The timeline and raw Markdown are expandable details. Recordings and run progress survive service-worker suspension; run parameters and extension tokens stay in browser session storage.

Automatic execution has been verified with two inputs each on Wikipedia search, GitHub organization repository search, and Open Library title search. Safe actions advance automatically; protected submissions still require confirmation.

The [architecture note](docs/architecture.md) explains the skill format, background scheduler, privacy boundaries, and current limits. The [manual test guide](docs/manual-test.md) covers the full user flow. [Verification](docs/verification.md) distinguishes reported real-site checks from automated browser tests.

## Local setup

Requires Node.js 24.11+, pnpm 10, Docker, and Chrome 120+.

```powershell
pnpm install
Copy-Item apps/web/.env.example apps/web/.env.local
docker compose up -d
pnpm --filter @show-me-once/web exec prisma migrate deploy
pnpm dev:web
```

In another terminal:

```powershell
pnpm --filter @show-me-once/extension build
```

At `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `apps/extension/.output/chrome-mv3`. Register in the local web app, then use the popup's **Sign in** button with the same account. Web and extension sessions are independent.

To build a ZIP for the deployed app:

```powershell
$env:WXT_API_BASE_URL = 'https://show-me-once-dimitar.vercel.app'
pnpm --filter @show-me-once/extension zip
```

Extract the ZIP and load the folder containing `manifest.json`. After rebuilding an existing unpacked installation, choose **Reload** on its extension card.

## Checks

```powershell
pnpm test
pnpm typecheck
pnpm build
```

Browser tests additionally cover recording to automatic draft creation, inline save feedback, automatic runs with two inputs, navigation with the popup closed, confirmations, Pause/Resume/Stop, manual mode, ambiguous targets, worker termination recovery, and server logs. See [browser testing](docs/browser-testing.md) for setup.

## Deployment

Import the repository into Vercel with **Root Directory** set to `apps/web` and **Include source files outside of the Root Directory** enabled. Use Node.js 24.x and connect PostgreSQL through Vercel Storage or provide `DATABASE_URL`.

The web build runs `prisma migrate deploy` before `next build`. Prisma reads `.env.local` locally and the environment variable in Vercel. Build the extension with `WXT_API_BASE_URL` set to the public production origin; the manifest grants host access only to that API origin. [Vercel monorepo guidance](https://vercel.com/docs/monorepos/monorepo-faq).
