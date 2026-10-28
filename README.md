# Show Me Once

Record a browser task once, then ask your existing coding agent to repeat it with new inputs. Chrome shows the actions and keeps approval, Pause and Stop under your control.

[Web library](https://show-me-once-dimitar.vercel.app) · [Reviewer kit 0.5.0](https://github.com/DimitarPanayotov/show-me-once/releases/tag/v0.5.0-demo) · [Setup and demo](docs/mcp.md) · [Architecture](docs/architecture.md) · [Verification](docs/verification.md)

## Start here

Download and extract the reviewer kit to a permanent folder, then open **START-HERE.html**. It contains the extension, a one-time connector setup wizard, and a built-in Wikipedia example.

You need Chrome, Node.js 24 and a local MCP-capable coding agent. Codex is the configured example; other clients use the same stdio tools but have not been verified end to end.

1. Load the kit's **extension** folder at chrome://extensions.
2. Copy the extension ID and open **connector/Connect with Codex.cmd** on Windows, or run **node setup.mjs** in that folder on macOS/Linux. The wizard registers Codex automatically.
3. Restart/reconnect your agent and paste the setup's pairing code into the extension once.
4. Choose **Open Wikipedia & copy example request**, select English on Wikipedia, and paste the request into your agent.
5. Review the search approval in Chrome and check the result. Repeat with a different topic.

No owner API key, provider selection, separate helper terminal, library account, or skill-file installation is required for this flow. Pairing is remembered, and the agent manages the connector automatically.

**Manual real-agent/Chrome acceptance is still pending.** Automated protocol/controller/document checks are not evidence of a completed live-browser demo. See verification for the exact boundary.

## Teach a task

Open its starting page, choose **Record → Start recording**, do the task, then **Stop & create skill**. Review the skill and choose **Use with agent**. The agent discovers local and saved skills directly through list_skills/get_skill and reads the generated SKILL.md before running it. It asks for new inputs as needed.

The popup has one execution path. Provider pickers, the old Codex decision helper, manual stepping and recorded-replay controls have been removed from the current interface. Older adapters remain in source for compatibility/testing, outside the reviewer flow.

## Library and privacy

Local skills work without an account. Sign in for PostgreSQL-backed saving, immutable versions and sharing with another registered user. Recipients can read and run shared skills; owners control editing/sharing. Markdown/agent ZIP exports remain optional.

Recording excludes typed values and sensitive controls. Skills contain parameters, bounded structural hints and sanitized navigation checkpoints. The extension validates fresh live targets and asks for action-specific approval before protected actions. Unknown outcomes pause instead of replaying actions. Cloud access is rechecked for the current account. Imported MCP run activity is currently local; automatic association with backend skill-version history remains a limitation.

## Implementation

WXT / Chrome MV3 / TypeScript; Next.js and shadcn/ui; oRPC; PostgreSQL and Prisma; Vercel. Skill generation is deterministic and local. The existing coding-agent session owns model inference; our connector does not launch a separate model.

The recorder and guarded executor persist state across worker suspension. A stdio MCP server exposes discovery plus five execution tools, starts/reuses a loopback connector automatically, and closes it when idle. One-time credentials stay outside the repository.

## Build and checks

Use Node.js 24 and pnpm 10. For local web development, copy apps/web/.env.example to apps/web/.env.local, start PostgreSQL with docker compose up -d, apply Prisma migrations, and run pnpm dev:web.

Run pnpm test and pnpm typecheck. Set WXT_API_BASE_URL=https://show-me-once-dimitar.vercel.app, then run pnpm reviewer:package to build the deploy-targeted extension, bundled connector and reviewer kit. The packaging script refuses a kit pointed at localhost. No credentials are packaged.

Configure the Vercel project with root apps/web, workspace sources enabled, Node.js 24, and DATABASE_URL. The web build applies Prisma migrations before Next.js. Browser tests for older execution modes are historical fixtures; current popup tests run in an in-memory document without controlling Chrome.
