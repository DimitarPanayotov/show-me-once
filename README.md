# Show Me Once

Record a browser task once, then type a new request and click Run inside the extension. Its agent executes the skill automatically while you watch, approve protected actions, pause or stop.

[Web library](https://show-me-once-dimitar.vercel.app) · [Reviewer kit 0.7.2](https://github.com/DimitarPanayotov/show-me-once/releases/tag/v0.7.2-demo) · [Setup and demo](docs/agent.md) · [Architecture](docs/architecture.md) · [Verification](docs/verification.md)

## Start here

Load the extension from the reviewer kit and sign into the library. Under **Agent settings**, either add your own OpenAI/Anthropic API key or install the one-time subscription helper for a signed-in Codex installation. The helper is started automatically by Chrome; no bridge terminal or coding-agent chat is needed during normal use.

**Record → review SKILL.md → save to library → type a new request → Run.** The extension advances safe steps automatically, shows each step, pauses for clear action-specific approval, and offers Pause/Resume/Stop. New or edited owned skills are saved before Run so backend history belongs to a saved version.

Choose **Try GitHub issue triage** for a twelve-step example: four form inputs, protected search, Recently updated sort, first matching issue and final checkpoint. Run first with microsoft/vscode + terminal + open + bug, then microsoft/TypeScript + inference + open + bug. The example request is editable inside the extension.

Personal API keys remain session-only in the extension and are forwarded transiently through the backend to the chosen provider. No owner model credentials are needed. The subscription helper supports Codex; it uses Codex's own sign-in without extracting credentials. [Full setup and manual test](docs/agent.md).

**External coding agent (optional)** retains MCP skill discovery and guarded browser tools for existing agent chats. It is separate from the main Run flow. [Optional setup](docs/mcp.md).

## Teach a task

Open its starting page, choose **Record → Start recording**, do the task, then **Stop & create skill**. Review the generated parameters and checkpoints, save it to the library, then choose **Run this skill**. Return to its starting page, type the new inputs in the request box and click **Run**.

The primary execution path stays inside the extension. Agent settings provide personal API keys or the automatically started subscription helper. External coding-agent integration is collapsed and optional; manual stepping and recorded replay are absent from the main interface.

## Library and privacy

Recording and local editing work without an account. Sign in to save and run skills with PostgreSQL-backed immutable versions and per-step history, or share with another registered user. Recipients can read and run shared skills; owners control editing/sharing. Markdown/agent ZIP exports remain optional.

Recording excludes typed values and sensitive controls. Skills contain parameters, bounded structural hints and sanitized navigation checkpoints. The extension validates fresh live targets and asks for action-specific approval before protected actions. Unknown outcomes pause instead of replaying actions. Cloud access is rechecked for the current account. Imported MCP run activity is currently local; automatic association with backend skill-version history remains a limitation.

## Implementation

WXT / Chrome MV3 / TypeScript; Next.js and shadcn/ui; oRPC; PostgreSQL and Prisma; Vercel. Skill generation is deterministic and local. The extension owns execution; a backend provider adapter or a Chrome-launched Codex helper supplies guarded model decisions.

The recorder and guarded executor persist state across worker suspension. An optional stdio MCP server exposes discovery plus five execution tools, starts/reuses a loopback connector automatically, and closes it when idle. Credentials stay outside the repository.

## Build and checks

Use Node.js 24 and pnpm 10. For local web development, copy apps/web/.env.example to apps/web/.env.local, start PostgreSQL with docker compose up -d, apply Prisma migrations, and run pnpm dev:web.

Run pnpm test and pnpm typecheck. Set WXT_API_BASE_URL=https://show-me-once-dimitar.vercel.app, then run pnpm reviewer:package to build the deploy-targeted extension, bundled connector and reviewer kit. The packaging script refuses a kit pointed at localhost. No credentials are packaged.

Configure the Vercel project with root apps/web, workspace sources enabled, Node.js 24, and DATABASE_URL. The web build applies Prisma migrations before Next.js. Browser tests for older execution modes are historical fixtures; current popup tests run in an in-memory document without controlling Chrome.
