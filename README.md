# Show Me Once

One browser demonstration becomes a reusable `SKILL.md` and a step-by-step Chrome run. This is the Juma Labs AI Engineer take-home project.

## Current state

- WXT/TypeScript Manifest V3 extension records sanitized clicks, inputs, Enter and navigation. The timeline survives page changes and service-worker suspension.
- Local deterministic generation produces editable `SKILL.md` instructions, parameters, checkpoints and a validated executable plan. Form values, page text and unredacted URLs are excluded.
- The extension executes one step at a time, shows each action, asks before submission or detected destructive/payment actions, and can stop a run.
- Next.js/shadcn web app uses oRPC, Prisma and PostgreSQL for accounts, skill versions, sharing and per-step run history. Web sessions use HttpOnly cookies; extension sessions are held in `chrome.storage.session`.
- The candidate manually reported successful replay of one skill with two inputs on each of Wikipedia, GitHub and Open Library. See [verification](docs/verification.md).

The local API and database have been smoke tested. Chrome testing of the new account/library sync and production deployment remain to be completed.

## Local setup

Requires Node.js 24.11+, pnpm 10, Docker and Chrome.

```powershell
pnpm install
Copy-Item apps/web/.env.example apps/web/.env
docker compose up -d
pnpm --filter @show-me-once/web exec prisma migrate deploy
pnpm dev:web
```

In another terminal:

```powershell
pnpm --filter @show-me-once/extension build
```

Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `apps/extension/.output/chrome-mv3`. The web library runs at `http://localhost:3000`. Register an account in the web app, then sign in with the same account in the extension popup. The extension can save the current skill to the library and load owned or shared skills. Share a saved skill with a second registered account from the web app.

The extension defaults to `http://localhost:3000`. To build it for a deployed app, set `WXT_API_BASE_URL` to the HTTPS Vercel origin before `pnpm --filter @show-me-once/extension build` or `zip`. The generated manifest grants host access only to that API origin.

## Use the extension

1. Open an ordinary public website, choose **Start recording**, perform one task, and choose **Stop**. The timeline omits field values.
2. Set a skill name and description; choose **Generate SKILL.md**. Review the Markdown and download it if desired.
3. Sign in and choose **Save to library**. The web app can show versions and share the skill with another account.
4. Return to the starting page, enter new parameter values and choose **Start run**. Use **Next step** to execute one action at a time; confirm submissions when prompted. Reopen the popup after navigation. **Stop run** prevents later actions.
5. Load a saved or shared skill from the popup to run it. Values used during a run live only in browser session storage and are omitted from server run logs.

## Architecture and safety

See [architecture](docs/architecture.md) for the content script, service worker, backend, skill format and safety boundaries.

## Checks

```powershell
pnpm test
pnpm typecheck
pnpm build
```

## Deployment

The Vercel project root is `apps/web`. Configure a PostgreSQL `DATABASE_URL`, apply `prisma migrate deploy`, then build the web app. Build the extension with `WXT_API_BASE_URL` set to the deployed HTTPS origin and distribute its `.output/chrome-mv3` folder or WXT zip. The app must be deployed and a reviewer test account provisioned before submission.

The required short personal report about what was hard and how it was tackled must be written by the candidate in their own words.
