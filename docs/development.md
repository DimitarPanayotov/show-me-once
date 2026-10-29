# Development

Requires Node.js 24, pnpm 10 and PostgreSQL. The included Docker Compose configuration runs PostgreSQL locally.

## Local setup

Run from the repository root:

```sh
pnpm install
docker compose up -d
```

Copy `apps/web/.env.example` to `apps/web/.env.local`. Its default database URL matches Docker Compose.

```sh
pnpm --filter @show-me-once/web db:generate
pnpm --filter @show-me-once/web exec prisma migrate deploy
pnpm dev:web
```

In another terminal, run `pnpm dev:extension`. The extension uses `http://localhost:3000` by default.

## Checks and builds

```sh
pnpm test
pnpm typecheck
pnpm --filter @show-me-once/extension zip
pnpm --filter @show-me-once/web build
```

The extension build is in `apps/extension/.output/chrome-mv3`. Set `WXT_API_BASE_URL` before building to use a different backend.

The default tests exercise shared validation, provider contracts, popup/content logic, service-worker coordination, MCP transport and the web API. Controlled documents and simulated Chrome services do not establish live website compatibility.

## Project layout

- `apps/extension`: WXT extension and browser task execution.
- `apps/web`: Next.js app, oRPC API and Prisma schema.
- `packages/shared`: recording, skill and action validation.
- `packages/agent`: model adapters and the subscription helper.
- `packages/mcp`: optional coding-agent integration.
- `examples`: saved skills and run results.

## Vercel

Use `apps/web` as the project root, enable workspace sources, select Node.js 24 and set `DATABASE_URL` for PostgreSQL. The web build generates Prisma Client, applies migrations and builds Next.js.

Model access is supplied by each user through an API key or the local subscription helper.
